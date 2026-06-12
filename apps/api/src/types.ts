export type { Cd01Identity, Cd02Hierarchy, Cd04Workflow, Cd06IntakeForms, Cd07Numbering } from '@egrm/config-schemas';

/** CD-03 is schema-permissive until Phase 2; this is the shape the seed uses. */
export interface Cd03Taxonomy {
  categories?: { code: string; label: Record<string, string> }[];
}
