/**
 * Semantic status tags (spec 02 CD-04, spec 08 §1).
 * Tenant workflows name their statuses freely; every status maps to one of
 * these tags so reporting and SLA logic work across tenants.
 */
export const SEMANTIC_TAGS = [
  'open',
  'in_progress',
  'resolved',
  'closed',
  'rejected',
  'on_hold',
  'appeal',
] as const;

export type SemanticTag = (typeof SEMANTIC_TAGS)[number];

/** Tags counting toward "active caseload". */
export const ACTIVE_TAGS: readonly SemanticTag[] = ['open', 'in_progress', 'on_hold', 'appeal'];

/** Tags from which no further complainant-driven action is expected. */
export const TERMINAL_TAGS: readonly SemanticTag[] = ['closed', 'rejected'];
