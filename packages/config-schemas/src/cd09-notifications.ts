import { z } from 'zod';

/** Fixed event catalogue (spec 06 §1.1) — extensible by platform releases. */
export const NOTIFICATION_EVENTS = [
  'case.created',
  'case.acknowledged',
  'case.status_changed',
  'case.assigned',
  'case.level_moved',
  'case.referred_out',
  'case.resolved',
  'case.confirmation_requested',
  'case.confirmed',
  'case.closed',
  'case.reopened',
  'appeal.opened',
  'appeal.decided',
  'satisfaction.requested',
  'sla.at_risk',
  'sla.breached',
  'thread.reply_external',
  'thread.reply_inbound',
  'task.assigned',
  'task.overdue',
  'committee.decision_recorded',
  'user.invited',
  'config.changed',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_CHANNELS = ['sms', 'email', 'in_app'] as const;

/** Allowed template variables — unknown tokens fail validation at config time (spec 06 §1.3). */
export const TEMPLATE_VARIABLES = [
  'case.reference',
  'case.status',
  'case.status_label',
  'case.level',
  'case.unit_name',
  'case.category',
  'tenant.name',
  'tenant.short_name',
  'actor.name',
  'tracking.link',
  'tracking.url',
  'date.today',
  'date.deadline',
] as const;

const templateVarPattern = /\{\{([a-z_.]+)\}\}/g;

function extractTemplateVars(text: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(templateVarPattern.source, 'g');
  while ((m = re.exec(text)) !== null) found.push(m[1]!);
  return found;
}

const recipientParty = z.object({ party: z.enum(['complainant', 'representative']) });
const recipientUser = z.object({ user: z.enum(['assignee', 'case_creator']) });
const recipientRole = z.object({
  role: z.string().min(1),
  scope: z.enum(['case_unit', 'unit_and_above', 'level', 'tenant']).default('case_unit'),
});
const recipientTeam = z.object({ team: z.string().min(1) });
const recipientAddress = z.object({ address: z.string().min(1) });

export const recipientSelector = z.union([
  recipientParty,
  recipientUser,
  recipientRole,
  recipientTeam,
  recipientAddress,
]);

export const ruleCondition = z
  .object({
    sensitivity: z.union([z.string(), z.array(z.string())]).optional(),
    category: z.union([z.string(), z.array(z.string())]).optional(),
    priority: z.union([z.string(), z.array(z.string())]).optional(),
    level: z.string().optional(),
    channel: z.string().optional(),
    anonymous: z.boolean().optional(),
    from_status: z.union([z.string(), z.array(z.string())]).optional(),
    to_status: z.union([z.string(), z.array(z.string())]).optional(),
    not_status: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .optional();

const channelList = z.array(z.enum(NOTIFICATION_CHANNELS));

export const notificationRule = z.object({
  id: z.string().min(1).optional(),
  name: z.string().optional(),
  on: z.enum(NOTIFICATION_EVENTS),
  to: z.array(recipientSelector).default([]),
  /** Flat channel list, or audience-specific map (spec 06 example). */
  channels: z
    .union([
      channelList,
      z.object({
        party: channelList.optional(),
        staff: channelList.optional(),
      }),
    ])
    .optional(),
  template: z.string().min(1),
  /** Used when case sensitivity is non-standard (privacy_safe variant). */
  privacy_template: z.string().optional(),
  condition: ruleCondition,
  enabled: z.boolean().default(true),
});

const templateChannelBody = z.object({
  subject: z.string().optional(),
  body: z.string().min(1),
});

type TemplateVariants = Record<string, { sms?: { body: string; subject?: string }; email?: { body: string; subject?: string }; in_app?: { body: string } }>;

/** Drop channel entries with blank bodies so the editor can show optional fields safely. */
export function stripEmptyTemplateVariants(
  templates: { variants: TemplateVariants }[],
): { variants: TemplateVariants }[] {
  return templates.map((tpl) => ({
    ...tpl,
    variants: Object.fromEntries(
      Object.entries(tpl.variants ?? {})
        .map(([locale, channels]) => [
          locale,
          Object.fromEntries(
            Object.entries(channels).filter(([, v]) => typeof v?.body === 'string' && v.body.trim().length > 0),
          ),
        ])
        .filter(([, channels]) => Object.keys(channels as object).length > 0),
    ),
  }));
}

export const notificationTemplate = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  privacy_mode: z.enum(['standard', 'privacy_safe']).default('standard'),
  /** locale → channel → body */
  variants: z.record(
    z.string(),
    z.object({
      sms: templateChannelBody.optional(),
      email: templateChannelBody.optional(),
      in_app: templateChannelBody.optional(),
    }),
  ),
});

/** Provider gateway credentials (spec 06 §2 — keys may move to vault in production). */
export const providerConnection = z.object({
  provider: z.string().optional(),
  /** API key / bearer token / SMTP password (stored encrypted at rest in production). */
  api_token: z.string().optional(),
  /** API base URL or SMTP host when required by the provider. */
  api_url: z.string().optional(),
  enabled: z.boolean().default(true),
});

export const emailSenderIdentity = providerConnection.extend({
  from_name: z.string().optional(),
  from_address: z.string().optional(),
});

export const smsSenderIdentity = providerConnection.extend({
  sender_id: z.string().optional(),
});

export const whatsappSenderIdentity = providerConnection.extend({
  /** Meta / Twilio business phone number id. */
  phone_number_id: z.string().optional(),
  /** E.164 number or display label shown to recipients. */
  display_number: z.string().optional(),
});

export const cd09Notifications = z
  .preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const data = raw as { templates?: { variants: TemplateVariants }[] };
    if (!Array.isArray(data.templates)) return raw;
    return { ...data, templates: stripEmptyTemplateVariants(data.templates) };
  }, z.object({
    rules: z.array(notificationRule).default([]),
    templates: z.array(notificationTemplate).min(1),
    senders: z
      .object({
        email: emailSenderIdentity.default({}),
        sms: smsSenderIdentity.default({}),
        whatsapp: whatsappSenderIdentity.default({}),
      })
      .default({}),
    quiet_hours: z
      .object({
        enabled: z.boolean().default(false),
        timezone: z.string().default('Africa/Nairobi'),
        start: z.string().default('21:00'),
        end: z.string().default('07:00'),
        except_emergency: z.boolean().default(true),
      })
      .default({}),
    kill_switches: z
      .array(
        z.object({
          channel: z.enum(NOTIFICATION_CHANNELS),
          scope: z.enum(['tenant', 'module']).default('tenant'),
          module: z.string().optional(),
          /** false = channel killed (messages suppressed with reason). */
          enabled: z.boolean(),
          reason: z.string().optional(),
        }),
      )
      .default([]),
    throttling: z
      .object({
        dedupe_window_minutes: z.number().int().min(0).default(60),
        daily_cap_per_recipient: z.number().int().min(0).optional(),
      })
      .default({}),
  }))
  .superRefine((cfg, ctx) => {
    const templateIds = new Set(cfg.templates.map((t) => t.id));
    const allowedVars = new Set<string>(TEMPLATE_VARIABLES);

    cfg.templates.forEach((tpl, ti) => {
      for (const [locale, channels] of Object.entries(tpl.variants)) {
        for (const [ch, body] of Object.entries(channels)) {
          if (!body?.body) continue;
          for (const v of extractTemplateVars(body.body)) {
            if (!allowedVars.has(v)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['templates', ti, 'variants', locale, ch, 'body'],
                message: `Unknown variable "{{${v}}}" — allowed: ${TEMPLATE_VARIABLES.join(', ')}`,
              });
            }
          }
          if (body.subject) {
            for (const v of extractTemplateVars(body.subject)) {
              if (!allowedVars.has(v)) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ['templates', ti, 'variants', locale, ch, 'subject'],
                  message: `Unknown variable "{{${v}}}"`,
                });
              }
            }
          }
        }
      }
    });

    cfg.rules.forEach((rule, ri) => {
      if (!templateIds.has(rule.template)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', ri, 'template'],
          message: `Unknown template "${rule.template}"`,
        });
      }
      if (rule.privacy_template && !templateIds.has(rule.privacy_template)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', ri, 'privacy_template'],
          message: `Unknown template "${rule.privacy_template}"`,
        });
      }
    });
  });

export type Cd09Notifications = z.infer<typeof cd09Notifications>;
export type NotificationRule = z.infer<typeof notificationRule>;
export type NotificationTemplate = z.infer<typeof notificationTemplate>;

/** Platform default rule pack (spec 06 §4). Tenants edit from here. */
export function defaultNotificationPack(): Cd09Notifications {
  const templates: NotificationTemplate[] = [
    {
      id: 'case-registered',
      label: 'Case registered acknowledgement',
      privacy_mode: 'standard',
      variants: {
        en: {
          sms: {
            body: '{{tenant.name}}: your grievance {{case.reference}} is registered. Track: {{tracking.url}}',
          },
          email: {
            subject: 'Grievance registered — {{case.reference}}',
            body: 'Dear complainant,\n\nYour grievance {{case.reference}} has been registered with {{tenant.name}}.\n\nStatus: {{case.status_label}}\nTrack your case: {{tracking.url}}\n\nThank you.',
          },
          in_app: {
            body: 'New case {{case.reference}} registered at {{case.unit_name}} ({{case.status_label}}).',
          },
        },
        sw: {
          sms: {
            body: '{{tenant.name}}: malalamiko {{case.reference}} yamepokelewa. Fuatilia: {{tracking.url}}',
          },
          email: {
            subject: 'Malalamiko yamepokelewa — {{case.reference}}',
            body: 'Mpendwa mlalamikaji,\n\nMalalamiko yako {{case.reference}} yamepokelewa na {{tenant.name}}.\n\nHali: {{case.status_label}}\nFuatilia kesi yako: {{tracking.url}}\n\nAsante.',
          },
          in_app: {
            body: 'Kesi mpya {{case.reference}} imepokelewa — {{case.unit_name}} ({{case.status_label}}).',
          },
        },
      },
    },
    {
      id: 'case-registered-privacy',
      label: 'Case registered (privacy-safe)',
      privacy_mode: 'privacy_safe',
      variants: {
        en: {
          sms: { body: '{{tenant.name}}: reference {{case.reference}} registered. Track: {{tracking.url}}' },
          email: {
            subject: 'Reference {{case.reference}}',
            body: 'Your submission {{case.reference}} has been registered.\nTrack: {{tracking.url}}',
          },
        },
        sw: {
          sms: { body: '{{tenant.name}}: rejeleo {{case.reference}} limepokelewa. Fuatilia: {{tracking.url}}' },
          email: {
            subject: 'Rejeleo {{case.reference}}',
            body: 'Wasilisho lako {{case.reference}} limepokelewa.\nFuatilia: {{tracking.url}}',
          },
        },
      },
    },
    {
      id: 'status-update',
      label: 'Status change notice',
      privacy_mode: 'standard',
      variants: {
        en: {
          sms: { body: '{{case.reference}}: status is now {{case.status_label}}. {{tracking.url}}' },
          email: {
            subject: 'Update on {{case.reference}}',
            body: 'Your grievance {{case.reference}} is now: {{case.status_label}}.\n\nTrack: {{tracking.url}}',
          },
        },
        sw: {
          sms: { body: '{{case.reference}}: hali ni {{case.status_label}}. {{tracking.url}}' },
          email: {
            subject: 'Taarifa kuhusu {{case.reference}}',
            body: 'Malalamiko yako {{case.reference}} sasa ni: {{case.status_label}}.\n\nFuatilia: {{tracking.url}}',
          },
        },
      },
    },
    {
      id: 'status-update-privacy',
      label: 'Status change (privacy-safe)',
      privacy_mode: 'privacy_safe',
      variants: {
        en: { sms: { body: '{{case.reference}}: status updated. {{tracking.url}}' } },
        sw: { sms: { body: '{{case.reference}}: hali imesasishwa. {{tracking.url}}' } },
      },
    },
    {
      id: 'case-assigned',
      label: 'Case assigned to officer',
      privacy_mode: 'standard',
      variants: {
        en: {
          email: {
            subject: 'Assigned: {{case.reference}}',
            body: 'Case {{case.reference}} ({{case.status_label}}) has been assigned to you.\nUnit: {{case.unit_name}}',
          },
          in_app: { body: 'Case {{case.reference}} assigned to you' },
        },
        sw: {
          email: {
            subject: 'Imekabidhiwa: {{case.reference}}',
            body: 'Kesi {{case.reference}} ({{case.status_label}}) imekabidhiwa kwako.\nEneo: {{case.unit_name}}',
          },
          in_app: { body: 'Kesi {{case.reference}} imekabidhiwa kwako' },
        },
      },
    },
    {
      id: 'case-at-risk',
      label: 'SLA at risk',
      privacy_mode: 'standard',
      variants: {
        en: {
          email: {
            subject: 'SLA at risk — {{case.reference}}',
            body: 'Case {{case.reference}} is at risk of missing its deadline ({{date.deadline}}).',
          },
          in_app: { body: 'SLA at risk: {{case.reference}}' },
        },
        sw: {
          email: {
            subject: 'SLA ina hatari — {{case.reference}}',
            body: 'Kesi {{case.reference}} inaweza kukosa muda wake ({{date.deadline}}).',
          },
          in_app: { body: 'SLA ina hatari: {{case.reference}}' },
        },
      },
    },
    {
      id: 'sla-breached',
      label: 'SLA breached',
      privacy_mode: 'standard',
      variants: {
        en: {
          email: {
            subject: 'SLA breached — {{case.reference}}',
            body: 'Case {{case.reference}} has breached its SLA deadline.',
          },
          in_app: { body: 'SLA breached: {{case.reference}}' },
        },
        sw: {
          email: {
            subject: 'SLA imevunjwa — {{case.reference}}',
            body: 'Kesi {{case.reference}} imevunja muda wa SLA.',
          },
          in_app: { body: 'SLA imevunjwa: {{case.reference}}' },
        },
      },
    },
    {
      id: 'satisfaction-request',
      label: 'Satisfaction survey request',
      privacy_mode: 'standard',
      variants: {
        en: {
          sms: { body: '{{tenant.name}}: please rate handling of {{case.reference}}: {{tracking.url}}' },
        },
        sw: {
          sms: { body: '{{tenant.name}}: tafadhali kadiria utendaji wa {{case.reference}}: {{tracking.url}}' },
        },
      },
    },
    {
      id: 'case-closed',
      label: 'Case closed',
      privacy_mode: 'standard',
      variants: {
        en: {
          sms: { body: '{{case.reference}} is closed. Thank you for using {{tenant.short_name}}.' },
          email: {
            subject: 'Case closed — {{case.reference}}',
            body: 'Your grievance {{case.reference}} has been closed.\n\nThank you,\n{{tenant.name}}',
          },
        },
        sw: {
          sms: { body: '{{case.reference}} imefungwa. Asante kwa kutumia {{tenant.short_name}}.' },
          email: {
            subject: 'Kesi imefungwa — {{case.reference}}',
            body: 'Malalamiko yako {{case.reference}} yamefungwa.\n\nAsante,\n{{tenant.name}}',
          },
        },
      },
    },
    {
      id: 'appeal-opened',
      label: 'Appeal opened',
      privacy_mode: 'standard',
      variants: {
        en: {
          email: {
            subject: 'Appeal opened — {{case.reference}}',
            body: 'An appeal has been opened for case {{case.reference}}.',
          },
          in_app: { body: 'Appeal opened: {{case.reference}}' },
        },
        sw: {
          email: {
            subject: 'Rufaa imefunguliwa — {{case.reference}}',
            body: 'Rufaa imefunguliwa kwa kesi {{case.reference}}.',
          },
          in_app: { body: 'Rufaa imefunguliwa: {{case.reference}}' },
        },
      },
    },
    {
      id: 'case-escalated',
      label: 'Case escalated / level moved',
      privacy_mode: 'standard',
      variants: {
        en: {
          email: {
            subject: 'Escalated: {{case.reference}}',
            body: 'Case {{case.reference}} moved to level {{case.level}} ({{case.status_label}}).',
          },
          in_app: { body: 'Escalated: {{case.reference}} → {{case.level}}' },
        },
        sw: {
          email: {
            subject: 'Imepandishwa: {{case.reference}}',
            body: 'Kesi {{case.reference}} imehamishwa hadi kiwango {{case.level}} ({{case.status_label}}).',
          },
          in_app: { body: 'Imepandishwa: {{case.reference}} → {{case.level}}' },
        },
      },
    },
    {
      id: 'more-info-request',
      label: 'Request more information',
      privacy_mode: 'standard',
      variants: {
        en: {
          sms: { body: '{{tenant.name}}: we need more information for {{case.reference}}. Reply or visit {{tracking.url}}' },
          email: {
            subject: 'More information needed — {{case.reference}}',
            body: 'We need additional information to progress your grievance {{case.reference}}.\n\nPlease sign in or visit: {{tracking.url}}',
          },
        },
        sw: {
          sms: { body: '{{tenant.name}}: tunahitaji taarifa zaidi kwa {{case.reference}}. Tembelea {{tracking.url}}' },
          email: {
            subject: 'Taarifa zaidi zinahitajika — {{case.reference}}',
            body: 'Tunahitaji taarifa zaidi ili kuendelea na malalamiko yako {{case.reference}}.\n\nTafadhali tembelea: {{tracking.url}}',
          },
        },
      },
    },
  ];

  const rules: NotificationRule[] = [
    {
      id: 'ack-on-create',
      name: 'Acknowledge complainant on creation',
      on: 'case.created',
      to: [{ party: 'complainant' }, { role: 'grm_officer', scope: 'unit_and_above' }],
      channels: { party: ['sms', 'email'], staff: ['email', 'in_app'] },
      template: 'case-registered',
      privacy_template: 'case-registered-privacy',
      enabled: true,
    },
    {
      id: 'status-change-complainant',
      name: 'Status update to complainant',
      on: 'case.status_changed',
      to: [{ party: 'complainant' }],
      channels: ['sms', 'email'],
      template: 'status-update',
      privacy_template: 'status-update-privacy',
      condition: { not_status: ['Referred'] },
      enabled: true,
    },
    {
      id: 'assigned-officer',
      name: 'Notify assignee',
      on: 'case.assigned',
      to: [{ user: 'assignee' }],
      channels: ['email', 'in_app'],
      template: 'case-assigned',
      enabled: true,
    },
    {
      id: 'level-moved-staff',
      name: 'Escalation / return notice',
      on: 'case.level_moved',
      to: [{ role: 'grm_officer', scope: 'unit_and_above' }],
      channels: ['email', 'in_app'],
      template: 'case-escalated',
      enabled: true,
    },
    {
      id: 'sla-at-risk',
      name: 'SLA at-risk reminder',
      on: 'sla.at_risk',
      to: [{ user: 'assignee' }],
      channels: ['email', 'in_app'],
      template: 'case-at-risk',
      enabled: true,
    },
    {
      id: 'sla-breached',
      name: 'SLA breach alert',
      on: 'sla.breached',
      to: [{ user: 'assignee' }, { role: 'grm_officer', scope: 'unit_and_above' }],
      channels: ['email', 'in_app'],
      template: 'sla-breached',
      enabled: true,
    },
    {
      id: 'satisfaction-on-resolved',
      name: 'Satisfaction survey on resolution',
      on: 'case.resolved',
      to: [{ party: 'complainant' }],
      channels: ['sms'],
      template: 'satisfaction-request',
      enabled: true,
    },
    {
      id: 'closed-complainant',
      name: 'Closure notice',
      on: 'case.closed',
      to: [{ party: 'complainant' }],
      channels: ['sms', 'email'],
      template: 'case-closed',
      enabled: true,
    },
    {
      id: 'appeal-opened',
      name: 'Appeal opened',
      on: 'appeal.opened',
      to: [{ role: 'grm_officer', scope: 'unit_and_above' }],
      channels: ['email', 'in_app'],
      template: 'appeal-opened',
      enabled: true,
    },
  ];

  return {
    templates,
    rules,
    senders: {
      email: { from_name: 'GRM', from_address: '', provider: '', api_token: '', enabled: true },
      sms: { sender_id: 'GRM', provider: '', api_token: '', enabled: true },
      whatsapp: { display_number: '', phone_number_id: '', provider: '', api_token: '', enabled: false },
    },
    quiet_hours: {
      enabled: false,
      timezone: 'Africa/Nairobi',
      start: '21:00',
      end: '07:00',
      except_emergency: true,
    },
    kill_switches: [],
    throttling: { dedupe_window_minutes: 60 },
  };
}
