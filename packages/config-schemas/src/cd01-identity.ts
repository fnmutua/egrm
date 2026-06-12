import { z } from 'zod';

/** CD-01 Tenant identity & branding (spec 02). */
export const localizedText = z.record(z.string().min(2).max(8), z.string());

/** Chromatic palette colors supported by the Nuxt UI design system. */
export const PALETTE_COLORS = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
] as const;

/** Neutral (gray-scale) palette colors supported by the Nuxt UI design system. */
export const NEUTRAL_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const;

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
    favicon_url: z.string().optional(),
    /** Semantic palette colors (Nuxt UI design system) — themed across all components. */
    primary: z.enum(PALETTE_COLORS).default('blue'),
    secondary: z.enum(PALETTE_COLORS).default('amber'),
    neutral: z.enum(NEUTRAL_COLORS).default('slate'),
    /** @deprecated legacy free hex values, superseded by the palette fields above. */
    primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** Co-branding (implementing agency, donor) shown in about/footer. */
    partner_logos: z
      .array(z.object({ name: z.string().min(1), image_url: z.string().min(1), link: z.string().optional() }))
      .optional(),
  }),
  /** Mandatory display items — presence enforced (KUSP2 FR-PUB-12/14). */
  statements: z.object({
    free_of_charge: localizedText,
    non_retaliation: localizedText,
    confidentiality: localizedText,
  }),
  /** Landing page hero. Falls back to a generic headline when absent. */
  hero: z
    .object({
      title: localizedText,
      subtitle: localizedText.optional(),
      image_url: z.string().optional(),
    })
    .optional(),
  /** "How it works" process steps, rendered in order. */
  how_it_works: z
    .array(z.object({ title: localizedText, description: localizedText.optional() }))
    .optional(),
  /**
   * @deprecated Use CD-08 `public_channels` — kept for legacy portal fallback only.
   * Other intake routes advertised on the landing page (display-only; CD-08 governs behaviour).
   */
  channels_display: z
    .array(
      z.object({
        type: z.enum(['hotline', 'ussd', 'email', 'office']),
        value: z.string().min(1),
      }),
    )
    .min(1, 'At least one channel must remain')
    .optional(),
  about: z
    .object({
      heading: localizedText.optional(),
      body: localizedText,
    })
    .optional(),
  faq: z.array(z.object({ question: localizedText, answer: localizedText })).optional(),
  footer: z
    .object({
      address: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      privacy_note: localizedText.optional(),
    })
    .optional(),
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
