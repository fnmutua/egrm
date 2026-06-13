import type { Cd01Identity, Cd09Notifications, NotificationEvent, NotificationRule, PartyNotificationChannel } from '@egrm/config-schemas';
import { buildIntakeAlertRule, buildStatusChangeStaffRule, filterChannelsForPartyPreference } from '@egrm/config-schemas';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { piiLookupHash } from './crypto.js';
import { renderTemplateBody } from './notification-dispatch.js';
import { env } from '../env.js';

export interface NotificationEventContext {
  tenantId: string;
  caseId: string;
  event: NotificationEvent;
  case: {
    reference: string;
    status: string;
    sensitivity: string;
    priority: string;
    levelCode: string;
    channel: string;
    anonymous: boolean;
    categories: string[];
    unitId: string | null;
    assigneeId: string | null;
    partyId: string | null;
    /** Complainant opt-in from intake; filters party-targeted outbound channels when set. */
    partyNotificationChannels?: PartyNotificationChannel[];
  };
  data?: Record<string, unknown>;
  locale?: string;
}

type RecipientSelector = NotificationRule['to'][number];
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function matchesList(value: string, filter: string | string[] | undefined): boolean {
  if (filter === undefined) return true;
  const list = Array.isArray(filter) ? filter : [filter];
  return list.includes(value);
}

function ruleMatches(rule: NotificationRule, ctx: NotificationEventContext): boolean {
  if (!rule.enabled) return false;
  if (rule.on !== ctx.event) return false;
  const c = rule.condition;
  if (!c) return true;
  if (c.sensitivity !== undefined && !matchesList(ctx.case.sensitivity, c.sensitivity)) return false;
  if (c.priority !== undefined && !matchesList(ctx.case.priority, c.priority)) return false;
  if (c.level !== undefined && ctx.case.levelCode !== c.level) return false;
  if (c.channel !== undefined && ctx.case.channel !== c.channel) return false;
  if (c.anonymous !== undefined && ctx.case.anonymous !== c.anonymous) return false;
  if (c.category !== undefined) {
    const cats = Array.isArray(c.category) ? c.category : [c.category];
    if (!ctx.case.categories.some((cat) => cats.includes(cat))) return false;
  }
  const toStatus = ctx.data?.to_status ?? ctx.data?.status;
  const fromStatus = ctx.data?.from_status;
  if (c.to_status !== undefined && typeof toStatus === 'string' && !matchesList(toStatus, c.to_status)) return false;
  if (c.from_status !== undefined && typeof fromStatus === 'string' && !matchesList(fromStatus, c.from_status)) return false;
  if (c.not_status !== undefined) {
    const status = typeof toStatus === 'string' ? toStatus : ctx.case.status;
    const blocked = Array.isArray(c.not_status) ? c.not_status : [c.not_status];
    if (blocked.includes(status)) return false;
  }
  return true;
}

function pickTemplateId(rule: NotificationRule, sensitivity: string): string {
  if (sensitivity !== 'standard' && rule.privacy_template) return rule.privacy_template;
  return rule.template;
}

function isChannelKilled(cfg: Cd09Notifications, channel: string): string | null {
  for (const ks of cfg.kill_switches) {
    if (ks.channel === channel && !ks.enabled) return ks.reason ?? 'kill_switch';
  }
  return null;
}

function channelsForRule(rule: NotificationRule, selector: RecipientSelector): string[] {
  const ch = rule.channels;
  if (Array.isArray(ch)) return ch;
  if ('party' in selector || 'address' in selector) return ch?.party ?? [];
  return ch?.staff ?? ch?.party ?? [];
}

function recipientKindLabel(selector: RecipientSelector): string {
  if ('party' in selector) return `party:${selector.party}`;
  if ('user' in selector) return `user:${selector.user}`;
  if ('role' in selector) return `role:${selector.role}`;
  if ('team' in selector) return `team:${selector.team}`;
  if ('address' in selector) return 'address';
  return 'unknown';
}

function expandPartyChannels(channels: string[], selector: RecipientSelector, cfg: Cd09Notifications): string[] {
  const out = new Set(channels);
  const waEnabled = cfg.senders?.whatsapp?.enabled !== false;
  const isParty = 'party' in selector || 'address' in selector;
  if (waEnabled && isParty && out.has('sms')) out.add('whatsapp');
  return [...out];
}

function complainantPartyRule(rule: NotificationRule): boolean {
  return rule.to.some((t) => 'party' in t && t.party === 'complainant');
}

async function buildNotificationVars(ctx: NotificationEventContext): Promise<Record<string, string>> {
  const [identity, unitRow] = await Promise.all([
    getActiveConfig<Cd01Identity>(ctx.tenantId, 'cd01_identity'),
    ctx.case.unitId
      ? db.select({ name: schema.unit.name }).from(schema.unit).where(eq(schema.unit.id, ctx.case.unitId)).limit(1)
      : Promise.resolve([]),
  ]);
  const tenantName = identity?.name ?? 'GRM';
  const trackUrl = `${env.PUBLIC_PORTAL_BASE_URL.replace(/\/$/, '')}/track?ref=${encodeURIComponent(ctx.case.reference)}`;
  const actionTaken = String(ctx.data?.action_taken ?? '');
  const updateSummary = String(ctx.data?.update_summary ?? '');

  return {
    'case.reference': ctx.case.reference,
    'case.status': ctx.case.status,
    'case.status_label': ctx.case.status,
    'case.level': ctx.case.levelCode,
    'case.unit_name': unitRow[0]?.name ?? ctx.case.levelCode,
    'case.action_taken': actionTaken,
    'case.update_summary': updateSummary,
    'tenant.name': tenantName,
    'tenant.short_name': tenantName.split(/\s+/)[0] ?? tenantName,
    'tracking.url': trackUrl,
    'tracking.link': ctx.case.reference,
    'date.today': new Date().toISOString().slice(0, 10),
    'date.deadline': '',
  };
}

/** Evaluate CD-09 rules; enqueue outbox + notification_log inside the caller's transaction. */
export async function enqueueNotifications(
  ctx: NotificationEventContext,
  tx: DbTx,
): Promise<{ count: number; outboxId: string | null }> {
  const cfg = await getActiveConfig<Cd09Notifications>(ctx.tenantId, 'cd09_notifications');
  if (!cfg) return { count: 0, outboxId: null };

  const locale = ctx.locale ?? 'en';
  let matching = cfg.rules.filter((r) => ruleMatches(r, ctx));
  if (ctx.event === 'case.created') {
    const intakeRule = buildIntakeAlertRule(cfg);
    if (intakeRule) matching.push(intakeRule);
  }
  if (ctx.event === 'case.status_changed') {
    const staffRule = buildStatusChangeStaffRule(cfg);
    if (staffRule) matching.push(staffRule);
    const toStatus = typeof ctx.data?.to_status === 'string' ? ctx.data.to_status : ctx.case.status;
    const skipComplainant =
      cfg.status_change_alerts?.notify_complainant === false
      || (cfg.status_change_alerts?.complainant_exclude_statuses ?? []).includes(toStatus);
    if (skipComplainant) {
      matching = matching.filter((r) => !complainantPartyRule(r));
    }
  }
  if (matching.length === 0) return { count: 0, outboxId: null };

  const vars = await buildNotificationVars(ctx);

  const [outbox] = await tx
    .insert(schema.notificationOutbox)
    .values({
      tenantId: ctx.tenantId,
      caseId: ctx.caseId,
      eventKind: ctx.event,
      payload: { rules: matching.map((r) => r.id), data: ctx.data ?? {} },
    })
    .returning({ id: schema.notificationOutbox.id });

  let count = 0;
  for (const rule of matching) {
    const templateId = pickTemplateId(rule, ctx.case.sensitivity);
    const selectors = rule.to.length > 0 ? rule.to : [{ party: 'complainant' as const }];

    for (const selector of selectors) {
      let channels = expandPartyChannels(channelsForRule(rule, selector), selector, cfg);
      channels = filterChannelsForPartyPreference(channels, selector, ctx.case.partyNotificationChannels);
      for (const channel of new Set(channels)) {
        const killReason = isChannelKilled(cfg, channel);
        const { body } = renderTemplateBody(cfg, templateId, locale, channel, vars);
        const status = killReason ? `suppressed:${killReason}` : 'queued';

        await tx.insert(schema.notificationLog).values({
          tenantId: ctx.tenantId,
          caseId: ctx.caseId,
          outboxId: outbox!.id,
          eventKind: ctx.event,
          ruleId: rule.id ?? null,
          recipientSelector: selector,
          recipientKind: recipientKindLabel(selector),
          recipientAddressHash: piiLookupHash(`${ctx.caseId}:${rule.id}:${channel}:${recipientKindLabel(selector)}`),
          channel,
          templateId,
          locale,
          renderedPreview: body.slice(0, 500),
          status,
        });
        count += 1;
      }
    }
  }

  return { count, outboxId: outbox!.id };
}
