import type { Cd10OrgAccess } from '@egrm/config-schemas';
import {
  defaultStaffProfileFields,
  STAFF_IDENTITY_FIELD_META,
  STAFF_PROFILE_FIELD_META,
  STAFF_PROVISIONING_IDENTITY,
  type StaffProfileFieldKey,
} from '@egrm/config-schemas';
import { formatMobileNumber } from '@egrm/notifications';
import { getActiveConfig } from './config.js';

export type UserModel = Cd10OrgAccess['user_model'];
export type ProfileFieldDef = UserModel['profile_fields'][number];

const DEFAULT_USER_MODEL: UserModel = {
  provisioning: 'admin_only',
  allow_multiple_assignments: true,
  require_jurisdiction_scope: false,
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
};

function provisioningRequiresCoreIdentity(model: UserModel): boolean {
  return model.provisioning === 'self_registration' || model.provisioning === 'sso_jit';
}

/** Self-registration / SSO JIT always require phone in addition to email + display name. */
function applyProvisioningIdentityRules(model: UserModel): UserModel {
  if (!provisioningRequiresCoreIdentity(model)) return model;
  return {
    ...model,
    profile_fields: model.profile_fields.map((f) =>
      f.key === 'phone' ? { ...f, enabled: true, required: true } : f,
    ),
  };
}

/** Merge configured profile fields with the full platform catalogue. */
export function effectiveProfileFields(model: UserModel): ProfileFieldDef[] {
  const defaults = defaultStaffProfileFields();
  const configured = model.profile_fields ?? [];
  const byKey = new Map(configured.map((f) => [f.key, f]));
  return defaults.map((d) => {
    const row = byKey.get(d.key);
    return {
      key: d.key,
      enabled: row?.enabled ?? d.enabled,
      required: row?.required ?? false,
      label: row?.label ?? d.label,
    };
  });
}

export async function getUserModel(tenantId: string): Promise<UserModel> {
  const cfg = await getActiveConfig<Cd10OrgAccess>(tenantId, 'cd10_org_access');
  let merged = { ...DEFAULT_USER_MODEL, ...cfg?.user_model };
  merged.profile_fields = effectiveProfileFields(merged);
  merged.registration_approval = {
    ...DEFAULT_USER_MODEL.registration_approval,
    ...merged.registration_approval,
  };
  merged = applyProvisioningIdentityRules(merged);
  return merged;
}

export function selfRegistrationEnabled(model: UserModel): boolean {
  return model.provisioning === 'self_registration';
}

/** User may approve/reject pending registrations. */
export function canReviewRegistrations(
  model: UserModel,
  permissions: string[],
  roleNames: string[],
): boolean {
  if (permissions.includes('admin:*') || permissions.includes('admin:users')) return true;
  const approvers = new Set(model.registration_approval.approver_role_names);
  return roleNames.some((n) => approvers.has(n));
}

export function profileFieldLabel(field: ProfileFieldDef, locale = 'en'): string {
  return field.label?.[locale] ?? STAFF_PROFILE_FIELD_META[field.key].label[locale] ?? field.key;
}

export function validateStaffPhone(phone: string): string | null {
  const normalized = formatMobileNumber(phone);
  if (!normalized) return 'Invalid mobile number';
  return null;
}

/** Build profile payload with normalized phone. */
export function buildStaffProfile(
  model: UserModel,
  input: {
    phone?: string;
    profile?: Record<string, unknown>;
  },
): Record<string, unknown> {
  const profile: Record<string, unknown> = { ...(input.profile ?? {}) };
  if (input.phone?.trim()) profile.phone = input.phone.trim();
  return profile;
}

/** Returns error message when email domain is not allowed, or null. */
export function validateStaffEmail(model: UserModel, email: string): string | null {
  const domains = model.staff_email_domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (domains.length === 0) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return 'Invalid email address';
  const domain = email.slice(at + 1).toLowerCase();
  const allowed = domains.some((d) => {
    const norm = d.startsWith('@') ? d.slice(1) : d;
    return domain === norm || domain.endsWith(`.${norm}`);
  });
  return allowed ? null : `Email domain must be one of: ${domains.join(', ')}`;
}

export function validateRoleAssignments(
  model: UserModel,
  roles: { unit_id?: string | null }[],
): string | null {
  if (model.require_role_assignment && roles.length === 0) {
    return 'At least one role assignment is required';
  }
  if (!model.allow_multiple_assignments && roles.length > 1) {
    return 'Only one role assignment is allowed per user';
  }
  if (model.require_jurisdiction_scope && roles.some((r) => !r.unit_id)) {
    return 'Every role assignment must include a jurisdiction unit';
  }
  return null;
}

export function sanitizeProfile(
  model: UserModel,
  profile: Record<string, unknown> | undefined | null,
): Record<string, string> {
  const enabled = effectiveProfileFields(model).filter((f) => f.enabled);
  const data = profile ?? {};
  const out: Record<string, string> = {};
  for (const field of enabled) {
    const val = data[field.key];
    if (typeof val === 'string' && val.trim()) {
      out[field.key] = field.key === 'phone' ? (formatMobileNumber(val) ?? val.trim()) : val.trim();
    }
  }
  return out;
}

export function validateProfile(
  model: UserModel,
  profile: Record<string, unknown> | undefined | null,
  departmentCodes: string[],
  opts?: { requirePhone?: boolean },
): string | null {
  const enabled = applyProvisioningIdentityRules(model).profile_fields.filter((f) => f.enabled);
  const data = profile ?? {};

  for (const field of enabled) {
    const val = data[field.key];
    const str = typeof val === 'string' ? val.trim() : val != null ? String(val).trim() : '';
    const isRequired = field.required || (opts?.requirePhone && field.key === 'phone');
    if (isRequired && !str) {
      return `${profileFieldLabel(field)} is required`;
    }
    if (field.key === 'phone' && str) {
      const phoneErr = validateStaffPhone(str);
      if (phoneErr) return phoneErr;
    }
    if (field.key === 'department_code' && str && !departmentCodes.includes(str)) {
      return `Unknown department code: ${str}`;
    }
  }

  const allowed = new Set(enabled.map((f) => f.key));
  for (const key of Object.keys(data)) {
    if (!allowed.has(key as StaffProfileFieldKey)) {
      return `Unknown profile field: ${key}`;
    }
  }
  return null;
}

/** Validate core identity for self-registration (email, name, phone). */
export function validateProvisioningIdentity(input: {
  email: string;
  display_name: string;
  phone: string;
}): string | null {
  if (!input.email.trim()) return `${STAFF_IDENTITY_FIELD_META.email.label.en} is required`;
  if (!input.display_name.trim()) return `${STAFF_IDENTITY_FIELD_META.display_name.label.en} is required`;
  if (!input.phone.trim()) return `${STAFF_IDENTITY_FIELD_META.phone.label.en} is required`;
  return validateStaffPhone(input.phone);
}

/** Public field schema for admin UIs and API clients. */
export function userFieldSchema(model: UserModel) {
  const corePhoneRequired = provisioningRequiresCoreIdentity(model);
  return {
    identity_fields: STAFF_PROVISIONING_IDENTITY.map((key) => ({
      key,
      type: STAFF_IDENTITY_FIELD_META[key].type,
      required: true,
      label: STAFF_IDENTITY_FIELD_META[key].label,
      /** Phone is stored in app_user.profile.phone */
      storage: key === 'phone' ? 'profile' : 'column',
    })),
    profile_fields: effectiveProfileFields(model).map((f) => ({
      key: f.key,
      type: STAFF_PROFILE_FIELD_META[f.key].type,
      enabled: f.enabled,
      required: f.key === 'phone' && corePhoneRequired ? true : f.required,
      label: { ...STAFF_PROFILE_FIELD_META[f.key].label, ...f.label },
    })),
  };
}

/** Flat required fields for self-registration form (email, name, phone + optional extras). */
export function selfRegistrationFieldSchema(model: UserModel) {
  const schema = userFieldSchema(model);
  const core = schema.identity_fields;
  const extras = schema.profile_fields.filter(
    (f) => f.enabled && f.key !== 'phone',
  );
  return {
    required: core,
    optional: extras.filter((f) => !f.required),
    optional_required: extras.filter((f) => f.required),
  };
}
