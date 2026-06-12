import { z } from 'zod';

/**
 * CD-07 Reference numbering (spec 02).
 * Pattern tokens: {YYYY} year, {TENANT} tenant code, {seq:N} zero-padded sequence.
 */
export const cd07Numbering = z.object({
  pattern: z.string().min(3).refine((p) => p.includes('{seq'), {
    message: 'Pattern must contain a {seq:N} token',
  }),
  scope: z.enum(['global', 'yearly']).default('yearly'),
  /** Whether public status lookup requires a verifier (phone/email/PIN). Recommended: true. */
  verifier_required: z.boolean().default(true),
});

export type Cd07Numbering = z.infer<typeof cd07Numbering>;
