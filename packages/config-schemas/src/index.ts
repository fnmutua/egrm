import { z } from 'zod';
import type { ConfigDomain } from '@egrm/core';
import { cd01Identity } from './cd01-identity.js';
import { cd02Hierarchy } from './cd02-hierarchy.js';
import { cd04Workflow } from './cd04-workflow.js';
import { cd06IntakeForms } from './cd06-intake-forms.js';
import { cd07Numbering } from './cd07-numbering.js';
import { cd14Features } from './cd14-features.js';

export * from './cd01-identity.js';
export * from './cd02-hierarchy.js';
export * from './cd04-workflow.js';
export * from './cd06-intake-forms.js';
export * from './cd07-numbering.js';
export * from './cd14-features.js';

/** Domains not yet strictly modeled accept any object during Phase 0/1; tightened per phase. */
const permissive = z.record(z.string(), z.unknown());

export const CONFIG_SCHEMAS: Record<ConfigDomain, z.ZodTypeAny> = {
  cd01_identity: cd01Identity,
  cd02_hierarchy: cd02Hierarchy,
  cd03_taxonomy: permissive,
  cd04_workflow: cd04Workflow,
  cd05_sla: permissive,
  cd06_intake_forms: cd06IntakeForms,
  cd07_numbering: cd07Numbering,
  cd08_channels: permissive,
  cd09_notifications: permissive,
  cd10_org_access: permissive,
  cd11_committees: permissive,
  cd12_referrals: permissive,
  cd13_reporting: permissive,
  cd15_dashboards: permissive,
  cd14_features: cd14Features,
  cd16_ai: permissive,
};

export function validateConfig(domain: ConfigDomain, payload: unknown) {
  return CONFIG_SCHEMAS[domain].safeParse(payload);
}
