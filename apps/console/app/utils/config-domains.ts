/** Display catalogue for the 16 config domains (spec 02). */
export interface DomainMeta {
  domain: string;
  cd: string;
  title: string;
  description: string;
  icon: string;
  /** Domains with strict zod schemas server-side; others are free-form JSON until later phases. */
  strict: boolean;
  /** In-page anchors shown as sub-items in the admin sidebar. */
  subsections?: { id: string; label: string }[];
}

export const CD08_SUBSECTIONS = [
  { id: 'sec-public', label: 'Other ways to reach us' },
  { id: 'sec-modules', label: 'Intake modules' },
];

export const CD06_SUBSECTIONS = [
  { id: 'sec-general', label: 'Form settings' },
  { id: 'sec-complainant', label: 'Complainant' },
  { id: 'sec-grievance', label: 'Grievance' },
  { id: 'sec-outcome', label: 'Expected outcome' },
];

export const CD10_SUBSECTIONS = [
  { id: 'sec-roles', label: 'Roles & permissions' },
  { id: 'sec-departments', label: 'Departments' },
  { id: 'sec-auth', label: 'Authentication policy' },
];

export const CD01_SUBSECTIONS = [
  { id: 'sec-identity', label: 'Identity' },
  { id: 'sec-languages', label: 'Languages' },
  { id: 'sec-branding', label: 'Colors & logos' },
  { id: 'sec-hero', label: 'Hero' },
  { id: 'sec-how', label: 'How it works' },
  { id: 'sec-channels', label: 'Channels' },
  { id: 'sec-about', label: 'About' },
  { id: 'sec-statements', label: 'Statements' },
  { id: 'sec-faq', label: 'FAQ' },
  { id: 'sec-footer', label: 'Footer & contact' },
];

export const CD03_SUBSECTIONS = [
  { id: 'sec-categories', label: 'Categories' },
  { id: 'sec-classes', label: 'Sensitivity classes' },
  { id: 'sec-priorities', label: 'Priorities' },
];

export const CD04_SUBSECTIONS = [
  { id: 'sec-overview', label: 'Overview' },
  { id: 'sec-statuses', label: 'Statuses' },
  { id: 'sec-initial', label: 'Initial status' },
  { id: 'sec-transitions', label: 'Transitions' },
  { id: 'sec-closure', label: 'Closure policy' },
  { id: 'sec-appeal', label: 'Appeals' },
];

export const CD05_SUBSECTIONS = [
  { id: 'sec-overview', label: 'Overview' },
  { id: 'sec-plans', label: 'SLA plans' },
  { id: 'sec-calendars', label: 'Calendars' },
  { id: 'sec-reminders', label: 'Reminders' },
  { id: 'sec-escalation', label: 'Escalation rules' },
];

/** An entry in an admin section: either a config domain editor or a standalone admin page. */
export type AdminEntry =
  | { type: 'domain'; domain: string }
  | { type: 'page'; label: string; icon: string; to: string; description: string };

/** Sidebar grouping for the admin area, in display order. Related tools live together. */
export const ADMIN_SECTIONS: { label: string; icon?: string; entries: AdminEntry[] }[] = [
  { label: 'Identity', entries: [{ type: 'domain', domain: 'cd01_identity' }] },
  { label: 'Roles & permissions', entries: [{ type: 'domain', domain: 'cd10_org_access' }] },
  {
    label: 'Jurisdiction & hierarchy',
    icon: 'i-lucide-network',
    entries: [
      { type: 'domain', domain: 'cd02_hierarchy' },
      {
        type: 'page',
        label: 'Jurisdiction units',
        icon: 'i-lucide-map-pin',
        to: '/admin/units',
        description: 'The unit tree itself: instances of the hierarchy levels (counties, settlements, …).',
      },
    ],
  },
  {
    label: 'Case setup',
    entries: [
      { type: 'domain', domain: 'cd03_taxonomy' },
      { type: 'domain', domain: 'cd04_workflow' },
      { type: 'domain', domain: 'cd05_sla' },
      { type: 'domain', domain: 'cd07_numbering' },
    ],
  },
  {
    label: 'Intake & channels',
    entries: [
      { type: 'domain', domain: 'cd06_intake_forms' },
      { type: 'domain', domain: 'cd08_channels' },
    ],
  },
  {
    label: 'Organisation',
    entries: [
      { type: 'domain', domain: 'cd11_committees' },
      { type: 'domain', domain: 'cd12_referrals' },
    ],
  },
  { label: 'Communication', entries: [{ type: 'domain', domain: 'cd09_notifications' }] },
  {
    label: 'Platform',
    entries: [
      { type: 'domain', domain: 'cd13_reporting' },
      { type: 'domain', domain: 'cd14_features' },
      { type: 'domain', domain: 'cd15_dashboards' },
      { type: 'domain', domain: 'cd16_ai' },
    ],
  },
];

export const DOMAIN_CATALOGUE: DomainMeta[] = [
  { domain: 'cd01_identity', cd: 'CD-01', title: 'Identity & branding', icon: 'i-lucide-palette', strict: true,
    description: 'Tenant name, locales, colors, and the mandatory free-of-charge / non-retaliation / confidentiality statements.',
    subsections: CD01_SUBSECTIONS },
  { domain: 'cd02_hierarchy', cd: 'CD-02', title: 'Administrative hierarchy', icon: 'i-lucide-network', strict: true,
    description: 'Ordered jurisdiction levels (arbitrary depth). The unit tree itself is managed under Units.' },
  { domain: 'cd03_taxonomy', cd: 'CD-03', title: 'Case taxonomy', icon: 'i-lucide-tags', strict: true,
    description: 'Grievance categories shown at intake, sensitivity classes for protected handling, and the priority ladder.',
    subsections: CD03_SUBSECTIONS },
  { domain: 'cd04_workflow', cd: 'CD-04', title: 'Workflow', icon: 'i-lucide-git-branch', strict: true,
    description: 'Case lifecycle: statuses with semantic tags, transitions (roles, effects, guards), closure confirmation, and appeals.',
    subsections: CD04_SUBSECTIONS },
  { domain: 'cd05_sla', cd: 'CD-05', title: 'SLA plans & calendars', icon: 'i-lucide-timer', strict: true,
    description: 'Acknowledgement/response/resolution targets, per-status durations, working calendars, reminder ladder, and auto-escalation rules.',
    subsections: CD05_SUBSECTIONS },
  { domain: 'cd06_intake_forms', cd: 'CD-06', title: 'Intake forms', icon: 'i-lucide-clipboard-list', strict: true,
    description: 'The standardized intake dataset: field-by-field enablement, requiredness, labels per locale, options, anonymity policy, consent text.',
    subsections: CD06_SUBSECTIONS },
  { domain: 'cd07_numbering', cd: 'CD-07', title: 'Reference numbering', icon: 'i-lucide-hash', strict: true,
    description: 'Reference pattern (e.g. GRM-{YYYY}-{seq:4}), sequence scope, verifier requirement for public tracking.' },
  { domain: 'cd08_channels', cd: 'CD-08', title: 'Channels', icon: 'i-lucide-radio', strict: true,
    description: 'Public contact routes (portal landing page) and intake channel module enablement.',
    subsections: CD08_SUBSECTIONS },
  { domain: 'cd09_notifications', cd: 'CD-09', title: 'Notifications', icon: 'i-lucide-bell', strict: false,
    description: 'Event subscriptions, recipient selectors, templates per locale and channel, kill switches, sender identities.' },
  { domain: 'cd10_org_access', cd: 'CD-10', title: 'Org & access', icon: 'i-lucide-shield', strict: true,
    description: 'Role definitions (permission sets), departments/teams, and authentication policy. Roles sync to the database on activation.',
    subsections: CD10_SUBSECTIONS },
  { domain: 'cd11_committees', cd: 'CD-11', title: 'Committees', icon: 'i-lucide-users', strict: false,
    description: 'Committee definitions per level, rosters, workflow bindings for decision records.' },
  { domain: 'cd12_referrals', cd: 'CD-12', title: 'Referral directory', icon: 'i-lucide-external-link', strict: false,
    description: 'External institutions (ombudsman, police, GBV services) and per-category referral policy.' },
  { domain: 'cd13_reporting', cd: 'CD-13', title: 'Reporting & retention', icon: 'i-lucide-file-bar-chart', strict: false,
    description: 'KPI targets, transparency page, scheduled reports, retention policies, export field policies.' },
  { domain: 'cd14_features', cd: 'CD-14', title: 'Feature flags', icon: 'i-lucide-toggle-right', strict: true,
    description: 'Module activation: knowledge base, tasks, committees, appeals, USSD, hotline, chatbot, AI assistance, custom dashboards…' },
  { domain: 'cd15_dashboards', cd: 'CD-15', title: 'Dashboards', icon: 'i-lucide-layout-dashboard', strict: false,
    description: 'Admin-built dashboards: sections and declarative widgets over the semantic layer.' },
  { domain: 'cd16_ai', cd: 'CD-16', title: 'Chatbot & AI', icon: 'i-lucide-bot', strict: false,
    description: 'AI provider profiles, chatbot persona/intents, per-capability flags, safety policy. Default off.' },
];

export const domainMeta = (domain: string) => DOMAIN_CATALOGUE.find((d) => d.domain === domain);
