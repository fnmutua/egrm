import { z } from 'zod';

/** CD-02 Administrative hierarchy: ordered level definitions, arbitrary depth (spec 02). */
export const cd02Hierarchy = z.object({
  levels: z
    .array(
      z.object({
        code: z.string().min(1),
        label: z.string().min(1),
        is_intake_default: z.boolean().default(false),
        is_confirmation_authority: z.boolean().default(false),
        can_be_assigned: z.boolean().default(true),
      }),
    )
    .min(1),
}).superRefine((cfg, ctx) => {
  const codes = cfg.levels.map((l) => l.code);
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['levels'], message: 'Level codes must be unique' });
  }
  if (!cfg.levels.some((l) => l.is_intake_default)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['levels'],
      message: 'Exactly one level must be marked is_intake_default',
    });
  }
});

export type Cd02Hierarchy = z.infer<typeof cd02Hierarchy>;
