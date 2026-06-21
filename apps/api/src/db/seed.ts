/** Seed the dev database with the KISIP reference tenant (tenant profile, doc 11). */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import type { ConfigDomain } from '@egrm/core';
import { DEFAULT_CD16_AI } from '@egrm/config-schemas';
import { validateConfig, defaultNotificationPack, defaultStaffProfileFields, DEFAULT_ATTACHMENT_KINDS, DEFAULT_ATTACHMENT_POLICY, DEFAULT_CORRESPONDENCE_POLICY, mergeMissingNotificationItems, mergeMissingIntakeFormDefaults, type Cd06IntakeForms } from '@egrm/config-schemas';
import type { Cd01Identity, Cd04Workflow, Cd09Notifications, Cd10OrgAccess } from '@egrm/config-schemas';
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
      parent_role: 'grm_officer_national',
      permissions: [
        'case:read', 'case:create_assisted', 'case:transition', 'case:assign', 'case:edit_fields',
        'thread:reply_external', 'thread:note_internal', 'thread:read',
        'attachment:upload', 'attachment:download', 'attachment:rename', 'attachment:delete_soft', 'task:manage',
      ],
      sensitive_classes: [],
      mfa_required: false,
    },
    {
      name: 'grm_officer_national',
      label: 'National GRM officer',
      description: 'Escalated cases, closure confirmation, sensitive routing.',
      parent_role: 'administrator',
      permissions: ['case:*', 'thread:*', 'attachment:*', 'report:view', 'sensitive:read', 'sensitive:handle', 'task:manage'],
      sensitive_classes: [],
      mfa_required: false,
    },
    {
      name: 'gbv_officer',
      label: 'GBV / SEAH focal',
      description: 'Designated handler for GBV/SEAH sensitivity class.',
      parent_role: 'administrator',
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
      parent_role: 'administrator',
      permissions: ['report:view', 'report:export'],
      sensitive_classes: [],
      mfa_required: false,
    },
  ],
  departments: [
    { code: 'national_grm', name: 'National GRM unit', description: 'Programme-wide coordination' },
    { code: 'county_coordination', name: 'County coordination', description: 'County-level GRM focal points' },
  ],
  user_model: {
    provisioning: 'admin_only' as const,
    allow_multiple_assignments: true,
    require_jurisdiction_scope: true,
    require_role_assignment: true,
    default_assignment_days: 0,
    staff_email_domains: [],
    contractor_role_names: [],
    profile_fields: defaultStaffProfileFields(),
    registration_approval: {
      required: true,
      approver_role_names: ['administrator'],
      pending_message:
        'Your account is pending administrator approval. You will be notified when it is approved.',
      rejected_message: 'Your registration was not approved. Contact your programme administrator.',
    },
  },
  auth_policy: {
    local_login: {
      enabled: true,
      password_min_length: 12,
      password_require_uppercase: true,
      password_require_number: true,
      password_rotation_days: 0,
      lockout_after_failures: 5,
      lockout_minutes: 15,
    },
    sessions: {
      access_token_minutes: 480,
      refresh_token_days: 7,
      idle_timeout_minutes: 60,
      absolute_timeout_hours: 12,
      max_concurrent_sessions: 0,
    },
    sso: {
      enabled: false,
      protocol: 'oidc' as const,
      allowed_email_domains: [],
      group_role_mappings: [],
      jit_provisioning: true,
      fallback_local_login: true,
      claim_mapping: { email: 'email', name: 'name', phone: 'phone_number' },
    },
    console_ip_allowlist: [],
  },
};

async function seedDemoUnitsIfEmpty(tenantId: string) {
  const [existing] = await db
    .select({ id: schema.unit.id })
    .from(schema.unit)
    .where(eq(schema.unit.tenantId, tenantId))
    .limit(1);
  if (existing) return;

  async function insertUnit(
    levelCode: string,
    parentId: string | null,
    name: string,
    code: string,
  ) {
    const [row] = await db
      .insert(schema.unit)
      .values({ tenantId, levelCode, parentId, name, code, active: true })
      .returning();
    return row!;
  }

  const national = await insertUnit('national', null, 'Kenya', 'KE');
  const county = await insertUnit('county', national.id, 'Demo County', 'DEMO-COUNTY');
  const subcounty = await insertUnit('subcounty', county.id, 'Demo Sub-county', 'DEMO-SUB');
  const ward = await insertUnit('ward', subcounty.id, 'Demo Ward', 'DEMO-WARD');
  await insertUnit('settlement', ward.id, 'Demo Settlement A', 'DEMO-SET-A');
  await insertUnit('settlement', ward.id, 'Demo Settlement B', 'DEMO-SET-B');
  console.log('  Demo jurisdiction units seeded (2 settlements). Replace via Admin → Jurisdiction units.');
}

async function seedDemoOfficers(
  tenantId: string,
  roleIds: Record<string, string | undefined>,
) {
  const grmOfficerRoleId = roleIds.grm_officer;
  if (!grmOfficerRoleId) return;

  const settlements = await db
    .select({ id: schema.unit.id, code: schema.unit.code })
    .from(schema.unit)
    .where(and(eq(schema.unit.tenantId, tenantId), eq(schema.unit.levelCode, 'settlement')));

  const demos = [
    { email: 'officer-a@kisip.local', name: 'Demo Settlement A Officer', code: 'DEMO-SET-A' },
    { email: 'officer-b@kisip.local', name: 'Demo Settlement B Officer', code: 'DEMO-SET-B' },
  ] as const;

  for (const demo of demos) {
    const unit = settlements.find((s) => s.code === demo.code);
    if (!unit) continue;

    let [user] = await db
      .select({ id: schema.appUser.id })
      .from(schema.appUser)
      .where(and(eq(schema.appUser.tenantId, tenantId), eq(schema.appUser.email, demo.email)))
      .limit(1);

    if (!user) {
      [user] = await db
        .insert(schema.appUser)
        .values({
          tenantId,
          email: demo.email,
          passwordHash: await bcrypt.hash('ChangeMe!2026', 10),
          displayName: demo.name,
          registrationStatus: 'approved',
        })
        .returning({ id: schema.appUser.id });
    }

    const [assignment] = await db
      .select({ id: schema.userRole.userId })
      .from(schema.userRole)
      .where(and(eq(schema.userRole.userId, user!.id), eq(schema.userRole.roleId, grmOfficerRoleId)))
      .limit(1);

    if (!assignment) {
      await db.insert(schema.userRole).values({
        userId: user!.id,
        roleId: grmOfficerRoleId,
        unitId: unit.id,
      });
    }
  }

  console.log(
    '  Demo officers: officer-a@kisip.local / officer-b@kisip.local (ChangeMe!2026) — each scoped to one settlement',
  );

  const multiEmail = 'officer-multi@kisip.local';
  let [multiUser] = await db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(and(eq(schema.appUser.tenantId, tenantId), eq(schema.appUser.email, multiEmail)))
    .limit(1);
  if (!multiUser) {
    [multiUser] = await db
      .insert(schema.appUser)
      .values({
        tenantId,
        email: multiEmail,
        passwordHash: await bcrypt.hash('ChangeMe!2026', 10),
        displayName: 'Multi-jurisdiction Officer',
        registrationStatus: 'approved',
      })
      .returning({ id: schema.appUser.id });
  }
  for (const demo of demos) {
    const unit = settlements.find((s) => s.code === demo.code);
    if (!unit) continue;
    const [existing] = await db
      .select({ userId: schema.userRole.userId })
      .from(schema.userRole)
      .where(
        and(
          eq(schema.userRole.userId, multiUser!.id),
          eq(schema.userRole.roleId, grmOfficerRoleId),
          eq(schema.userRole.unitId, unit.id),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(schema.userRole).values({
        userId: multiUser!.id,
        roleId: grmOfficerRoleId,
        unitId: unit.id,
      });
    }
  }
  console.log('  Multi-jurisdiction demo: officer-multi@kisip.local (ChangeMe!2026) — Settlement A + B');
}

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

/** Clear staff email domain allowlist on active CD-10 (empty list = any domain). */
async function ensureStaffEmailDomainsOpen(tenantId: string, changedBy: string) {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      version: schema.configVersion.version,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, 'cd10_org_access'),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) return;

  const current = active.payload as Cd10OrgAccess;
  const domains = current.user_model?.staff_email_domains ?? [];
  if (domains.length === 0) return;

  const merged: Cd10OrgAccess = {
    ...current,
    user_model: { ...current.user_model, staff_email_domains: [] },
  };

  const parsed = validateConfig('cd10_org_access', merged);
  if (!parsed.success) {
    throw new Error(`CD-10 merge invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, 'cd10_org_access')));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.configVersion)
      .set({ status: 'retired' })
      .where(eq(schema.configVersion.id, active.id));

    await tx.insert(schema.configVersion).values({
      tenantId,
      domain: 'cd10_org_access',
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: 'seed: open staff email domains',
      changedBy,
      activatedAt: new Date(),
    });
  });

  console.log('  CD-10: staff email domain restriction removed (any domain allowed).');
}

/** Merge new platform notification templates/rules (e.g. thread.*) into an existing active CD-09 pack. */
async function ensureCd09Notifications(tenantId: string, freshPack: Cd09Notifications, changedBy: string) {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      version: schema.configVersion.version,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, 'cd09_notifications'),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) {
    await upsertActiveConfig(tenantId, 'cd09_notifications', freshPack, changedBy);
    return;
  }

  const current = active.payload as Cd09Notifications;
  const { merged, changed } = mergeMissingNotificationItems(current, defaultNotificationPack());
  if (!changed) return;

  const parsed = validateConfig('cd09_notifications', merged);
  if (!parsed.success) {
    throw new Error(`CD-09 merge invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, 'cd09_notifications')));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.configVersion)
      .set({ status: 'retired' })
      .where(eq(schema.configVersion.id, active.id));

    await tx.insert(schema.configVersion).values({
      tenantId,
      domain: 'cd09_notifications',
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: 'seed: merge thread notification templates and rules',
      changedBy,
      activatedAt: new Date(),
    });
  });

  console.log('[seed] merged thread notification templates/rules into active CD-09');
}

/** Refresh privacy policy and data-deletion copy from seed on existing CD-01 configs. */
async function ensureCd01LegalPages(
  tenantId: string,
  legal: Pick<typeof kisipIdentity, 'privacy_policy' | 'data_deletion'>,
  changedBy: string,
) {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      version: schema.configVersion.version,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, 'cd01_identity'),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) return;

  const current = active.payload as Cd01Identity;
  const samePrivacy = JSON.stringify(current.privacy_policy ?? null) === JSON.stringify(legal.privacy_policy ?? null);
  const sameDeletion = JSON.stringify(current.data_deletion ?? null) === JSON.stringify(legal.data_deletion ?? null);
  if (samePrivacy && sameDeletion) return;

  const merged: Cd01Identity = {
    ...current,
    privacy_policy: legal.privacy_policy,
    data_deletion: legal.data_deletion,
  };

  const parsed = validateConfig('cd01_identity', merged);
  if (!parsed.success) {
    throw new Error(`CD-01 legal pages merge invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, 'cd01_identity')));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.configVersion)
      .set({ status: 'retired' })
      .where(eq(schema.configVersion.id, active.id));

    await tx.insert(schema.configVersion).values({
      tenantId,
      domain: 'cd01_identity',
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: 'seed: sync privacy policy and data deletion pages',
      changedBy,
      activatedAt: new Date(),
    });
  });

  console.log('[seed] synced privacy policy and data deletion content into active CD-01');
}

const appealedWorkflowStatus = {
  name: 'Appealed',
  tag: 'appeal' as const,
  label: { en: 'Appealed', sw: 'Rufaa' },
};

const appealedWorkflowTransitions: Cd04Workflow['transitions'] = [
  {
    from: ['Appealed'],
    to: 'Investigation',
    roles: ['grm_officer', 'grm_officer_national'],
    requires: { note: true },
  },
  {
    from: ['Appealed'],
    to: 'Resolved',
    roles: ['grm_officer', 'grm_officer_national'],
    requires: { note: true },
  },
];

/** Merge Appealed status and staff appeal transitions into active CD-04 on existing tenants. */
async function ensureCd04AppealWorkflow(tenantId: string, changedBy: string) {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      version: schema.configVersion.version,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, 'cd04_workflow'),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) return;

  const current = active.payload as Cd04Workflow;
  const hasAppealedStatus = current.statuses.some((s) => s.tag === 'appeal' || s.name === 'Appealed');
  const hasAppealTransitions = current.transitions.some(
    (t) => t.from.includes('Appealed') || t.from.includes(appealedWorkflowStatus.name),
  );
  const appealPolicy = current.appeal ?? { enabled: false };

  if (hasAppealedStatus && hasAppealTransitions && appealPolicy.enabled) return;

  const statuses = hasAppealedStatus
    ? current.statuses
    : [...current.statuses, appealedWorkflowStatus];

  const transitions = hasAppealTransitions
    ? current.transitions
    : [...current.transitions, ...appealedWorkflowTransitions];

  const merged: Cd04Workflow = {
    ...current,
    statuses,
    transitions,
    appeal: {
      enabled: true,
      window_days: appealPolicy.window_days ?? 30,
      routes_to: appealPolicy.routes_to ?? 'next_level',
      max_rounds: appealPolicy.max_rounds,
    },
  };

  const parsed = validateConfig('cd04_workflow', merged);
  if (!parsed.success) {
    throw new Error(`CD-04 appeal workflow merge invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, 'cd04_workflow')));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.configVersion)
      .set({ status: 'retired' })
      .where(eq(schema.configVersion.id, active.id));

    await tx.insert(schema.configVersion).values({
      tenantId,
      domain: 'cd04_workflow',
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: 'seed: add Appealed status and appeal transitions',
      changedBy,
      activatedAt: new Date(),
    });
  });

  console.log('[seed] merged Appealed workflow status and transitions into active CD-04');
}

/** Backfill attachment_policy / document kinds on CD-06 configs created before spec 14 shipped. */
async function ensureCd06IntakeForms(tenantId: string, changedBy: string) {
  const [active] = await db
    .select({
      id: schema.configVersion.id,
      payload: schema.configVersion.payload,
    })
    .from(schema.configVersion)
    .where(
      and(
        eq(schema.configVersion.tenantId, tenantId),
        eq(schema.configVersion.domain, 'cd06_intake_forms'),
        eq(schema.configVersion.status, 'active'),
      ),
    )
    .limit(1);

  if (!active) return;

  const current = active.payload as Cd06IntakeForms;
  const { merged, changed } = mergeMissingIntakeFormDefaults(current);
  if (!changed) return;

  const parsed = validateConfig('cd06_intake_forms', merged);
  if (!parsed.success) {
    throw new Error(`CD-06 merge invalid: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  const [maxRow] = await db
    .select({ max: sql<number>`coalesce(max(${schema.configVersion.version}), 0)::int` })
    .from(schema.configVersion)
    .where(and(eq(schema.configVersion.tenantId, tenantId), eq(schema.configVersion.domain, 'cd06_intake_forms')));

  const nextVersion = (maxRow?.max ?? 0) + 1;

  await db.transaction(async (tx) => {
    await tx
      .update(schema.configVersion)
      .set({ status: 'retired' })
      .where(eq(schema.configVersion.id, active.id));

    await tx.insert(schema.configVersion).values({
      tenantId,
      domain: 'cd06_intake_forms',
      version: nextVersion,
      status: 'active',
      payload: parsed.data,
      changeNote: 'seed: merge attachment_policy and document kinds',
      changedBy,
      activatedAt: new Date(),
    });
  });

  console.log('[seed] merged attachment_policy and document kinds into active CD-06');
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
  privacy_policy: {
    version: '1.0',
    effective_date: '2026-01-01',
    page_title: {
      en: 'Privacy & data protection notice',
      sw: 'Sera ya faragha na ulinzi wa data',
    },
    footer_link_label: {
      en: 'Privacy & data protection notice',
      sw: 'Sera ya faragha na ulinzi wa data',
    },
    related_link_label: {
      en: 'Data deletion instructions',
      sw: 'Maelezo ya kufuta data',
    },
    intro: {
      en: 'This notice explains how the Kenya Informal Settlements Improvement Project (KISIP) Grievance Redress Mechanism collects, uses, stores, and protects your information when you submit or track a grievance through this portal, hotline, county offices, SMS, WhatsApp, or other connected channels.',
      sw: 'Taarifa hii inaeleza jinsi Utaratibu wa Kushughulikia Malalamiko wa KISIP unavyokusanya, kutumia, kuhifadhi, na kulinda taarifa zako unapowasilisha au kufuatilia malalamiko kupitia tovuti hii, simu ya bure, ofisi za kaunti, SMS, WhatsApp, au njia nyingine zilizounganishwa.',
    },
    sections: [
      {
        id: 'scope',
        title: { en: 'Scope', sw: 'Upeo' },
        body: {
          en: 'This notice applies to personal data you provide to KISIP GRM. It covers grievances about KISIP-funded activities — including land and compensation, construction works, environmental and social impacts, and related project conduct. It does not replace separate policies of partner agencies where a referral is made.',
          sw: 'Taarifa hii inatumika kwa data binafsi unayotoa kwa GRM ya KISIP. Inahusisha malalamiko kuhusu shughuli zinazofadhiliwa na KISIP — ikiwemo ardhi na fidia, kazi za ujenzi, athari za kimazingira na kijamii, na tabia inayohusiana na mradi. Haiibadili sera za kando za mashirika mengine pale tunaporejea malalamiko.',
        },
      },
      {
        id: 'collect',
        title: { en: 'Information we collect', sw: 'Taarifa tunazokusanya' },
        body: {
          en: 'Depending on how you contact us, we may collect: your name, phone number, email address, settlement or county, description of the grievance, supporting documents, preferred language, and notification preferences. Anonymous submissions do not require your name; we issue a reference number and may ask for a phone number or PIN to verify follow-up.',
          sw: 'Kulingana na jinsi unavyowasiliana nasi, tunaweza kukusanya: jina, nambari ya simu, barua pepe, makazi au kaunti, maelezo ya malalamiko, nyaraka za usaidizi, lugha unayopendelea, na njia za taarifa. Uwasilishaji bila kujulikana hauhitaji jina; tunakupa nambari ya kumbukumbu na tunaweza kuomba simu au PIN kuthibitisha ufuatiliaji.',
        },
      },
      {
        id: 'use',
        title: { en: 'How we use your information', sw: 'Jinsi tunavyotumia taarifa zako' },
        body: {
          en: 'We use your information solely to register, investigate, and resolve grievances; communicate with you about your case; meet legal, environmental, and safeguard obligations; and produce anonymised statistics for programme reporting. We do not sell your data.',
          sw: 'Tunatumia taarifa zako tu kusajili, kuchunguza, na kutatua malalamiko; kuwasiliana nawe kuhusu kesi yako; kutimiza wajibu wa kisheria, kimazingira, na ulinzi; na kutoa takwimu zisizotambulisha mtu kwa ripoti za mradi. Hatuuzi data yako.',
        },
      },
      {
        id: 'access',
        title: { en: 'Who can access your information', sw: 'Nani anaweza kufikia taarifa zako' },
        body: {
          en: 'Only authorised KISIP GRM staff with a legitimate case-related need can view your details. Access is logged. Sensitive grievances (for example GBV/SEA) are restricted to specially trained officers under stricter confidentiality rules.',
          sw: 'Wafanyakazi wa GRM wa KISIP walioruhusiwa tu wenye haja halali ya kesi wanaweza kuona taarifa zako. Ufikiaji unarekodiwa. Malalamiko nyeti (kwa mfano GBV/SEA) yanawekewa vizuizi kwa maafisa waliofunzwa kwa sheria kali zaidi za usiri.',
        },
      },
      {
        id: 'notifications',
        title: { en: 'Notifications', sw: 'Taarifa na arifa' },
        body: {
          en: 'If you opt in, we may send case updates by SMS, email, or WhatsApp (including automated status replies when you message our WhatsApp number). Messages contain only the information needed to inform you; sensitive cases may use privacy-safe wording.',
          sw: 'Ukikubali, tunaweza kutuma taarifa za kesi kupitia SMS, barua pepe, au WhatsApp (ikiwemo majibu ya hali ya kesi unapotuma ujumbe kwa nambari yetu ya WhatsApp). Ujumbe una taarifa muhimu tu; kesi nyeti zinaweza kutumia maneno salama zaidi kwa faragha.',
        },
      },
      {
        id: 'retention',
        title: { en: 'Retention', sw: 'Uhifadhi wa data' },
        body: {
          en: 'Case records are kept for as long as needed to resolve the grievance, handle appeals, and meet World Bank and Government of Kenya audit requirements, then archived or anonymised according to programme retention rules.',
          sw: 'Rekodi za kesi zinahifadhiwa kwa muda unaohitajika kutatua malalamiko, kushughulikia rufaa, na kutimiza mahitaji ya ukaguzi wa Benki ya Dunia na Serikali ya Kenya, kisha kuhifadhiwa au kutambulishwa bila jina kulingana na sheria za uhifadhi wa mradi.',
        },
      },
      {
        id: 'rights',
        title: { en: 'Your rights', sw: 'Haki zako' },
        body: {
          en: 'Under the Kenya Data Protection Act, 2019, you may request access, correction, or deletion of your personal data where applicable. Contact grm@kisip.go.ke or 0800 720 720. You may also lodge a complaint with the Office of the Data Protection Commissioner.',
          sw: 'Chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019, unaweza kuomba kufikia, kusahihisha, au kufuta data yako binafsi inapofaa. Wasiliana grm@kisip.go.ke au 0800 720 720. Unaweza pia kuwasilisha malalamiko kwa Ofisi ya Kamishna wa Ulinzi wa Data.',
        },
      },
      {
        id: 'security',
        title: { en: 'Security', sw: 'Usalama' },
        body: {
          en: 'Personal identifiers are encrypted. The system records who accessed a case and when. We apply technical and organisational measures appropriate to the sensitivity of the information.',
          sw: 'Vitambulisho binafsi vimesimbwa. Mfumo unarekodi nani aliyefikia kesi na lini. Tunatumia hatua za kiufundi na za shirika zinazofaa kwa usikivu wa taarifa.',
        },
      },
    ],
  },
  data_deletion: {
    version: '1.0',
    effective_date: '2026-01-01',
    page_title: {
      en: 'Data deletion instructions',
      sw: 'Maelezo ya kufuta data',
    },
    footer_link_label: {
      en: 'Data deletion instructions',
      sw: 'Maelezo ya kufuta data',
    },
    related_link_label: {
      en: 'Privacy notice',
      sw: 'Sera ya faragha',
    },
    form: {
      enabled: true,
      title: {
        en: 'Request deletion of your data',
        sw: 'Omba kufutwa kwa data yako',
      },
      hint: {
        en: 'Enter the name, email, and phone number you used when you submitted your grievance. If they match our records, your contact details will be removed immediately. Case details may be kept for audit purposes.',
        sw: 'Weka jina, barua pepe, na nambari ya simu ulizotumia unapowasilisha malalamiko. Ikiwa zinalingana na rekodi zetu, taarifa zako za mawasiliano zitafutwa mara moja. Maelezo ya kesi yanaweza kubaki kwa madhumuni ya ukaguzi.',
      },
      name_label: { en: 'Full name', sw: 'Jina kamili' },
      email_label: { en: 'Email', sw: 'Barua pepe' },
      phone_label: { en: 'Phone number', sw: 'Nambari ya simu' },
      submit_label: { en: 'Delete my data', sw: 'Futa data yangu' },
      submitting_label: { en: 'Verifying…', sw: 'Inathibitisha…' },
      success_message: {
        en: 'Your contact details have been removed from {count} case record(s). You can no longer track those cases using this phone or email.',
        sw: 'Taarifa zako za mawasiliano zimeondolewa kutoka kwa rekodi {count} za kesi. Huwezi tena kufuatilia kwa simu au barua pepe hizi.',
      },
      errors: {
        no_match: {
          en: 'We could not verify these details against our records. Check the information and try again, or contact us below.',
          sw: 'Hatukuweza kuthibitisha maelezo haya dhidi ya rekodi zetu. Angalia taarifa na ujaribu tena, au wasiliana nasi hapa chini.',
        },
        already_erased: {
          en: 'Personal contact details matching this information have already been removed.',
          sw: 'Taarifa za mawasiliano zinazolingana na maelezo haya zimeshatolewa.',
        },
        invalid_name: {
          en: 'Enter the full name used when you submitted your case.',
          sw: 'Weka jina kamili lililotumika unapowasilisha kesi yako.',
        },
        invalid_phone: {
          en: 'Enter a valid phone number.',
          sw: 'Weka nambari halali ya simu.',
        },
        invalid_email: {
          en: 'Enter a valid email address.',
          sw: 'Weka anwani halali ya barua pepe.',
        },
        generic: {
          en: 'Request failed. Please try again later.',
          sw: 'Ombi limeshindwa. Jaribu tena baadaye.',
        },
      },
    },
    intro: {
      en: 'Under the Kenya Data Protection Act, 2019, you have the right to request erasure of your personal data where applicable. This page explains how to request deletion of your information from KISIP GRM, and the limits that may apply.',
      sw: 'Chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019, una haki ya kuomba kufutwa kwa data yako binafsi inapofaa. Ukurasa huu unaeleza jinsi ya kuomba ufutaji wa taarifa zako kutoka kwa GRM ya KISIP, na mipaka inayoweza kutumika.',
    },
    sections: [
      {
        id: 'right',
        title: { en: 'Your right to erasure', sw: 'Haki yako ya kufutwa kwa data' },
        body: {
          en: 'You may ask us to delete personal data we hold about you when it is no longer needed for the purpose it was collected, when you withdraw consent (where consent was the legal basis), or when the data was processed unlawfully. We will respond within 30 days unless the law allows a longer period.',
          sw: 'Unaweza kuomba tufute data binafsi tunayohifadhi kukuhusu inapohitajika tena kwa madhumuni yaliyokusanywa, unapojiondoa ridhaa (pale ridhaa ilikuwa msingi wa kisheria), au data ilichakatwa kinyume cha sheria. Tutajibu ndani ya siku 30 isipokuwa sheria inaruhusu muda mrefu zaidi.',
        },
      },
      {
        id: 'can-delete',
        title: { en: 'What we can delete', sw: 'Tunachoweza kufuta' },
        body: {
          en: 'After a case is closed and statutory retention periods have passed, we can delete or anonymise contact details (name, phone, email), notification preferences, and uploaded documents that are not required for audit. We can also remove duplicate or mistaken contact information on request while a case is open.',
          sw: 'Baada ya kesi kufungwa na muda wa kisheria wa uhifadhi kupita, tunaweza kufuta au kutambulisha bila jina maelezo ya mawasiliano (jina, simu, barua pepe), mapendeleo ya arifa, na nyaraka zilizopakiwa ambazo hazihitajiki kwa ukaguzi. Tunaweza pia kuondoa maelezo ya mawasiliano yaliyorudiwa au yaliyokosewa kwa ombi wakati kesi bado haijafungwa.',
        },
      },
      {
        id: 'cannot-delete',
        title: { en: 'What we may need to keep', sw: 'Tunachoweza kuhitaji kuweka' },
        body: {
          en: 'We cannot delete information that must be retained to investigate or evidence a grievance, meet World Bank or Government of Kenya audit requirements, defend legal claims, or protect the safety of others. For open cases, we will usually restrict processing or anonymise identifiers where possible rather than delete active case records. System audit logs are kept for security and may not be erased.',
          sw: 'Hatuwezi kufuta taarifa zinazohitajika kuchunguza au kuthibitisha malalamiko, kutimiza mahitaji ya ukaguzi wa Benki ya Dunia au Serikali ya Kenya, kulinda madai ya kisheria, au kulinda usalama wa wengine. Kwa kesi zinazoendelea, kwa kawaida tutazuia uchakataji au kutambulisha vitambulisho bila jina inapowezekana badala ya kufuta rekodi za kesi hai. Kumbukumbu za ukaguzi wa mfumo zinahifadhiwa kwa usalama na huenda zisifutwe.',
        },
      },
      {
        id: 'how-to-request',
        title: { en: 'How to submit a request', sw: 'Jinsi ya kuwasilisha ombi' },
        body: {
          en: 'Email grm@kisip.go.ke, call 0800 720 720, or visit a county KISIP coordination office. Include your case reference number (for example GRM-2026-0001) if you have one, the personal data you want deleted, and enough detail for us to verify your identity. Anonymous cases can be verified with the reference number and PIN or phone number you used at intake.',
          sw: 'Tuma barua pepe grm@kisip.go.ke, piga 0800 720 720, au tembelea ofisi ya uratibu wa KISIP ya kaunti. Jumuisha nambari yako ya kumbukumbu ya kesi (kwa mfano GRM-2026-0001) ikiwa unayo, data binafsi unayotaka ifutwe, na maelezo ya kutosha kututhibitisha utambulisho wako. Kesi zisizo na jina zinaweza kuthibitishwa kwa nambari ya kumbukumbu na PIN au simu uliyotumia wakati wa kuwasilisha.',
        },
      },
      {
        id: 'verification',
        title: { en: 'Identity verification', sw: 'Uthibitishaji wa utambulisho' },
        body: {
          en: 'To protect complainants from fraudulent deletion requests, we must confirm you are the data subject or their authorised representative before erasing personal data. We may ask for a copy of ID, confirmation from the phone or email on file, or in-person verification at a programme office.',
          sw: 'Ili kulinda wawasilishaji dhidi ya maombi ya ulaghai ya kufuta data, lazima tuthibitishe wewe ndiye mhusika wa data au mwakilishi aliyeidhinishwa kabla ya kufuta data binafsi. Tunaweza kuomba nakala ya kitambulisho, uthibitisho kutoka kwa simu au barua pepe iliyorekodiwa, au uthibitisho ana kwa ana katika ofisi ya mradi.',
        },
      },
      {
        id: 'timeline',
        title: { en: 'What happens next', sw: 'Kinachofuata' },
        body: {
          en: 'We acknowledge requests within 7 working days. We will tell you what was deleted, what must be retained and why, or if we need more information. If you disagree with our decision, you may complain to the Office of the Data Protection Commissioner.',
          sw: 'Tunathibitisha kupokea maombi ndani ya siku 7 za kazi. Tutakuambia kilichofutwa, kilichobaki na sababu, au ikiwa tunahitaji taarifa zaidi. Usipokubaliana na uamuzi wetu, unaweza kuwasilisha malalamiko kwa Ofisi ya Kamishna wa Ulinzi wa Data.',
        },
      },
      {
        id: 'whatsapp',
        title: { en: 'WhatsApp and messaging channels', sw: 'WhatsApp na njia za ujumbe' },
        body: {
          en: 'Messages sent to our WhatsApp or SMS numbers for case status are processed to reply to you; they are not a channel for formal deletion requests. Please use email or post for written erasure requests.',
          sw: 'Ujumbe unaotumwa kwa nambari zetu za WhatsApp au SMS kwa hali ya kesi unachakatwa ili kukujibu; si njia ya maombi rasmi ya kufuta data. Tafadhali tumia barua pepe au posta kwa maombi ya maandishi ya ufutaji.',
        },
      },
    ],
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

  // Roles from CD-10 catalogue (synced to role table on first seed only)
  const [existingRole] = await db
    .select({ id: schema.role.id })
    .from(schema.role)
    .where(eq(schema.role.tenantId, kisip!.id))
    .limit(1);
  if (!existingRole || process.env.SEED_FORCE_SYNC_ROLES === '1') {
    await syncRolesFromOrgAccess(kisip!.id, kisipOrgAccess);
  }
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
        mfaEnrolled: true,
      })
      .returning();
    await db.insert(schema.userRole).values({ userId: admin!.id, roleId: roleIds.administrator! });
  } else {
    if (!admin.mfaEnrolled) {
      await db.update(schema.appUser).set({ mfaEnrolled: true }).where(eq(schema.appUser.id, admin.id));
    }
  }

  // Active config versions
  await upsertActiveConfig(kisip!.id, 'cd01_identity', kisipIdentity, admin!.id);
  await ensureCd01LegalPages(
    kisip!.id,
    { privacy_policy: kisipIdentity.privacy_policy, data_deletion: kisipIdentity.data_deletion },
    admin!.id,
  );

  await upsertActiveConfig(kisip!.id, 'cd02_hierarchy', {
    levels: [
      { code: 'settlement', label: 'Settlement', parent_code: 'ward', allows_intake: true, is_confirmation_authority: false, can_be_assigned: true },
      { code: 'ward', label: 'Ward', parent_code: 'subcounty', allows_intake: false, is_confirmation_authority: false, can_be_assigned: true },
      { code: 'subcounty', label: 'Sub-county', parent_code: 'county', allows_intake: false, is_confirmation_authority: false, can_be_assigned: true },
      { code: 'county', label: 'County', parent_code: 'national', allows_intake: false, is_confirmation_authority: false, can_be_assigned: true },
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
      { name: 'Appealed', tag: 'appeal', label: { en: 'Appealed', sw: 'Rufaa' } },
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
      { from: ['Investigation', 'Escalated', 'Returned'], to: 'Resolved', roles: ['grm_officer'], requires: { fields: ['resolution_summary'], attachments: ['signed_resolution_form'] } },
      { from: ['Appealed'], to: 'Investigation', roles: ['grm_officer', 'grm_officer_national'], requires: { note: true } },
      { from: ['Appealed'], to: 'Resolved', roles: ['grm_officer', 'grm_officer_national'], requires: { note: true } },
      { from: ['Resolved'], to: 'Closed', roles: ['grm_officer_national'], guard: 'confirmation' },
      { from: ['In Court'], to: 'Investigation', roles: ['grm_officer_national'] },
    ],
    closure: {
      confirmation: { required_when: { resolved_below: 'national' }, authority_level: 'national' },
      satisfaction: { enabled: true, channels: ['sms'] },
    },
    appeal: { enabled: true, window_days: 30, routes_to: 'next_level' },
  }, admin!.id);
  await ensureCd04AppealWorkflow(kisip!.id, admin!.id);

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
    attachment_kinds: DEFAULT_ATTACHMENT_KINDS,
    attachment_policy: DEFAULT_ATTACHMENT_POLICY,
  }, admin!.id);
  await ensureCd06IntakeForms(kisip!.id, admin!.id);

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

  // WhatsApp Meta Cloud API — enable in console → Sender identities once phone_number_id + token are set
  kisipNotifications.senders.whatsapp.enabled = false;
  kisipNotifications.senders.whatsapp.provider = 'meta';
  kisipNotifications.senders.whatsapp.mode = 'live';

  await ensureCd09Notifications(kisip!.id, kisipNotifications, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd17_correspondence', {
    correspondence_policy: DEFAULT_CORRESPONDENCE_POLICY,
  }, admin!.id);

  await seedDemoUnitsIfEmpty(kisip!.id);
  await seedDemoOfficers(kisip!.id, roleIds);

  await upsertActiveConfig(kisip!.id, 'cd14_features', {
    appeals: true,
    satisfaction_survey: true,
    custom_dashboards: true,
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd16_ai', {
    ...DEFAULT_CD16_AI,
    enabled: true,
    chatbot: {
      ...DEFAULT_CD16_AI.chatbot,
      enabled: true,
      profile: 'openai_primary',
    },
    capabilities: {
      ...DEFAULT_CD16_AI.capabilities,
      auto_categorize: { enabled: true, profile: 'openai_primary', min_confidence: 0.6 },
      sensitivity_detect: { enabled: true, profile: 'openai_primary', min_confidence: 0.5 },
      draft_response: { enabled: true, profile: 'openai_primary' },
    },
  }, admin!.id);

  await upsertActiveConfig(kisip!.id, 'cd10_org_access', kisipOrgAccess, admin!.id);
  await ensureStaffEmailDomainsOpen(kisip!.id, admin!.id);

  console.log('Seed complete.');
  console.log(`  Tenant: kisip (${kisip!.id})`);
  console.log(`  Login:  ${adminEmail} / ChangeMe!2026`);
  console.log('  Scoped officers: officer-a@kisip.local (Settlement A), officer-b@kisip.local (Settlement B), officer-multi@kisip.local (both)');
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
