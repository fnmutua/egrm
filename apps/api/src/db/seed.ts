/** Seed the dev database with the KISIP reference tenant (tenant profile, doc 11). */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import type { ConfigDomain } from '@egrm/core';
import { validateConfig, defaultNotificationPack } from '@egrm/config-schemas';
import { db, pool, schema } from './client.js';
import { syncRolesFromOrgAccess } from '../services/org-access.js';

/** KISIP CD-10 role catalogue (spec 11, aligned with plus-admin patterns). */
export const kisipOrgAccess = {
  roles: [
    {
      name: 'administrator',
      label: 'Platform administrator',
      description: 'Full configuration and case oversight; separate from day-to-day GRM handling.',
      permissions: ['admin:*', 'case:*', 'thread:*', 'attachment:*', 'report:*', 'dashboard:manage', 'task:manage'],
      sensitive_classes: [],
      mfa_required: true,
    },
    {
      name: 'grm_officer',
      label: 'GRM officer',
      description: 'Settlement/county grievance handling at assigned jurisdiction.',
      permissions: [
        'case:read', 'case:create_assisted', 'case:transition', 'case:assign',
        'thread:reply_external', 'thread:note_internal', 'thread:read',
        'attachment:upload', 'attachment:download', 'task:manage',
      ],
      sensitive_classes: [],
      mfa_required: false,
    },
    {
      name: 'grm_officer_national',
      label: 'National GRM officer',
      description: 'Escalated cases, closure confirmation, sensitive routing.',
      permissions: ['case:*', 'thread:*', 'attachment:*', 'report:view', 'sensitive:read', 'sensitive:handle', 'task:manage'],
      sensitive_classes: [],
      mfa_required: false,
    },
    {
      name: 'gbv_officer',
      label: 'GBV / SEAH focal',
      description: 'Designated handler for GBV/SEAH sensitivity class.',
      permissions: [
        'case:read', 'case:transition', 'case:assign', 'thread:*', 'attachment:*',
        'sensitive:read', 'sensitive:handle', 'task:manage',
      ],
      sensitive_classes: ['gbv_seah'],
      mfa_required: true,
    },
    {
      name: 'me_analyst',
      label: 'M&E analyst',
      description: 'Read-only operational and aggregate reporting.',
      permissions: ['report:view', 'report:export'],
      sensitive_classes: [],
      mfa_required: false,
    },
  ],
  departments: [
    { code: 'national_grm', name: 'National GRM unit', description: 'Programme-wide coordination' },
    { code: 'county_coordination', name: 'County coordination', description: 'County-level GRM focal points' },
  ],
  auth_policy: {
    password_min_length: 12,
    session_idle_minutes: 60,
    mfa_required_roles: ['administrator', 'gbv_officer'],
  },
};

async function upsertActiveConfig(tenantId: string, domain: ConfigDomain, payload: unknown, changedBy: string) {
  const parsed = validateConfig(domain, payload);
  if (!parsed.success) {
    throw new Error(`Seed config invalid for ${domain}: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  const existing = await db
    .select({ id: schema.configVersion.id })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, domain),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(schema.configVersion).values({
    tenantId,
    domain,
    version: 1,
    status: 'active',
    payload: parsed.data,
    changeNote: 'seed',
    changedBy,
    activatedAt: new Date(),
  });
}

/** Full landing-page branding for the KISIP reference tenant (CD-01). */
export const kisipIdentity = {
  name: 'KISIP GRM',
  legal_name: 'Kenya Informal Settlements Improvement Project',
  programme: 'Kenya Informal Settlements Improvement Project (KISIP)',
  locales: { default: 'en', enabled: ['en', 'sw'] },
  timezone: 'Africa/Nairobi',
  branding: { primary: 'blue', secondary: 'amber', neutral: 'slate' },
  statements: {
    free_of_charge: {
      en: 'Submitting a grievance is completely free of charge.',
      sw: 'Kuwasilisha malalamiko ni bure kabisa.',
    },
    non_retaliation: {
      en: 'No one will face retaliation for submitting a grievance.',
      sw: 'Hakuna mtu atakayedhulumiwa kwa kuwasilisha malalamiko.',
    },
    confidentiality: {
      en: 'Your information is handled confidentially.',
      sw: 'Taarifa zako zinashughulikiwa kwa siri.',
    },
  },
  hero: {
    title: {
      en: 'Report a grievance about KISIP works in your settlement',
      sw: 'Wasilisha malalamiko kuhusu kazi za KISIP katika makazi yako',
    },
    subtitle: {
      en: 'Free, confidential, and answered within published timelines. You can also track an existing case with your reference number.',
      sw: 'Bure, kwa siri, na hujibiwa ndani ya muda uliowekwa. Unaweza pia kufuatilia kesi iliyopo kwa nambari yako ya kumbukumbu.',
    },
  },
  how_it_works: [
    {
      title: { en: 'Submit', sw: 'Wasilisha' },
      description: {
        en: 'Online, by phone, or at your county KISIP office. You may remain anonymous.',
        sw: 'Mtandaoni, kwa simu, au katika ofisi ya KISIP ya kaunti yako. Unaweza kubaki bila kujulikana.',
      },
    },
    {
      title: { en: 'Acknowledged', sw: 'Imepokelewa' },
      description: {
        en: 'You receive a reference number immediately and an acknowledgement within 2 working days.',
        sw: 'Unapokea nambari ya kumbukumbu mara moja na uthibitisho ndani ya siku 2 za kazi.',
      },
    },
    {
      title: { en: 'Investigated', sw: 'Inachunguzwa' },
      description: {
        en: 'The responsible team investigates and works on a resolution within 30 days.',
        sw: 'Timu husika huchunguza na kutafuta suluhisho ndani ya siku 30.',
      },
    },
    {
      title: { en: 'Resolved', sw: 'Imetatuliwa' },
      description: {
        en: 'You are informed of the outcome. If unsatisfied, you can appeal within 30 days.',
        sw: 'Unafahamishwa matokeo. Usiporidhika, unaweza kukata rufaa ndani ya siku 30.',
      },
    },
  ],
  channels_display: [
    { type: 'hotline', value: '0800 720 720' },
    { type: 'email', value: 'grm@kisip.go.ke' },
    { type: 'office', value: 'County KISIP coordination offices' },
    { type: 'office', value: 'Settlement Executive Committee (SEC) offices' },
  ],
  about: {
    heading: { en: 'About this mechanism', sw: 'Kuhusu utaratibu huu' },
    body: {
      en: 'The Kenya Informal Settlements Improvement Project (KISIP) improves living conditions in informal settlements through tenure regularization and infrastructure investment. This grievance redress mechanism lets residents and other stakeholders raise concerns about project activities — including land and compensation, construction works, environmental and social impacts — and receive a documented response.',
      sw: 'Mradi wa Kuboresha Makazi Yasiyo Rasmi Kenya (KISIP) unaboresha hali ya maisha katika makazi yasiyo rasmi kupitia urasimishaji wa umiliki na uwekezaji wa miundombinu. Utaratibu huu wa kushughulikia malalamiko unawawezesha wakazi na wadau wengine kuibua hoja kuhusu shughuli za mradi — ikiwemo ardhi na fidia, kazi za ujenzi, athari za kimazingira na kijamii — na kupata majibu yaliyorekodiwa.',
    },
  },
  faq: [
    {
      question: { en: 'Who can submit a grievance?', sw: 'Nani anaweza kuwasilisha malalamiko?' },
      answer: {
        en: 'Anyone affected by or concerned about KISIP activities: residents, workers, business owners, or organizations.',
        sw: 'Yeyote aliyeathiriwa au mwenye wasiwasi kuhusu shughuli za KISIP: wakazi, wafanyakazi, wafanyabiashara, au mashirika.',
      },
    },
    {
      question: { en: 'Can I remain anonymous?', sw: 'Naweza kubaki bila kujulikana?' },
      answer: {
        en: 'Yes. You can submit without giving your name. Keep your reference number safe — it is the only way to follow up on an anonymous case.',
        sw: 'Ndiyo. Unaweza kuwasilisha bila kutoa jina lako. Tunza nambari yako ya kumbukumbu — ndiyo njia pekee ya kufuatilia kesi isiyo na jina.',
      },
    },
    {
      question: { en: 'How long will it take?', sw: 'Itachukua muda gani?' },
      answer: {
        en: 'You get an acknowledgement within 2 working days and a resolution target of 30 days. Complex cases may take longer; you will be kept informed.',
        sw: 'Unapata uthibitisho ndani ya siku 2 za kazi na lengo la utatuzi ni siku 30. Kesi ngumu zaweza kuchukua muda zaidi; utaendelea kufahamishwa.',
      },
    },
    {
      question: { en: 'What happens to my personal data?', sw: 'Data yangu binafsi inatumikaje?' },
      answer: {
        en: 'Your details are encrypted, visible only to authorized GRM staff, and used solely to process your grievance in line with the privacy notice.',
        sw: 'Taarifa zako zimesimbwa, zinaonekana tu kwa wafanyakazi walioidhinishwa wa GRM, na hutumika tu kushughulikia malalamiko yako kwa mujibu wa taarifa ya faragha.',
      },
    },
  ],
  footer: {
    address: 'State Department for Housing and Urban Development, P.O. Box 30450-00100, Nairobi',
    phone: '0800 720 720',
    email: 'grm@kisip.go.ke',
    privacy_note: {
      en: 'Personal data is processed in accordance with the Data Protection Act, 2019.',
      sw: 'Data binafsi inashughulikiwa kwa mujibu wa Sheria ya Ulinzi wa Data, 2019.',
    },
  },
};

export async function runSeed() {
  const extraHostnames = (process.env.SEED_TENANT_HOSTNAMES ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const seedHostnames = ['localhost', ...extraHostnames];

  // Tenant
  let [kisip] = await db.select().from(schema.tenant).where(eq(schema.tenant.code, 'kisip')).limit(1);
  if (!kisip) {
    [kisip] = await db
      .insert(schema.tenant)
      .values({ code: 'kisip', name: 'KISIP — Kenya Informal Settlements Improvement Project', hostnames: seedHostnames })
      .returning();
  } else if (extraHostnames.length) {
    const merged = [...new Set([...(kisip.hostnames ?? []), ...extraHostnames])];
    [kisip] = await db
      .update(schema.tenant)
      .set({ hostnames: merged })
      .where(eq(schema.tenant.id, kisip.id))
      .returning();
  }

  // Roles from CD-10 catalogue (synced to role table)
  await syncRolesFromOrgAccess(kisip!.id, kisipOrgAccess);
  const roleRows = await db
    .select({ id: schema.role.id, name: schema.role.name })
    .from(schema.role)
    .where(eq(schema.role.tenantId, kisip!.id));
  const roleIds = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));

  // Admin user
  const adminEmail = 'admin@kisip.local';
  let [admin] = await db
    .select()
    .from(schema.appUser)
    .where(and(eq(schema.appUser.tenantId, kisip!.id), eq(schema.appUser.email, adminEmail)))
    .limit(1);
  if (!admin) {
    [admin] = await db
      .insert(schema.appUser)
      .values({
        tenantId: kisip!.id,
        email: adminEmail,
        passwordHash: await bcrypt.hash('ChangeMe!2026', 10),
        displayName: 'Platform Administrator',
      })
      .returning();
    await db.insert(schema.userRole).values({ userId: admin!.id, roleId: roleIds.administrator! });
  }

  // Active config versions
  await upsertActiveConfig(kisip!.id, 'cd01_identity', kisipIdentity, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd02_hierarchy', {
    levels: [
      { code: 'settlement', label: 'Settlement', parent_code: 'county', allows_intake: true, is_confirmation_authority: false, can_be_assigned: true },
      { code: 'county', label: 'County', parent_code: 'national', allows_intake: true, is_confirmation_authority: false, can_be_assigned: true },
      { code: 'national', label: 'National', parent_code: null, allows_intake: false, is_confirmation_authority: true, can_be_assigned: true },
    ],
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd04_workflow', {
    case_type: 'grievance',
    statuses: [
      { name: 'Received', tag: 'open', label: { en: 'Received', sw: 'Imepokelewa' } },
      { name: 'Sorting', tag: 'open', label: { en: 'Sorting', sw: 'Inachambuliwa' } },
      { name: 'Investigation', tag: 'in_progress', label: { en: 'Investigation', sw: 'Uchunguzi' } },
      { name: 'Escalated', tag: 'in_progress', label: { en: 'Escalated', sw: 'Imepandishwa' } },
      { name: 'Returned', tag: 'in_progress', label: { en: 'Returned', sw: 'Imerudishwa' } },
      { name: 'Resolved', tag: 'resolved', label: { en: 'Resolved', sw: 'Imetatuliwa' } },
      { name: 'Closed', tag: 'closed', label: { en: 'Closed', sw: 'Imefungwa' } },
      { name: 'Rejected', tag: 'rejected', label: { en: 'Rejected', sw: 'Imekataliwa' } },
      { name: 'In Court', tag: 'on_hold', label: { en: 'In Court', sw: 'Mahakamani' } },
    ],
    initial: {
      default: 'Sorting',
      rules: [{ if: { flag: 'in_court' }, then: 'In Court' }],
    },
    transitions: [
      { from: ['Sorting'], to: 'Investigation', roles: ['grm_officer'] },
      { from: ['Sorting'], to: 'Rejected', roles: ['grm_officer'], requires: { note: true } },
      { from: ['Sorting', 'Investigation', 'Returned'], to: 'Escalated', roles: ['grm_officer'], effects: [{ move_level: 'up' }, { restart_sla: 'stage' }] },
      { from: ['Escalated'], to: 'Returned', roles: ['grm_officer_national'], effects: [{ move_level: 'down' }] },
      { from: ['Investigation', 'Escalated', 'Returned'], to: 'Resolved', roles: ['grm_officer'], requires: { fields: ['resolution_summary'] } },
      { from: ['Resolved'], to: 'Closed', roles: ['grm_officer_national'], guard: 'confirmation' },
      { from: ['In Court'], to: 'Investigation', roles: ['grm_officer_national'] },
    ],
    closure: {
      confirmation: { required_when: { resolved_below: 'national' }, authority_level: 'national' },
      satisfaction: { enabled: true, channels: ['sms'] },
    },
    appeal: { enabled: true, window_days: 30, routes_to: 'next_level' },
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd05_sla', {
    default_plan: 'standard',
    default_calendar: 'kenya',
    plans: [
      {
        code: 'standard',
        label: 'Standard GRM plan',
        time_mode: 'working',
        calendar_code: 'kenya',
        acknowledge_within: 'immediate',
        first_response_within: '14d',
        resolve_within: '30d',
        stage_durations: {
          Sorting: '7d',
          Investigation: '14d',
          Escalated: '14d',
          Resolved: '21d',
        },
        is_default: true,
      },
      {
        code: 'emergency',
        label: 'Emergency priority',
        time_mode: 'calendar',
        resolve_within: '3d',
        is_default: false,
      },
    ],
    calendars: [
      {
        code: 'kenya',
        label: 'Kenya working calendar',
        timezone: 'Africa/Nairobi',
        working_days: [1, 2, 3, 4, 5],
        start_hour: 8,
        end_hour: 17,
        holidays: ['2026-01-01', '2026-12-25', '2026-12-26'],
      },
    ],
    reminders: [
      { at: 'T-2d', notify: 'assignee' },
      { at: 'T-0d', notify: 'supervisor', role: 'grm_officer_national' },
    ],
    escalation_rules: [
      {
        name: 'overdue-auto-escalate',
        enabled: true,
        trigger: { clock: 'stage', state: 'breached' },
        condition: { status_tag: 'in_progress' },
        actions: [{ move_level: 'up' }, { set_status: 'Escalated' }],
      },
      {
        name: 'emergency-priority',
        enabled: true,
        trigger: { on: 'case_created' },
        condition: { priority: 'emergency' },
        actions: [{ set_sla_plan: 'emergency' }, { notify: { role: 'grm_officer_national' } }],
      },
    ],
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd03_taxonomy', {
    categories: [
      { code: 'land_compensation', label: { en: 'Land & Compensation', sw: 'Ardhi na Fidia' }, active: true },
      { code: 'project_implementation', label: { en: 'Project Implementation', sw: 'Utekelezaji wa Mradi' }, active: true },
      { code: 'environmental', label: { en: 'Environmental', sw: 'Mazingira' }, active: true },
      { code: 'social', label: { en: 'Social', sw: 'Kijamii' }, active: true },
      { code: 'labour', label: { en: 'Labour & Employment', sw: 'Kazi na Ajira' }, active: true },
      { code: 'gbv_seah', label: { en: 'GBV / SEAH', sw: 'Ukatili wa Kijinsia' }, sensitivity_class: 'gbv_seah', active: true },
      { code: 'corruption_fraud', label: { en: 'Corruption / Fraud', sw: 'Ufisadi / Udanganyifu' }, sensitivity_class: 'corruption', active: true },
      { code: 'other', label: { en: 'Other', sw: 'Nyingine' }, active: true },
    ],
    sensitivity_classes: [
      { code: 'gbv_seah', label: { en: 'GBV / SEAH', sw: 'Ukatili wa Kijinsia' }, restricted: true },
      { code: 'corruption', label: { en: 'Corruption / Fraud', sw: 'Ufisadi' }, restricted: true },
    ],
    priorities: [
      { code: 'low', label: { en: 'Low', sw: 'Chini' }, sla_multiplier: 1.5, is_default: false },
      { code: 'normal', label: { en: 'Normal', sw: 'Kawaida' }, sla_multiplier: 1, is_default: true },
      { code: 'high', label: { en: 'High', sw: 'Juu' }, sla_multiplier: 0.5, is_default: false },
      { code: 'emergency', label: { en: 'Emergency', sw: 'Dharura' }, sla_multiplier: 0.25, is_default: false },
    ],
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd06_intake_forms', {
    case_type: 'grievance',
    anonymous_allowed: true,
    consent_text: {
      en: 'I consent to my personal data being used to process this grievance, per the privacy notice.',
      sw: 'Ninakubali data yangu binafsi itumike kushughulikia malalamiko haya, kwa mujibu wa taarifa ya faragha.',
    },
    fields: [
      { key: 'name', type: 'text', section: 'complainant', required: true, label: { en: 'Full name', sw: 'Jina kamili' } },
      { key: 'phone', type: 'phone', section: 'complainant', required: true, label: { en: 'Phone number', sw: 'Nambari ya simu' } },
      { key: 'email', type: 'email', section: 'complainant', required: false, label: { en: 'Email (optional)', sw: 'Barua pepe (hiari)' } },
      { key: 'gender', type: 'select', section: 'complainant', required: false, label: { en: 'Gender', sw: 'Jinsia' }, options: [
        { value: 'female', label: { en: 'Female', sw: 'Mwanamke' } },
        { value: 'male', label: { en: 'Male', sw: 'Mwanaume' } },
        { value: 'prefer_not_say', label: { en: 'Prefer not to say', sw: 'Sipendi kusema' } },
      ] },
      { key: 'unit_id', type: 'select', section: 'grievance', required: true, label: { en: 'Settlement / location', sw: 'Makazi / eneo' }, options_ref: 'units' },
      { key: 'categories', type: 'multiselect', section: 'grievance', required: true, label: { en: 'Category', sw: 'Aina' }, options_ref: 'taxonomy:categories' },
      { key: 'date_occurred', type: 'date', section: 'grievance', required: false, label: { en: 'When did it occur?', sw: 'Ilitokea lini?' } },
      { key: 'summary', type: 'text', section: 'grievance', required: true, label: { en: 'Summary', sw: 'Muhtasari' } },
      { key: 'description', type: 'textarea', section: 'grievance', required: true, label: { en: 'Describe your grievance', sw: 'Eleza malalamiko yako' } },
      { key: 'expected_outcome', type: 'textarea', section: 'outcome', required: false, label: { en: 'What outcome do you expect?', sw: 'Unatarajia matokeo gani?' } },
    ],
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd07_numbering', {
    pattern: 'GRM-{YYYY}-{seq:4}',
    scope: 'yearly',
    verifier_required: true,
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd08_channels', {
    public_channels: [
      { type: 'hotline', value: '0800 720 720', enabled: true, show_on_portal: true },
      { type: 'email', value: 'grm@kisip.go.ke', enabled: true, show_on_portal: true },
      { type: 'office', value: 'County KISIP coordination offices', enabled: true, show_on_portal: true },
      { type: 'office', value: 'Settlement Executive Committee (SEC) offices', enabled: true, show_on_portal: true },
    ],
    modules: {
      web_portal: { enabled: true },
      assisted: { enabled: true, source_channels: ['walk_in', 'phone', 'letter', 'community_meeting', 'complaint_box'] },
      hotline: { enabled: true },
      mobile_app: { enabled: false, show_on_portal: true },
      email_inbound: { enabled: false },
      ussd: { enabled: false },
      sms: { enabled: false },
      partner_api: { enabled: false },
      chatbot: { enabled: false },
    },
  }, admin!.id);

  const kisipNotifications = defaultNotificationPack();

  /** KISIP sender credentials — stored in CD-09, not .env (edit in console → Notifications → Sender identities). */
  const setSenderField = (sender: { fields?: { key: string; value: string }[] }, key: string, value: string) => {
    const field = sender.fields?.find((f) => f.key === key);
    if (field) field.value = value;
  };

  kisipNotifications.senders.email.from_name = 'KISIP GRM';
  kisipNotifications.senders.email.from_address = 'kisip.mis@gmail.com';
  setSenderField(kisipNotifications.senders.email, 'user', 'kisip.mis@gmail.com');
  setSenderField(kisipNotifications.senders.email, 'pass', 'ycoxaqavmfiqljjg');

  setSenderField(kisipNotifications.senders.sms, 'apikey', 'b73910d9a9c9c631bc546c304ce357e3');
  setSenderField(kisipNotifications.senders.sms, 'partnerID', '12108');
  setSenderField(kisipNotifications.senders.sms, 'shortcode', 'KISIP');

  // WhatsApp Meta Cloud API — set phone_number_id + Bearer token in console → Sender identities
  kisipNotifications.senders.whatsapp.enabled = true;
  kisipNotifications.senders.whatsapp.provider = 'meta';
  kisipNotifications.senders.whatsapp.mode = 'test';

  await upsertActiveConfig(kisip!.id, 'cd09_notifications', kisipNotifications, admin!.id);

  // Sample unit tree: national → 2 counties → 3 settlements
  const existingUnits = await db.select({ id: schema.unit.id }).from(schema.unit).where(eq(schema.unit.tenantId, kisip!.id)).limit(1);
  if (existingUnits.length === 0) {
    const [national] = await db.insert(schema.unit).values({ tenantId: kisip!.id, levelCode: 'national', name: 'National', code: 'KE' }).returning();
    const [nairobi] = await db.insert(schema.unit).values({ tenantId: kisip!.id, levelCode: 'county', parentId: national!.id, name: 'Nairobi', code: 'KE-047' }).returning();
    const [mombasa] = await db.insert(schema.unit).values({ tenantId: kisip!.id, levelCode: 'county', parentId: national!.id, name: 'Mombasa', code: 'KE-001' }).returning();
    await db.insert(schema.unit).values([
      { tenantId: kisip!.id, levelCode: 'settlement', parentId: nairobi!.id, name: 'Mukuru kwa Njenga', code: 'SET-001' },
      { tenantId: kisip!.id, levelCode: 'settlement', parentId: nairobi!.id, name: 'Kibera Soweto East', code: 'SET-002' },
      { tenantId: kisip!.id, levelCode: 'settlement', parentId: mombasa!.id, name: 'Likoni', code: 'SET-003' },
    ]);
  }

  await upsertActiveConfig(kisip!.id, 'cd14_features', {
    appeals: true,
    satisfaction_survey: true,
    custom_dashboards: true,
    ai_assistance: true,
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd10_org_access', kisipOrgAccess, admin!.id);

  console.log('Seed complete.');
  console.log(`  Tenant: kisip (${kisip!.id})`);
  console.log(`  Login:  ${adminEmail} / ChangeMe!2026`);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isCliEntry()) {
  runSeed()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
