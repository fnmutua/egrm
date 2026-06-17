import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { Cd01Identity, Cd04Workflow, Cd09Notifications } from '@egrm/config-schemas';
import { formatMobileNumber, sendWhatsApp } from '@egrm/notifications';
import { db, schema } from '../db/client.js';
import { env } from '../env.js';
import { piiLookupHash } from './crypto.js';
import { getActiveConfig } from './config.js';
import { verifyCaseByReference } from './correspondence.js';

type MetaInboundMessage = {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
  };
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: MetaInboundMessage[];
      };
    }>;
  }>;
};

const STATUS_INTENT = /check\s*status|status\s*update|hali|fuatilia|track|ref/i;
const STATUS_BUTTON_PAYLOAD = /^(check[_\s-]?status|status|hali)$/i;
const CASE_REF_PATTERN = /\b([A-Z]{2,6}-\d{4}-\d{3,8})\b/i;

export function verifyMetaWebhookSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice(7);
  if (expected.length !== received.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(received, 'utf8'));
  } catch {
    return false;
  }
}

function humanizeStatus(status: string): string {
  return status
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

async function statusLabel(tenantId: string, statusCode: string, locale = 'en'): Promise<string> {
  const wf = await getActiveConfig<Cd04Workflow>(tenantId, 'cd04_workflow');
  const match = wf?.statuses.find((s) => s.name === statusCode);
  const localized = match?.label?.[locale] ?? match?.label?.en;
  return localized?.trim() || humanizeStatus(statusCode);
}

async function resolveTenantByWhatsAppPhoneNumberId(phoneNumberId: string): Promise<{
  tenantId: string;
  tenantName: string;
  cfg: Cd09Notifications;
} | null> {
  const tenants = await db.select().from(schema.tenant).where(eq(schema.tenant.active, true));
  for (const tenant of tenants) {
    const cfg = await getActiveConfig<Cd09Notifications>(tenant.id, 'cd09_notifications');
    const configuredId = cfg?.senders?.whatsapp?.phone_number_id?.trim();
    if (cfg && configuredId && configuredId === phoneNumberId) {
      const identity = await getActiveConfig<Cd01Identity>(tenant.id, 'cd01_identity');
      return {
        tenantId: tenant.id,
        tenantName: identity?.name ?? tenant.name,
        cfg,
      };
    }
  }
  return null;
}

async function findCasesByPhone(
  tenantId: string,
  phone: string,
  limit = 5,
): Promise<Array<{ reference: string; status: string }>> {
  const normalized = formatMobileNumber(phone) ?? phone;
  const hash = piiLookupHash(normalized);
  if (!hash) return [];

  const parties = await db
    .select({ id: schema.party.id })
    .from(schema.party)
    .where(and(eq(schema.party.tenantId, tenantId), eq(schema.party.phoneHash, hash)));

  const partyIds = parties.map((p) => p.id);
  const whereClause =
    partyIds.length > 0
      ? and(eq(schema.grmCase.tenantId, tenantId), or(inArray(schema.grmCase.partyId, partyIds), eq(schema.grmCase.verifierHash, hash)))
      : and(eq(schema.grmCase.tenantId, tenantId), eq(schema.grmCase.verifierHash, hash));

  const rows = await db
    .select({ reference: schema.grmCase.reference, status: schema.grmCase.status })
    .from(schema.grmCase)
    .where(whereClause)
    .orderBy(desc(schema.grmCase.createdAt))
    .limit(limit);

  return rows;
}

function isStatusCheckIntent(msg: MetaInboundMessage): boolean {
  if (msg.type === 'button' && msg.button) {
    const label = `${msg.button.payload ?? ''} ${msg.button.text ?? ''}`.trim();
    return STATUS_INTENT.test(label) || STATUS_BUTTON_PAYLOAD.test(label);
  }
  if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
    const label = `${msg.interactive.button_reply?.id ?? ''} ${msg.interactive.button_reply?.title ?? ''}`.trim();
    return STATUS_INTENT.test(label) || STATUS_BUTTON_PAYLOAD.test(label);
  }
  if (msg.type === 'text' && msg.text?.body) {
    const body = msg.text.body.trim();
    if (CASE_REF_PATTERN.test(body)) return false;
    return STATUS_INTENT.test(body);
  }
  return false;
}

function extractReferenceFromText(text: string): string | null {
  const match = text.match(CASE_REF_PATTERN);
  return match?.[1]?.toUpperCase() ?? null;
}

function buildStatusReply(
  tenantName: string,
  cases: Array<{ reference: string; statusLabel: string }>,
  trackBase: string,
): string {
  if (!cases.length) {
    return `${tenantName}: We could not find a grievance linked to this number. Reply with your reference (e.g. GRM-2026-0001) or visit our portal to register a new case.`;
  }

  const lines = cases.map((c) => {
    const url = `${trackBase}/track?ref=${encodeURIComponent(c.reference)}`;
    return `• ${c.reference}: ${c.statusLabel}\n  ${url}`;
  });

  const intro =
    cases.length === 1
      ? `${tenantName} — status for your grievance:`
      : `${tenantName} — your recent grievances:`;

  return `${intro}\n\n${lines.join('\n\n')}`;
}

async function sendWhatsAppReply(cfg: Cd09Notifications, to: string, body: string): Promise<void> {
  if (cfg.senders.whatsapp.enabled === false) return;
  if (env.NOTIFICATIONS_DEV_LOG_ONLY) {
    console.log(`[whatsapp-webhook:dev] reply → ${to}`);
    console.log(body);
    return;
  }
  await sendWhatsApp(cfg.senders.whatsapp, { to, body });
}

async function casesWithLabels(
  tenantId: string,
  rows: Array<{ reference: string; status: string }>,
  locale = 'en',
): Promise<Array<{ reference: string; statusLabel: string }>> {
  return Promise.all(
    rows.map(async (row) => ({
      reference: row.reference,
      statusLabel: await statusLabel(tenantId, row.status, locale),
    })),
  );
}

async function handleInboundMessage(
  tenantId: string,
  tenantName: string,
  cfg: Cd09Notifications,
  msg: MetaInboundMessage,
): Promise<void> {
  const from = msg.from?.trim();
  if (!from) return;

  const identity = await getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity');
  const locale = identity?.locales?.default ?? 'en';
  const trackBase = env.PUBLIC_PORTAL_BASE_URL.replace(/\/$/, '');
  let reply: string | null = null;

  if (msg.type === 'text' && msg.text?.body) {
    const ref = extractReferenceFromText(msg.text.body);
    if (ref) {
      const verified = await verifyCaseByReference(tenantId, ref, from);
      if (verified) {
        const labeled = await casesWithLabels(
          tenantId,
          [{ reference: verified.case.reference, status: verified.case.status }],
          locale,
        );
        reply = buildStatusReply(tenantName, labeled, trackBase);
      } else {
        reply = `${tenantName}: We could not verify grievance ${ref} with this phone number. Check the reference or use the tracking link from your acknowledgement message.`;
      }
    }
  }

  if (!reply && isStatusCheckIntent(msg)) {
    const rows = await findCasesByPhone(tenantId, from);
    const labeled = await casesWithLabels(tenantId, rows, locale);
    reply = buildStatusReply(tenantName, labeled, trackBase);
  }

  if (!reply) return;
  await sendWhatsAppReply(cfg, from, reply);
}

/** Process Meta WhatsApp webhook payload (status quick-reply and reference lookups). */
export async function handleWhatsAppWebhookPayload(body: unknown): Promise<void> {
  const payload = body as MetaWebhookPayload;
  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id?.trim();
      if (!phoneNumberId) continue;

      const resolved = await resolveTenantByWhatsAppPhoneNumberId(phoneNumberId);
      if (!resolved) {
        console.warn('[whatsapp-webhook] unknown phone_number_id', phoneNumberId);
        continue;
      }

      for (const msg of value.messages ?? []) {
        try {
          await handleInboundMessage(resolved.tenantId, resolved.tenantName, resolved.cfg, msg);
        } catch (err) {
          console.error('[whatsapp-webhook] inbound message failed', err);
        }
      }
    }
  }
}
