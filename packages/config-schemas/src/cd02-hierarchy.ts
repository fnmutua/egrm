import { z } from 'zod';

/**
 * CD-02 Administrative hierarchy: ordered level definitions, arbitrary depth (spec 02).
 * The array is stored lowest level first. Each level may explicitly name its
 * parent level via parent_code; when present, the links must agree with the array order
 * (a single linear chain ending in a parentless top level).
 */
const levelSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  /** Code of the level directly above; null/omitted only for the top level. */
  parent_code: z.string().nullable().optional(),
  /** Public / assisted intake may target units at this level. Multiple levels may allow intake. */
  allows_intake: z.boolean().default(false),
  /** @deprecated Legacy alias — normalized to allows_intake on read. */
  is_intake_default: z.boolean().default(false),
  is_confirmation_authority: z.boolean().default(false),
  can_be_assigned: z.boolean().default(true),
});

export const cd02Hierarchy = z.preprocess((input) => {
  if (!input || typeof input !== 'object') return input;
  const cfg = input as { levels?: Array<Record<string, unknown>> };
  if (!Array.isArray(cfg.levels)) return input;
  return {
    ...cfg,
    levels: cfg.levels.map((l) => ({
      ...l,
      allows_intake: l.allows_intake ?? l.is_intake_default ?? false,
    })),
  };
}, z.object({
  levels: z.array(levelSchema).min(1),
}).superRefine((cfg, ctx) => {
  const codes = cfg.levels.map((l) => l.code);
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['levels'], message: 'Level codes must be unique' });
  }
  if (!cfg.levels.some((l) => l.allows_intake)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['levels'],
      message: 'At least one level must allow intake',
    });
  }
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
}));

export type Cd02Hierarchy = z.infer<typeof cd02Hierarchy>;
export type HierarchyLevel = Cd02Hierarchy['levels'][number];

/** True when this level accepts public or assisted intake (supports legacy is_intake_default). */
export function levelAllowsIntake(level: Pick<HierarchyLevel, 'allows_intake' | 'is_intake_default'>): boolean {
  return Boolean(level.allows_intake || level.is_intake_default);
}

/** Levels that accept intake; falls back to the lowest level if none are flagged. */
export function intakeLevels(hierarchy: Cd02Hierarchy): HierarchyLevel[] {
  const allowed = hierarchy.levels.filter(levelAllowsIntake);
  return allowed.length > 0 ? allowed : [hierarchy.levels[0]!];
}
