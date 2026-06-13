import { isValidPermissionPattern } from '@egrm/core';
import { z } from 'zod';
import { localizedText } from './cd01-identity.js';

/**
 * CD-10 Org structure, roles & access (spec 02, 07).
 * Role definitions are synced to the `role` table when this config is activated.
 */
const roleDef = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use snake_case, e.g. grm_officer'),
  label: z.string().min(1),
  description: z.string().optional(),
  permissions: z.array(z.string().min(1)).min(1),
  /** Sensitivity classes this role may read/handle (codes from CD-03). */
  sensitive_classes: z.array(z.string()).default([]),
  /** MFA mandatory for users with this role (spec 07 §1). */
  mfa_required: z.boolean().default(false),
});

const department = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

const ssoGroupMapping = z.object({
  group: z.string().min(1),
  role_name: z.string().min(1),
  unit_id: z.string().uuid().optional(),
});

const ssoClaimMapping = z.object({
  /** OIDC/SAML claim for work email. */
  email: z.string().default('email'),
  /** OIDC/SAML claim for display name (or map given_name + family_name in JIT handler). */
  name: z.string().default('name'),
  /** OIDC/SAML claim for mobile (E.164 or national format). */
  phone: z.string().default('phone_number'),
});

const ssoConfig = z.object({
  enabled: z.boolean().default(false),
  protocol: z.enum(['oidc', 'saml']).default('oidc'),
  issuer_url: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  allowed_email_domains: z.array(z.string()).default([]),
  group_role_mappings: z.array(ssoGroupMapping).default([]),
  jit_provisioning: z.boolean().default(true),
  fallback_local_login: z.boolean().default(true),
  /** IdP attribute / OIDC claim names for core staff identity (email, name, phone). */
  claim_mapping: ssoClaimMapping.default({}),
});

const localLoginPolicy = z.object({
  enabled: z.boolean().default(true),
  password_min_length: z.number().int().min(8).default(12),
  password_require_uppercase: z.boolean().default(false),
  password_require_number: z.boolean().default(false),
  /** 0 or omitted = no forced rotation. */
  password_rotation_days: z.number().int().min(0).default(0),
  lockout_after_failures: z.number().int().min(1).default(5),
  lockout_minutes: z.number().int().min(1).default(15),
});

const sessionPolicy = z.object({
  access_token_minutes: z.number().int().min(5).default(60),
  refresh_token_days: z.number().int().min(1).default(7),
  idle_timeout_minutes: z.number().int().min(5).default(60),
  absolute_timeout_hours: z.number().int().min(1).default(12),
  /** 0 = unlimited concurrent sessions. */
  max_concurrent_sessions: z.number().int().min(0).default(0),
});

/** Platform catalogue of optional staff profile fields (values stored in app_user.profile JSONB). */
export const STAFF_PROFILE_FIELD_KEYS = [
  'phone',
  'job_title',
  'employee_id',
  'department_code',
  'external_id',
] as const;

export type StaffProfileFieldKey = (typeof STAFF_PROFILE_FIELD_KEYS)[number];

export const STAFF_PROFILE_FIELD_META: Record<
  StaffProfileFieldKey,
  { label: Record<string, string>; type: 'text' | 'phone' }
> = {
  phone: { label: { en: 'Mobile number', sw: 'Nambari ya simu' }, type: 'phone' },
  job_title: { label: { en: 'Job title', sw: 'Cheo' }, type: 'text' },
  employee_id: { label: { en: 'Employee ID', sw: 'Nambari ya mfanyakazi' }, type: 'text' },
  department_code: { label: { en: 'Department', sw: 'Idara' }, type: 'text' },
  external_id: { label: { en: 'External ID', sw: 'Kitambulisho cha nje' }, type: 'text' },
};

export function defaultStaffProfileFields(): {
  key: StaffProfileFieldKey;
  enabled: boolean;
  required: boolean;
  label: Record<string, string>;
}[] {
  return STAFF_PROFILE_FIELD_KEYS.map((key) => ({
    key,
    enabled: key === 'phone' || key === 'job_title',
    required: false,
    label: { ...STAFF_PROFILE_FIELD_META[key].label },
  }));
}

/** Core identity for self-registration and SSO JIT (spec 07 §1). */
export const STAFF_PROVISIONING_IDENTITY = ['email', 'display_name', 'phone'] as const;

export const STAFF_IDENTITY_FIELD_META: Record<
  (typeof STAFF_PROVISIONING_IDENTITY)[number],
  { type: 'email' | 'text' | 'phone'; label: Record<string, string> }
> = {
  email: { type: 'email', label: { en: 'Email', sw: 'Barua pepe' } },
  display_name: { type: 'text', label: { en: 'Full name', sw: 'Jina kamili' } },
  phone: { type: 'phone', label: { en: 'Mobile number', sw: 'Nambari ya simu' } },
};

export const SSO_DEFAULT_CLAIM_MAPPING = {
  email: 'email',
  name: 'name',
  phone: 'phone_number',
} as const;

const profileFieldDef = z.object({
  key: z.enum(STAFF_PROFILE_FIELD_KEYS),
  enabled: z.boolean().default(true),
  required: z.boolean().default(false),
  label: localizedText.optional(),
});

const registrationApproval = z.object({
  /** Pending self-registrations require admin approval before first login. */
  required: z.boolean().default(true),
  /** Roles that may approve or reject pending registrations (admin:users also allowed). */
  approver_role_names: z.array(z.string()).default(['administrator']),
  /** Optional default role applied on approval when approver sends no roles. */
  default_role_name: z.string().optional(),
  /** Message shown when a pending user tries to sign in. */
  pending_message: z
    .string()
    .default('Your account is pending administrator approval. You will be notified when it is approved.'),
  /** Message shown when a rejected user tries to sign in. */
  rejected_message: z.string().default('Your registration was not approved. Contact your programme administrator.'),
});

const userModel = z.object({
  /** How staff accounts are created (spec 07 §1–2). */
  provisioning: z.enum(['admin_only', 'sso_jit', 'self_registration']).default('admin_only'),
  /** Grant = role × jurisdiction × clearance — multiple grants per user allowed. */
  allow_multiple_assignments: z.boolean().default(true),
  /** When true, every assignment must include a jurisdiction unit (no tenant-wide grants). */
  require_jurisdiction_scope: z.boolean().default(false),
  /** Active users must have at least one role assignment. */
  require_role_assignment: z.boolean().default(true),
  /** Default validity window for new assignments (days). 0 = no default expiry. */
  default_assignment_days: z.number().int().min(0).default(0),
  /** Staff email domain allowlist (empty = any domain). */
  staff_email_domains: z.array(z.string()).default([]),
  /** Role names for contractor / service-provider restricted template (spec 07 §2.3). */
  contractor_role_names: z.array(z.string()).default([]),
  /** Optional profile fields (catalogue keys → app_user.profile JSONB). */
  profile_fields: z.array(profileFieldDef).default(() => defaultStaffProfileFields()),
  /** Review workflow when provisioning = self_registration. */
  registration_approval: registrationApproval.default({}),
});

const authPolicy = z.object({
  local_login: localLoginPolicy.default({}),
  sessions: sessionPolicy.default({}),
  sso: ssoConfig.default({}),
  console_ip_allowlist: z.array(z.string()).default([]),
});

function migrateLegacyAuthPolicy(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const data = raw as Record<string, unknown>;
  if ('local_login' in data || 'sessions' in data) return data;

  const legacy = data as {
    password_min_length?: number;
    session_idle_minutes?: number;
    mfa_required_roles?: string[];
  };

  return {
    local_login: {
      enabled: true,
      password_min_length: legacy.password_min_length ?? 12,
      password_require_uppercase: false,
      password_require_number: false,
      password_rotation_days: 0,
      lockout_after_failures: 5,
      lockout_minutes: 15,
    },
    sessions: {
      access_token_minutes: 60,
      refresh_token_days: 7,
      idle_timeout_minutes: legacy.session_idle_minutes ?? 60,
      absolute_timeout_hours: 12,
      max_concurrent_sessions: 0,
    },
    sso: {
      enabled: false,
      protocol: 'oidc',
      allowed_email_domains: [],
      group_role_mappings: [],
      jit_provisioning: true,
      fallback_local_login: true,
      claim_mapping: { email: 'email', name: 'name', phone: 'phone_number' },
    },
    console_ip_allowlist: [],
  };
}

export const cd10OrgAccess = z
  .preprocess((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const data = raw as { auth_policy?: unknown };
    if (data.auth_policy) {
      return { ...data, auth_policy: migrateLegacyAuthPolicy(data.auth_policy) };
    }
    return data;
  }, z.object({
    roles: z.array(roleDef).min(1),
    departments: z.array(department).default([]),
    user_model: userModel.default({}),
    auth_policy: authPolicy.default({}),
  }))
  .superRefine((cfg, ctx) => {
    const names = cfg.roles.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['roles'], message: 'Role names must be unique' });
    }
    cfg.roles.forEach((role, i) => {
      role.permissions.forEach((perm, j) => {
        if (!isValidPermissionPattern(perm)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roles', i, 'permissions', j],
            message: `Unknown permission pattern "${perm}"`,
          });
        }
      });
    });

    const roleSet = new Set(names);
    for (const [i, mapping] of cfg.auth_policy.sso.group_role_mappings.entries()) {
      if (!roleSet.has(mapping.role_name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['auth_policy', 'sso', 'group_role_mappings', i, 'role_name'],
          message: `Role "${mapping.role_name}" is not defined in roles[]`,
        });
      }
    }
    cfg.user_model.contractor_role_names.forEach((name, i) => {
      if (!roleSet.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['user_model', 'contractor_role_names', i],
          message: `Role "${name}" is not defined in roles[]`,
        });
      }
    });
    const profileKeys = cfg.user_model.profile_fields.map((f) => f.key);
    if (new Set(profileKeys).size !== profileKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['user_model', 'profile_fields'],
        message: 'Profile field keys must be unique',
      });
    }
    const approval = cfg.user_model.registration_approval;
    for (const [i, name] of approval.approver_role_names.entries()) {
      if (!roleSet.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['user_model', 'registration_approval', 'approver_role_names', i],
          message: `Role "${name}" is not defined in roles[]`,
        });
      }
    }
    if (approval.default_role_name && !roleSet.has(approval.default_role_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['user_model', 'registration_approval', 'default_role_name'],
        message: `Role "${approval.default_role_name}" is not defined in roles[]`,
      });
    }
  });

export type Cd10OrgAccess = z.infer<typeof cd10OrgAccess>;
