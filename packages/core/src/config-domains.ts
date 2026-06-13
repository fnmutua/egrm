/** Config domain identifiers (spec 02 §2). */
export const CONFIG_DOMAINS = [
  'cd01_identity',
  'cd02_hierarchy',
  'cd03_taxonomy',
  'cd04_workflow',
  'cd05_sla',
  'cd06_intake_forms',
  'cd07_numbering',
  'cd08_channels',
  'cd09_notifications',
  'cd10_org_access',
  'cd11_committees',
  'cd12_referrals',
  'cd13_reporting',
  'cd14_features',
  'cd15_dashboards',
  'cd16_ai',
  'cd17_correspondence',
] as const;

export type ConfigDomain = (typeof CONFIG_DOMAINS)[number];

export type ConfigVersionStatus = 'draft' | 'active' | 'retired';
