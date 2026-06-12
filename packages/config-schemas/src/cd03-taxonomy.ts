import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

/**
 * CD-03 Case taxonomy (spec 02): categories complainants pick from, the
 * sensitivity classes they can bind to, and the priority ladder. Categories
 * are ordered as displayed on intake forms.
 */
export const cd03Taxonomy = z.object({
  categories: z
    .array(
      z.object({
        code: z.string().min(1),
        label: localizedText,
        description: localizedText.optional(),
        /** Binds the handling policy; must reference a declared sensitivity class. */
        sensitivity_class: z.string().optional(),
        /** Inactive categories are hidden from intake but kept for historical cases. */
        active: z.boolean().default(true),
      }),
    )
    .min(1),
  sensitivity_classes: z
    .array(
      z.object({
        code: z.string().min(1),
        label: localizedText,
        description: localizedText.optional(),
        /** Restricted classes hide PII/details from staff without sensitive:read. */
        restricted: z.boolean().default(false),
      }),
    )
    .default([]),
  priorities: z
    .array(
      z.object({
        code: z.string().min(1),
        label: localizedText,
        /** Multiplies the SLA plan durations; 1 = unchanged, 0.5 = half the time. */
        sla_multiplier: z.number().positive().default(1),
        is_default: z.boolean().default(false),
      }),
    )
    .default([]),
}).superRefine((cfg, ctx) => {
  for (const [key, list] of [
    ['categories', cfg.categories],
    ['sensitivity_classes', cfg.sensitivity_classes],
    ['priorities', cfg.priorities],
  ] as const) {
    const codes = list.map((i) => i.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} codes must be unique` });
    }
  }
  if (!cfg.categories.some((c) => c.active)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['categories'],
      message: 'At least one category must be active',
    });
  }
  const classCodes = new Set(cfg.sensitivity_classes.map((s) => s.code));
  cfg.categories.forEach((c, i) => {
    if (c.sensitivity_class && !classCodes.has(c.sensitivity_class)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['categories', i, 'sensitivity_class'],
        message: `Unknown sensitivity class "${c.sensitivity_class}"`,
      });
    }
  });
  if (cfg.priorities.filter((p) => p.is_default).length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priorities'],
      message: 'At most one priority can be the default',
    });
  }
});

export type Cd03Taxonomy = z.infer<typeof cd03Taxonomy>;
