import { and, eq, sql } from 'drizzle-orm';
import type { Cd01Identity, Cd09Notifications, NotificationRule } from '@egrm/config-schemas';
import { DeliveryError, sendEmail, sendSms, sendWhatsApp } from '@egrm/notifications';
import { db, schema } from '../db/client.js';
import { decryptPII } from './crypto.js';
import { getActiveConfig } from './config.js';
import { env } from '../env.js';
import { createStaffInboxEntries, resolveInAppUserIds } from './staff-inbox.js';

type RecipientSelector = NotificationRule['to'][number];

type WhatsAppTemplateVariant = {
  body: string;
  subject?: string;
  wa_template_name?: string;
  wa_template_language?: string;
  wa_body_param_keys?: string[];
};

export function renderTemplateBody(
  cfg: Cd09Notifications,
  templateId: string,
  locale: string,
  channel: string,
  vars: Record<string, string>,
): { subject: string; body: string } {
  const tpl = cfg.templates.find((t) => t.id === templateId);
  const localeVariants = tpl?.variants[locale] ?? tpl?.variants.en;
  const variant =
    localeVariants?.[channel as 'sms' | 'email' | 'whatsapp' | 'in_app'] ??
    (channel === 'whatsapp' ? localeVariants?.sms : undefined);
  const replace = (text: string) => text.replace(/\{\{([a-z_.]+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);

  const body = replace(variant?.body ?? `[${templateId}]`);
  const subject = replace(variant?.subject ?? `Notification — ${vars['case.reference'] ?? ''}`);
  return { subject, body };
}

/** Resolve Meta template name, language, and body parameters for WhatsApp dispatch. */
export function whatsappSendOptions(
  cfg: Cd09Notifications,
  templateId: string,
  locale: string,
  vars: Record<string, string>,
): {
  body: string;
  templateName?: string;
  templateLanguage?: string;
  templateParams?: string[];
} {
  const { body } = renderTemplateBody(cfg, templateId, locale, 'whatsapp', vars);
  const tpl = cfg.templates.find((t) => t.id === templateId);
  const localeVariants = tpl?.variants[locale] ?? tpl?.variants.en;
  const variant = (localeVariants?.whatsapp ?? localeVariants?.sms) as WhatsAppTemplateVariant | undefined;
  const sender = cfg.senders.whatsapp;

  const templateName = variant?.wa_template_name?.trim() || sender.template_name?.trim();
  if (!templateName) {
    return { body };
  }

  const templateLanguage =
    variant?.wa_template_language?.trim() || sender.template_language?.trim() || 'en_US';
  const paramKeys =
    variant?.wa_body_param_keys?.length
      ? variant.wa_body_param_keys
      : sender.template_body_param_keys ?? [];
  const templateParams = paramKeys.map((key: string) => vars[key] ?? '');

  return { body, templateName, templateLanguage, templateParams };
}

async function ancestorUnitIds(tenantId: string, unitId: string | null): Promise<Set<string>> {
  if (!unitId) return new Set();
  const units = await db
    .select({ id: schema.unit.id, parentId: schema.unit.parentId })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId));

  const byId = new Map(units.map((u) => [u.id, u.parentId]));
  const chain = new Set<string>();
  let cur: string | null | undefined = unitId;
  while (cur) {
    chain.add(cur);
    cur = byId.get(cur) ?? null;
  }
  return chain;
}

async function resolveAddresses(
  tenantId: string,
  selector: RecipientSelector,
  channel: string,
  caseRow: {
    partyId: string | null;
    assigneeId: string | null;
    unitId: string | null;
  },
): Promise<string[]> {
  if (channel === 'in_app') return ['in_app'];

  if ('address' in selector && selector.address) {
    return [selector.address.trim()];
  }

  if ('party' in selector) {
    if (!caseRow.partyId) return [];
    const [party] = await db
      .select({ phoneEnc: schema.party.phoneEnc, emailEnc: schema.party.emailEnc })
      .from(schema.party)
      .where(eq(schema.party.id, caseRow.partyId))
      .limit(1);
    if (!party) return [];
    if (channel === 'sms' || channel === 'whatsapp') {
      const phone = decryptPII(party.phoneEnc);
      return phone ? [phone] : [];
    }
    if (channel === 'email') {
      const email = decryptPII(party.emailEnc);
      return email ? [email] : [];
    }
    return [];
  }

  if ('user' in selector) {
    const userId = selector.user === 'assignee' ? caseRow.assigneeId : null;
    if (!userId) return [];
    const [user] = await db
      .select({ email: schema.appUser.email })
      .from(schema.appUser)
      .where(eq(schema.appUser.id, userId))
      .limit(1);
    if (!user) return [];
    return channel === 'email' ? [user.email] : [];
  }

  if ('role' in selector) {
    const roleName = selector.role;
    const scope = selector.scope ?? 'case_unit';
    const assignments = await db
      .select({
        email: schema.appUser.email,
        unitId: schema.userRole.unitId,
      })
      .from(schema.userRole)
      .innerJoin(schema.role, eq(schema.userRole.roleId, schema.role.id))
      .innerJoin(schema.appUser, eq(schema.userRole.userId, schema.appUser.id))
      .where(and(eq(schema.role.tenantId, tenantId), eq(schema.role.name, roleName), eq(schema.appUser.active, true)));

    if (scope === 'tenant') {
      return [...new Set(assignments.map((a) => a.email).filter(Boolean))];
    }

    const caseChain = await ancestorUnitIds(tenantId, caseRow.unitId);

    const matched = assignments.filter((a) => {
      if (!a.unitId) return false;
      if (scope === 'case_unit') return a.unitId === caseRow.unitId;
      if (scope === 'unit_and_above') return caseChain.has(a.unitId);
      if (scope === 'level') return true;
      return false;
    });

    return [...new Set(matched.map((a) => a.email).filter(Boolean))];
  }

  return [];
}

async function buildTemplateVars(
  tenantId: string,
  caseRow: {
    reference: string;
    status: string;
    levelCode: string;
    unitId: string | null;
    partyId: string | null;
  },
): Promise<Record<string, string>> {
  const [identity, unitRow, partyRow] = await Promise.all([
    getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity'),
    caseRow.unitId
      ? db.select({ name: schema.unit.name }).from(schema.unit).where(eq(schema.unit.id, caseRow.unitId)).limit(1)
      : Promise.resolve([]),
    caseRow.partyId
      ? db.select({ nameEnc: schema.party.nameEnc }).from(schema.party).where(eq(schema.party.id, caseRow.partyId)).limit(1)
      : Promise.resolve([]),
  ]);

  const tenantName = identity?.name ?? 'GRM';
  const trackUrl = `${env.PUBLIC_PORTAL_BASE_URL.replace(/\/$/, '')}/track?ref=${encodeURIComponent(caseRow.reference)}`;
  const partyName = partyRow[0]?.nameEnc ? decryptPII(partyRow[0].nameEnc) : '';

  return {
    'case.reference': caseRow.reference,
    'case.status': caseRow.status,
    'case.status_label': caseRow.status,
    'case.level': caseRow.levelCode,
    'case.unit_name': unitRow[0]?.name ?? caseRow.levelCode,
    'tenant.name': tenantName,
    'tenant.short_name': tenantName.split(/\s+/)[0] ?? tenantName,
    'party.name': partyName || 'Complainant',
    'tracking.url': trackUrl,
    'tracking.link': caseRow.reference,
    'date.today': new Date().toISOString().slice(0, 10),
    'date.deadline': '',
  };
}

async function deliverMessage(
  cfg: Cd09Notifications,
  channel: string,
  to: string,
  subject: string,
  body: string,
  opts?: { templateId: string; locale: string; vars: Record<string, string> },
): Promise<{ messageId: string; provider: string }> {
  if (env.NOTIFICATIONS_DEV_LOG_ONLY) {
    console.log(`[notifications:dev] ${channel.toUpperCase()} → ${to}`);
    console.log(`  subject: ${subject}`);
    console.log(`  body: ${body.slice(0, 240)}${body.length > 240 ? '…' : ''}`);
    return { messageId: `dev-${Date.now()}`, provider: 'dev_log' };
  }

  if (channel === 'email') {
    return sendEmail(cfg.senders.email, { to, subject, body });
  }
  if (channel === 'sms') {
    return sendSms(cfg.senders.sms, { to, body });
  }
  if (channel === 'whatsapp') {
    const wa =
      opts != null
        ? whatsappSendOptions(cfg, opts.templateId, opts.locale, opts.vars)
        : { body };
    return sendWhatsApp(cfg.senders.whatsapp, {
      to,
      body: wa.body,
      templateName: wa.templateName,
      templateLanguage: wa.templateLanguage,
      templateParams: wa.templateParams,
    });
  }
  if (channel === 'in_app') {
    return { messageId: `in_app-${Date.now()}`, provider: 'in_app' };
  }
  throw new DeliveryError(`Unsupported channel: ${channel}`, channel, false);
}

/** Process in-app first so SMTP/API failures cannot block staff inbox delivery. */
function sortLogsForDispatch<T extends { channel: string }>(logs: T[]): T[] {
  const rank = (channel: string) => (channel === 'in_app' ? 0 : 1);
  return [...logs].sort((a, b) => rank(a.channel) - rank(b.channel));
}

async function finalizeOutbox(
  outboxId: string,
  outbox: { attempts: number },
  processedCount: number,
  failures: number,
  extraError?: string,
): Promise<void> {
  const remaining = await db
    .select({ id: schema.notificationLog.id })
    .from(schema.notificationLog)
    .where(and(eq(schema.notificationLog.outboxId, outboxId), eq(schema.notificationLog.status, 'queued')));

  const pending = remaining.length;
  const totalFailures = failures + pending;
  const allFailed = processedCount > 0 && totalFailures >= processedCount;

  let status: 'done' | 'failed' | 'pending';
  if (pending > 0) {
    status = 'pending';
  } else if (allFailed) {
    status = 'failed';
  } else {
    status = 'done';
  }

  await db
    .update(schema.notificationOutbox)
    .set({
      status,
      lastError:
        extraError ??
        (pending > 0
          ? `${pending} notification(s) still queued`
          : totalFailures > 0
            ? `${totalFailures} delivery failure(s)`
            : null),
      processedAt: pending > 0 ? null : new Date(),
      attempts: outbox.attempts + 1,
    })
    .where(eq(schema.notificationOutbox.id, outboxId));
}

/** Resume outboxes that still have queued notification_log rows. */
export async function resumeStuckNotificationOutboxes(): Promise<void> {
  const stuck = await db
    .selectDistinct({ id: schema.notificationOutbox.id })
    .from(schema.notificationOutbox)
    .innerJoin(schema.notificationLog, eq(schema.notificationLog.outboxId, schema.notificationOutbox.id))
    .where(
      and(
        eq(schema.notificationLog.status, 'queued'),
        sql`${schema.notificationOutbox.status} IN ('processing', 'pending', 'done', 'failed')`,
      ),
    );

  for (const row of stuck) {
    await dispatchNotificationOutbox(row.id).catch((err) => {
      console.error('[notifications] resume queued outbox failed', row.id, err);
    });
  }
}

/** Process all queued notification_log rows for an outbox entry. */
export async function dispatchNotificationOutbox(outboxId: string): Promise<void> {
  const [outbox] = await db
    .select()
    .from(schema.notificationOutbox)
    .where(eq(schema.notificationOutbox.id, outboxId))
    .limit(1);

  if (!outbox) return;

  const [queuedRow] = await db
    .select({ id: schema.notificationLog.id })
    .from(schema.notificationLog)
    .where(and(eq(schema.notificationLog.outboxId, outboxId), eq(schema.notificationLog.status, 'queued')))
    .limit(1);

  if (outbox.status === 'done' && !queuedRow) return;

  await db
    .update(schema.notificationOutbox)
    .set({ status: 'processing' })
    .where(eq(schema.notificationOutbox.id, outboxId));

  const logs = sortLogsForDispatch(
    await db
      .select()
      .from(schema.notificationLog)
      .where(and(eq(schema.notificationLog.outboxId, outboxId), eq(schema.notificationLog.status, 'queued'))),
  );

  if (logs.length === 0) {
    await db
      .update(schema.notificationOutbox)
      .set({ status: 'done', processedAt: new Date() })
      .where(eq(schema.notificationOutbox.id, outboxId));
    return;
  }

  const cfg = await getActiveConfig<Cd09Notifications>(outbox.tenantId, 'cd09_notifications');
  if (!cfg) {
    await db
      .update(schema.notificationOutbox)
      .set({ status: 'failed', lastError: 'cd09_not_configured', processedAt: new Date() })
      .where(eq(schema.notificationOutbox.id, outboxId));
    return;
  }

  let caseRow: {
    id: string;
    reference: string;
    status: string;
    levelCode: string;
    unitId: string | null;
    partyId: string | null;
    assigneeId: string | null;
  } | null = null;

  if (outbox.caseId) {
    const [c] = await db
      .select({
        id: schema.grmCase.id,
        reference: schema.grmCase.reference,
        status: schema.grmCase.status,
        levelCode: schema.grmCase.levelCode,
        unitId: schema.grmCase.unitId,
        partyId: schema.grmCase.partyId,
        assigneeId: schema.grmCase.assigneeId,
      })
      .from(schema.grmCase)
      .where(eq(schema.grmCase.id, outbox.caseId))
      .limit(1);
    caseRow = c ?? null;
  }

  const vars = caseRow
    ? await buildTemplateVars(outbox.tenantId, caseRow)
    : {
        'case.reference': '',
        'case.status': '',
        'case.status_label': '',
        'case.level': '',
        'case.unit_name': '',
        'tenant.name': 'GRM',
        'tenant.short_name': 'GRM',
        'party.name': 'Complainant',
        'tracking.url': env.PUBLIC_PORTAL_BASE_URL,
        'tracking.link': '',
        'date.today': new Date().toISOString().slice(0, 10),
        'date.deadline': '',
      };

  let failures = 0;
  let dispatchError: string | undefined;

  try {
    for (const log of logs) {
    const selector = log.recipientSelector as RecipientSelector | null;
    if (!selector || !caseRow) {
      await db
        .update(schema.notificationLog)
        .set({ status: 'failed:no_recipient', updatedAt: new Date(), attempts: log.attempts + 1 })
        .where(eq(schema.notificationLog.id, log.id));
      failures += 1;
      continue;
    }

    const { subject, body } = renderTemplateBody(cfg, log.templateId, log.locale, log.channel, vars);

    if (log.channel === 'in_app') {
      const userIds = await resolveInAppUserIds(outbox.tenantId, selector, caseRow);
      if (userIds.length === 0) {
        await db
          .update(schema.notificationLog)
          .set({ status: 'failed:no_recipient', updatedAt: new Date(), attempts: log.attempts + 1 })
          .where(eq(schema.notificationLog.id, log.id));
        failures += 1;
        continue;
      }

      let delivered = 0;
      let inboxError: string | undefined;
      try {
        delivered = await createStaffInboxEntries({
          tenantId: outbox.tenantId,
          userIds,
          caseId: caseRow.id,
          notificationLogId: log.id,
          eventKind: log.eventKind,
          title: subject,
          body,
        });
      } catch (err) {
        inboxError = err instanceof Error ? err.message : String(err);
        console.error('[notifications] staff inbox insert failed', log.id, err);
      }

      await db
        .update(schema.notificationLog)
        .set({
          // In-app delivery is the notification_log row; inbox table only stores read/dismiss state.
          status: 'sent',
          providerMessageId: delivered > 0 ? `in_app-${delivered}` : 'in_app-0',
          renderedPreview: body.slice(0, 2000),
          lastError: inboxError ?? null,
          updatedAt: new Date(),
          attempts: log.attempts + 1,
        })
        .where(eq(schema.notificationLog.id, log.id));

      if (inboxError) console.warn('[notifications] in_app sent but inbox row missing', log.id, inboxError);
      continue;
    }

    const addresses = await resolveAddresses(outbox.tenantId, selector, log.channel, caseRow);
    if (addresses.length === 0) {
      await db
        .update(schema.notificationLog)
        .set({ status: 'failed:no_recipient', updatedAt: new Date(), attempts: log.attempts + 1 })
        .where(eq(schema.notificationLog.id, log.id));
      failures += 1;
      continue;
    }

    let lastMessageId: string | undefined;
    let sent = 0;
    let lastError: string | undefined;

    for (const to of addresses) {
      try {
        const result = await deliverMessage(cfg, log.channel, to, subject, body, {
          templateId: log.templateId,
          locale: log.locale,
          vars,
        });
        lastMessageId = result.messageId;
        sent += 1;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (sent > 0) {
      await db
        .update(schema.notificationLog)
        .set({
          status: sent === addresses.length ? 'sent' : 'sent:partial',
          providerMessageId: lastMessageId,
          renderedPreview: body.slice(0, 2000),
          lastError: sent < addresses.length ? (lastError ?? null) : null,
          updatedAt: new Date(),
          attempts: log.attempts + 1,
        })
        .where(eq(schema.notificationLog.id, log.id));
    } else {
      await db
        .update(schema.notificationLog)
        .set({
          status: 'failed',
          renderedPreview: body.slice(0, 2000),
          lastError: lastError ?? 'unknown',
          updatedAt: new Date(),
          attempts: log.attempts + 1,
        })
        .where(eq(schema.notificationLog.id, log.id));
      failures += 1;
    }
    }
  } catch (err) {
    dispatchError = err instanceof Error ? err.message : String(err);
    console.error('[notifications] dispatch interrupted', outboxId, err);
  } finally {
    await finalizeOutbox(outboxId, outbox, logs.length, failures, dispatchError);
  }
}
