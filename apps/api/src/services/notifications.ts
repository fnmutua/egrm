import type { Cd09Notifications, NotificationEvent, NotificationRule } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { piiLookupHash } from './crypto.js';

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
  };
  data?: Record<string, unknown>;
  locale?: string;
}

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

function renderPreview(
  cfg: Cd09Notifications,
  templateId: string,
  locale: string,
  channel: string,
  vars: Record<string, string>,
): string {
  const tpl = cfg.templates.find((t) => t.id === templateId);
  const body =
    tpl?.variants[locale]?.[channel as 'sms' | 'email' | 'in_app']?.body ??
    tpl?.variants.en?.[channel as 'sms' | 'email' | 'in_app']?.body ??
    `[${templateId}]`;
  return body.replace(/\{\{([a-z_.]+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

function isChannelKilled(cfg: Cd09Notifications, channel: string): string | null {
  for (const ks of cfg.kill_switches) {
    if (ks.channel === channel && !ks.enabled) return ks.reason ?? 'kill_switch';
  }
  return null;
}

/** Evaluate CD-09 rules; enqueue outbox + notification_log inside the caller's transaction. */
export async function enqueueNotifications(ctx: NotificationEventContext, tx: DbTx): Promise<number> {
  const cfg = await getActiveConfig<Cd09Notifications>(ctx.tenantId, 'cd09_notifications');
  if (!cfg) return 0;

  const locale = ctx.locale ?? 'en';
  const matching = cfg.rules.filter((r) => ruleMatches(r, ctx));
  if (matching.length === 0) return 0;

  const vars: Record<string, string> = {
    'case.reference': ctx.case.reference,
    'case.status': ctx.case.status,
    'case.status_label': ctx.case.status,
    'case.level': ctx.case.levelCode,
    'case.unit_name': ctx.case.levelCode,
    'tenant.name': 'GRM',
    'tenant.short_name': 'GRM',
    'tracking.url': `/track?ref=${encodeURIComponent(ctx.case.reference)}`,
    'tracking.link': ctx.case.reference,
    'date.today': new Date().toISOString().slice(0, 10),
  };

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
    const channels = Array.isArray(rule.channels)
      ? rule.channels
      : [...(rule.channels?.party ?? []), ...(rule.channels?.staff ?? [])];

    for (const channel of new Set(channels)) {
      const killReason = isChannelKilled(cfg, channel);
      const preview = renderPreview(cfg, templateId, locale, channel, vars);
      const status = killReason ? `suppressed:${killReason}` : 'queued';

      await tx.insert(schema.notificationLog).values({
        tenantId: ctx.tenantId,
        caseId: ctx.caseId,
        outboxId: outbox!.id,
        eventKind: ctx.event,
        recipientKind: rule.to.length ? JSON.stringify(rule.to[0]) : 'rule',
        recipientAddressHash: piiLookupHash(`${ctx.caseId}:${rule.id}:${channel}`),
        channel,
        templateId,
        locale,
        renderedPreview: preview.slice(0, 500),
        status,
      });
      count += 1;
    }
  }

  return count;
}
