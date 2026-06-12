import { z } from 'zod';

/**
 * CD-02 Administrative hierarchy: ordered level definitions, arbitrary depth (spec 02).
 * The array is stored lowest (intake) level first. Each level may explicitly name its
 * parent level via parent_code; when present, the links must agree with the array order
 * (a single linear chain ending in a parentless top level).
 */
export const cd02Hierarchy = z.object({
  levels: z
    .array(
      z.object({
        code: z.string().min(1),
        label: z.string().min(1),
        /** Code of the level directly above; null/omitted only for the top level. */
        parent_code: z.string().nullable().optional(),
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
  // Parent links are optional (legacy payloads), but when declared they must match
  // the stored order: levels[i] is parented by levels[i+1], top level has no parent.
  cfg.levels.forEach((level, i) => {
    if (level.parent_code === undefined) return;
    const expected = cfg.levels[i + 1]?.code ?? null;
    if (level.parent_code !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['levels', i, 'parent_code'],
        message:
          expected === null
            ? `Top level "${level.code}" cannot have a parent`
            : `Level "${level.code}" must be parented by "${expected}" to form a single chain`,
      });
    }
  });
});

export type Cd02Hierarchy = z.infer<typeof cd02Hierarchy>;
