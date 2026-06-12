import { z } from 'zod';

/** CD-01 Tenant identity & branding (spec 02). */
export const localizedText = z.record(z.string().min(2).max(8), z.string());

export const cd01Identity = z.object({
  name: z.string().min(1),
  legal_name: z.string().optional(),
  programme: z.string().optional(),
  locales: z.object({
    default: z.string().min(2),
    enabled: z.array(z.string().min(2)).min(1),
  }),
  timezone: z.string().default('Africa/Nairobi'),
  branding: z.object({
    logo_url: z.string().optional(),
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#0f3a5e'),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  /** Mandatory display items — presence enforced (KUSP2 FR-PUB-12/14). */
  statements: z.object({
    free_of_charge: localizedText,
    non_retaliation: localizedText,
    confidentiality: localizedText,
  }),
}).superRefine((cfg, ctx) => {
  for (const [key, text] of Object.entries(cfg.statements)) {
    for (const locale of cfg.locales.enabled) {
      if (!text[locale]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['statements', key],
          message: `Missing '${locale}' text for mandatory statement '${key}'`,
        });
      }
    }
  }
});

export type Cd01Identity = z.infer<typeof cd01Identity>;
