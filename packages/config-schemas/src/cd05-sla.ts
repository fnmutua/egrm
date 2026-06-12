import { z } from 'zod';

/**
 * Duration token: immediate, or N{d|h|m} with optional _working suffix.
 * Examples: immediate, 7d, 14d_working, 48h
 */
const duration = z.union([
  z.literal('immediate'),
  z.string().regex(/^\d+[dhm](?:_working)?$/, 'Use e.g. 7d, 14d_working, 48h, or immediate'),
]);

const slaPlan = z.object({
  code: z.string().min(1),
  label: z.string().optional(),
  /** Working time uses the bound calendar; calendar time counts 24/7. */
  time_mode: z.enum(['working', 'calendar']).default('working'),
  calendar_code: z.string().optional(),
  acknowledge_within: duration.optional(),
  first_response_within: duration.optional(),
  resolve_within: duration.optional(),
  /** Per-workflow-status stage limits (KISIP-style). Keys are status names from CD-04. */
  stage_durations: z.record(z.string(), duration).optional(),
  is_default: z.boolean().default(false),
});

const calendar = z.object({
  code: z.string().min(1),
  label: z.string().optional(),
  timezone: z.string().default('Africa/Nairobi'),
  /** 0=Sunday … 6=Saturday */
  working_days: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  start_hour: z.number().int().min(0).max(23).default(8),
  end_hour: z.number().int().min(0).max(23).default(17),
  holidays: z.array(z.string()).default([]),
});

const reminder = z.object({
  /** Lead time before breach, e.g. T-2d, T-1d */
  at: z.string().min(1),
  notify: z.enum(['assignee', 'supervisor']).default('assignee'),
  role: z.string().optional(),
});

const escalationRule = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  trigger: z.object({
    clock: z.enum(['acknowledge', 'first_response', 'resolution', 'stage']).optional(),
    state: z.enum(['at_risk', 'breached']).optional(),
    on: z.enum(['case_created', 'satisfaction_recorded']).optional(),
  }),
  condition: z.record(z.string(), z.unknown()).optional(),
  actions: z.array(z.record(z.string(), z.unknown())).min(1),
});

/** CD-05 SLA plans, calendars, reminder ladder, and escalation rules (spec 02, spec 04 §4–5). */
export const cd05Sla = z.object({
  default_plan: z.string().optional(),
  plans: z.array(slaPlan).min(1),
  calendars: z.array(calendar).default([]),
  default_calendar: z.string().optional(),
  reminders: z.array(reminder).default([]),
  escalation_rules: z.array(escalationRule).default([]),
}).superRefine((cfg, ctx) => {
  const planCodes = cfg.plans.map((p) => p.code);
  if (new Set(planCodes).size !== planCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['plans'], message: 'Plan codes must be unique' });
  }
  const calCodes = new Set(cfg.calendars.map((c) => c.code));
  if (cfg.default_plan && !planCodes.includes(cfg.default_plan)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_plan'], message: `Unknown plan "${cfg.default_plan}"` });
  }
  if (cfg.default_calendar && !calCodes.has(cfg.default_calendar)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['default_calendar'], message: `Unknown calendar "${cfg.default_calendar}"` });
  }
  if (cfg.plans.filter((p) => p.is_default).length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['plans'], message: 'At most one plan can be the default' });
  }
  cfg.plans.forEach((p, i) => {
    if (p.calendar_code && p.time_mode === 'working' && !calCodes.has(p.calendar_code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plans', i, 'calendar_code'],
        message: `Unknown calendar "${p.calendar_code}"`,
      });
    }
  });
  cfg.calendars.forEach((c, i) => {
    if (c.start_hour >= c.end_hour) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calendars', i],
        message: 'start_hour must be before end_hour',
      });
    }
  });
  const ruleNames = cfg.escalation_rules.map((r) => r.name);
  if (new Set(ruleNames).size !== ruleNames.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['escalation_rules'], message: 'Escalation rule names must be unique' });
  }
});

export type Cd05Sla = z.infer<typeof cd05Sla>;
