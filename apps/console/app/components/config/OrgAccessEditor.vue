<script setup lang="ts">
/**
 * CD-10 Org & access: role definitions (permission sets), departments, auth policy.
 * Roles sync to the database when this config version is activated.
 */
import { PERMISSION_GROUPS, PERMISSION_WILDCARDS } from '@egrm/core';
import {
  defaultStaffProfileFields,
  STAFF_IDENTITY_FIELD_META,
  STAFF_PROFILE_FIELD_META,
  STAFF_PROVISIONING_IDENTITY,
} from '@egrm/config-schemas';

interface RoleDef {
  name: string;
  label: string;
  description?: string;
  permissions: string[];
  sensitive_classes: string[];
  mfa_required: boolean;
}

interface Department {
  code: string;
  name: string;
  description?: string;
}

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;

const sensitivityOptions = ref<{ value: string; label: string }[]>([]);

onMounted(async () => {
  try {
    const res = await api<{ payload?: { sensitivity_classes?: { code: string; label?: Record<string, string> }[] } }>(
      '/api/v1/config/cd03_taxonomy',
    );
    sensitivityOptions.value = (res.payload?.sensitivity_classes ?? []).map((c) => ({
      value: c.code,
      label: c.label?.en ?? c.code,
    }));
  } catch {
    /* optional */
  }
  ensure();
});

function ensureAuthPolicy(p: Record<string, unknown>) {
  const ap = (p.auth_policy ?? {}) as Record<string, unknown>;
  if (!ap.local_login && (ap.password_min_length != null || ap.session_idle_minutes != null)) {
    p.auth_policy = {
      local_login: {
        enabled: true,
        password_min_length: ap.password_min_length ?? 12,
        password_require_uppercase: false,
        password_require_number: false,
        password_rotation_days: 0,
        lockout_after_failures: 5,
        lockout_minutes: 15,
      },
      sessions: {
        access_token_minutes: 60,
        refresh_token_days: 7,
        idle_timeout_minutes: ap.session_idle_minutes ?? 60,
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
    return;
  }

  p.auth_policy ??= {};
  const policy = p.auth_policy as Record<string, any>;
  policy.local_login ??= {};
  policy.local_login.enabled ??= true;
  policy.local_login.password_min_length ??= 12;
  policy.local_login.password_require_uppercase ??= false;
  policy.local_login.password_require_number ??= false;
  policy.local_login.password_rotation_days ??= 0;
  policy.local_login.lockout_after_failures ??= 5;
  policy.local_login.lockout_minutes ??= 15;
  policy.sessions ??= {};
  policy.sessions.access_token_minutes ??= 60;
  policy.sessions.refresh_token_days ??= 7;
  policy.sessions.idle_timeout_minutes ??= 60;
  policy.sessions.absolute_timeout_hours ??= 12;
  policy.sessions.max_concurrent_sessions ??= 0;
  policy.sso ??= {};
  policy.sso.enabled ??= false;
  policy.sso.protocol ??= 'oidc';
  policy.sso.allowed_email_domains ??= [];
  policy.sso.group_role_mappings ??= [];
  policy.sso.jit_provisioning ??= true;
  policy.sso.fallback_local_login ??= true;
  policy.sso.claim_mapping ??= { email: 'email', name: 'name', phone: 'phone_number' };
  policy.console_ip_allowlist ??= [];
}

function ensure() {
  const p = props.payload;
  if (!Array.isArray(p.roles) || p.roles.length === 0) {
    p.roles = [
      {
        name: 'administrator',
        label: 'Administrator',
        description: 'Full platform access',
        permissions: ['admin:*'],
        sensitive_classes: [],
        mfa_required: true,
      },
    ];
  }
  for (const r of p.roles as RoleDef[]) {
    r.permissions ??= [];
    r.sensitive_classes ??= [];
    r.mfa_required ??= false;
    r.label ??= r.name;
  }
  p.departments ??= [];
  ensureAuthPolicy(p);
  p.user_model ??= {};
  const um = p.user_model as Record<string, unknown>;
  um.provisioning ??= 'admin_only';
  um.allow_multiple_assignments ??= true;
  um.require_jurisdiction_scope ??= false;
  um.require_role_assignment ??= true;
  um.default_assignment_days ??= 0;
  um.staff_email_domains ??= [];
  um.contractor_role_names ??= [];
  ensureProfileFields(um);
  if (um.provisioning === 'self_registration' || um.provisioning === 'sso_jit') {
    for (const f of um.profile_fields as { key: string; enabled: boolean; required: boolean }[]) {
      if (f.key === 'phone') {
        f.enabled = true;
        f.required = true;
      }
    }
  }
  um.registration_approval ??= {};
  const ra = um.registration_approval as Record<string, unknown>;
  ra.required ??= true;
  ra.approver_role_names ??= ['administrator'];
  ra.pending_message ??=
    'Your account is pending administrator approval. You will be notified when it is approved.';
  ra.rejected_message ??= 'Your registration was not approved. Contact your programme administrator.';
}

function ensureProfileFields(um: Record<string, unknown>) {
  const defaults = defaultStaffProfileFields();
  const existing = Array.isArray(um.profile_fields) ? (um.profile_fields as Record<string, unknown>[]) : [];
  const byKey = new Map(existing.map((f) => [String(f.key), f]));
  um.profile_fields = defaults.map((d) => {
    const row = byKey.get(d.key) ?? {};
    return {
      key: d.key,
      enabled: row.enabled ?? d.enabled,
      required: row.required ?? false,
      label: { ...d.label, ...(row.label as Record<string, string> | undefined) },
    };
  });
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const roles = computed<RoleDef[]>(() => props.payload.roles);
const departments = computed<Department[]>(() => props.payload.departments);
const localLogin = computed(() => props.payload.auth_policy.local_login);
const userModel = computed(() => props.payload.user_model);
const coreIdentityRequired = computed(
  () => userModel.value.provisioning === 'self_registration' || userModel.value.provisioning === 'sso_jit',
);
const profileFields = computed(() => props.payload.user_model.profile_fields as {
  key: string;
  enabled: boolean;
  required: boolean;
  label?: Record<string, string>;
}[]);

function profileFieldMeta(key: string) {
  return STAFF_PROFILE_FIELD_META[key as keyof typeof STAFF_PROFILE_FIELD_META];
}

const staffEmailDomains = computed({
  get: () => (props.payload.user_model.staff_email_domains as string[]).join(', '),
  set: (v: string) => {
    props.payload.user_model.staff_email_domains = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
const sessions = computed(() => props.payload.auth_policy.sessions);
const sso = computed(() => props.payload.auth_policy.sso);
const consoleIpAllowlist = computed({
  get: () => (props.payload.auth_policy.console_ip_allowlist as string[]).join('\n'),
  set: (v: string) => {
    props.payload.auth_policy.console_ip_allowlist = v
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

type AuthPanel = 'local' | 'sessions' | 'sso' | 'perimeter';
const authExpanded = ref(new Set<AuthPanel>(['local']));
function toggleAuth(panel: AuthPanel) {
  if (authExpanded.value.has(panel)) authExpanded.value.delete(panel);
  else authExpanded.value.add(panel);
  authExpanded.value = new Set(authExpanded.value);
}

function addSsoMapping() {
  props.payload.auth_policy.sso.group_role_mappings.push({ group: '', role_name: roles.value[0]?.name ?? '' });
}
function removeSsoMapping(i: number) {
  props.payload.auth_policy.sso.group_role_mappings.splice(i, 1);
}

const expanded = ref<Set<RoleDef>>(new Set());
function toggle(role: RoleDef) {
  if (expanded.value.has(role)) expanded.value.delete(role);
  else expanded.value.add(role);
  expanded.value = new Set(expanded.value);
}

function addRole() {
  props.payload.roles.push({
    name: '',
    label: '',
    permissions: ['case:read'],
    sensitive_classes: [],
    mfa_required: false,
  });
}
function removeRole(role: RoleDef) {
  if (roles.value.length <= 1) return;
  props.payload.roles = roles.value.filter((r) => r !== role);
}

function hasPermission(role: RoleDef, perm: string) {
  return role.permissions.includes(perm);
}
function hasWildcard(role: RoleDef, wildcard: string) {
  return role.permissions.includes(wildcard);
}
function togglePermission(role: RoleDef, perm: string, on: boolean) {
  const set = new Set(role.permissions);
  if (on) set.add(perm);
  else set.delete(perm);
  role.permissions = [...set];
}
function toggleWildcard(role: RoleDef, wildcard: string, on: boolean) {
  const family = wildcard.slice(0, -1);
  const set = new Set(role.permissions.filter((p) => !p.startsWith(family) || p === wildcard));
  if (on) set.add(wildcard);
  else set.delete(wildcard);
  role.permissions = [...set];
}

function addDepartment() {
  props.payload.departments.push({ code: '', name: '' });
}
function removeDepartment(dept: Department) {
  props.payload.departments = departments.value.filter((d) => d !== dept);
}

const roleNameItems = computed(() => roles.value.map((r) => ({ value: r.name, label: r.label || r.name })));
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="show('sec-roles')"
      color="info"
      variant="subtle"
      title="Roles sync on activation"
      description="Saving and activating this config updates the live role table and enforces the staff user model on the API. Individual user accounts are runtime data (admin:users API / bulk import)."
    />

    <!-- Roles -->
    <section v-if="show('sec-roles')" id="sec-roles" class="space-y-3">
      <h2 class="text-sm font-semibold">Roles</h2>
      <p class="text-xs text-muted">
        Named permission sets from the platform catalogue (spec 07). Workflow and SLA rules reference these role names.
      </p>

      <div class="space-y-2">
        <div
          v-for="(role, i) in roles"
          :key="i"
          class="rounded-lg border border-default bg-default"
        >
          <div class="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" @click="toggle(role)">
            <span class="font-medium truncate">{{ role.label || '(unnamed role)' }}</span>
            <UBadge v-if="role.name" size="sm" variant="subtle" color="neutral" class="font-mono">{{ role.name }}</UBadge>
            <UBadge v-if="role.mfa_required" size="sm" variant="subtle" color="warning">MFA</UBadge>
            <UBadge size="sm" variant="subtle" color="primary">{{ role.permissions.length }} perms</UBadge>
            <div class="ml-auto flex items-center gap-0.5 shrink-0">
              <UButton
                size="xs" variant="ghost" color="error" icon="i-lucide-trash-2"
                :disabled="roles.length <= 1"
                @click.stop="removeRole(role)"
              />
              <UIcon :name="expanded.has(role) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="text-muted" />
            </div>
          </div>

          <div v-if="expanded.has(role)" class="border-t border-default px-4 py-3 space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UFormField label="Display label" required>
                <UInput v-model="role.label" class="w-full" />
              </UFormField>
              <UFormField label="Code name" required help="Stable id used in workflow rules, e.g. grm_officer">
                <UInput v-model="role.name" class="w-full font-mono" placeholder="grm_officer" />
              </UFormField>
            </div>
            <UFormField label="Description">
              <UTextarea v-model="role.description" class="w-full" :rows="2" />
            </UFormField>

            <div class="flex flex-wrap items-center gap-4">
              <div class="flex items-center gap-2 text-sm">
                <span>MFA required</span>
                <USwitch v-model="role.mfa_required" />
              </div>
              <UFormField v-if="sensitivityOptions.length" label="Sensitivity clearance" class="min-w-48">
                <USelectMenu
                  v-model="role.sensitive_classes"
                  :items="sensitivityOptions"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                  placeholder="None"
                />
              </UFormField>
            </div>

            <div class="space-y-3">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Wildcards</p>
              <div class="flex flex-wrap gap-3">
                <label
                  v-for="wc in PERMISSION_WILDCARDS"
                  :key="wc"
                  class="flex items-center gap-2 text-sm font-mono"
                >
                  <UCheckbox
                    :model-value="hasWildcard(role, wc)"
                    @update:model-value="toggleWildcard(role, wc, $event as boolean)"
                  />
                  {{ wc }}
                </label>
              </div>
            </div>

            <div v-for="group in PERMISSION_GROUPS" :key="group.label" class="space-y-2">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">{{ group.label }}</p>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-1">
                <label
                  v-for="perm in group.permissions"
                  :key="perm"
                  class="flex items-center gap-2 text-sm font-mono"
                >
                  <UCheckbox
                    :model-value="hasPermission(role, perm)"
                    :disabled="hasWildcard(role, perm.split(':')[0] + ':*')"
                    @update:model-value="togglePermission(role, perm, $event as boolean)"
                  />
                  <span :class="hasWildcard(role, perm.split(':')[0] + ':*') ? 'text-muted line-through' : ''">{{ perm }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addRole">Add role</UButton>
    </section>

    <!-- Staff user model (spec 07 §2) -->
    <section v-if="show('sec-user-model')" id="sec-user-model" class="space-y-3">
      <h2 class="text-sm font-semibold">Staff user model</h2>
      <p class="text-xs text-muted">
        How staff accounts are provisioned and how grants work: role × jurisdiction × sensitivity clearance. Not individual user records.
      </p>

      <UCard :ui="{ body: 'p-4 space-y-4' }">
        <UFormField label="Provisioning" help="How staff accounts are created for this tenant.">
          <USelectMenu
            v-model="userModel.provisioning"
            :items="[
              { value: 'admin_only', label: 'Admin-provisioned only' },
              { value: 'sso_jit', label: 'SSO with just-in-time provisioning' },
              { value: 'self_registration', label: 'Self-registration (with optional approval)' },
            ]"
            value-key="value"
            label-key="label"
            class="w-full max-w-md"
          />
        </UFormField>

        <UAlert
          v-if="userModel.provisioning === 'self_registration'"
          color="info"
          variant="subtle"
          icon="i-lucide-user-plus"
          title="Self-registration"
          description="Staff sign up via POST /api/v1/public/staff-register (rate-limited). Email, full name, and mobile number are required — same core identity as SSO JIT. Pending accounts cannot log in until approved."
        />

        <UAlert
          v-if="userModel.provisioning === 'sso_jit'"
          color="info"
          variant="subtle"
          icon="i-lucide-shield-check"
          title="SSO identity"
          description="JIT provisioning requires email, display name, and mobile number from the IdP. Map OIDC/SAML claims in the SSO section below."
        />

        <UCard v-if="userModel.provisioning === 'self_registration'" :ui="{ body: 'p-4 space-y-4' }">
          <h3 class="text-sm font-medium">Registration review & approval</h3>
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>Require admin approval before first login</span>
            <USwitch v-model="userModel.registration_approval.required" />
          </div>
          <UFormField label="Approver roles" help="Users with these roles (or admin:users) may approve or reject pending registrations.">
            <USelectMenu
              v-model="userModel.registration_approval.approver_role_names"
              :items="roleNameItems"
              value-key="value"
              label-key="label"
              multiple
              class="w-full"
            />
          </UFormField>
          <UFormField label="Default role on approval" help="Applied when approver does not specify roles. Leave empty to require explicit assignment at approval.">
            <USelectMenu
              v-model="userModel.registration_approval.default_role_name"
              :items="[{ value: null, label: '(none — assign at approval)' }, ...roleNameItems]"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Pending login message">
            <UTextarea v-model="userModel.registration_approval.pending_message" class="w-full" :rows="2" />
          </UFormField>
          <UFormField label="Rejected login message">
            <UTextarea v-model="userModel.registration_approval.rejected_message" class="w-full" :rows="2" />
          </UFormField>
        </UCard>

        <div class="grid sm:grid-cols-2 gap-4">
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>Allow multiple role assignments</span>
            <USwitch v-model="userModel.allow_multiple_assignments" />
          </div>
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>Require jurisdiction on every assignment</span>
            <USwitch v-model="userModel.require_jurisdiction_scope" />
          </div>
          <div class="flex items-center justify-between gap-2 text-sm">
            <span>Require at least one role assignment</span>
            <USwitch v-model="userModel.require_role_assignment" />
          </div>
        </div>

        <UFormField label="Default assignment validity (days)" help="0 = assignments do not expire by default (use valid_to per assignment when needed).">
          <UInput v-model.number="userModel.default_assignment_days" type="number" min="0" class="w-full max-w-xs" />
        </UFormField>

        <UFormField label="Staff email domains" help="Comma-separated allowlist. Empty = any domain.">
          <UInput v-model="staffEmailDomains" class="w-full font-mono text-sm" placeholder="@kisip.go.ke, @partner.org" />
        </UFormField>

        <UFormField label="Contractor / service-provider roles" help="Restricted role template: assigned cases only, no PII export (spec 07 §2.3).">
          <USelectMenu
            v-model="userModel.contractor_role_names"
            :items="roleNameItems"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
            placeholder="Select roles…"
          />
        </UFormField>
      </UCard>

      <UCard :ui="{ body: 'p-4 space-y-3' }">
        <h3 class="text-sm font-medium">Profile fields</h3>
        <p class="text-xs text-muted">
          Core identity (<span class="font-mono">email</span>, <span class="font-mono">display_name</span>, <span class="font-mono">phone</span>)
          is always required for self-registration and SSO JIT.
          Optional fields below are stored in <span class="font-mono">app_user.profile</span>.
        </p>
        <div class="grid sm:grid-cols-3 gap-2 p-3 rounded-lg border border-default bg-muted/30">
          <div v-for="key in STAFF_PROVISIONING_IDENTITY" :key="key" class="text-xs">
            <span class="font-mono font-medium">{{ key }}</span>
            <p class="text-muted">{{ STAFF_IDENTITY_FIELD_META[key].label.en }}</p>
            <UBadge size="xs" variant="subtle" color="primary">Required</UBadge>
          </div>
        </div>
        <div class="space-y-2">
          <div
            v-for="field in profileFields"
            :key="field.key"
            class="grid sm:grid-cols-[1fr_auto_auto_1fr] gap-3 items-center p-3 rounded-lg border border-default"
          >
            <div>
              <span class="text-sm font-mono font-medium">{{ field.key }}</span>
              <p class="text-xs text-muted">
                {{ profileFieldMeta(field.key)?.type ?? 'text' }}
                <span v-if="field.key === 'phone' && coreIdentityRequired" class="text-primary">· always required for self-reg / SSO</span>
              </p>
            </div>
            <label class="flex items-center gap-2 text-xs whitespace-nowrap">
              <UCheckbox
                v-model="field.enabled"
                :disabled="field.key === 'phone' && coreIdentityRequired"
              />
              Enabled
            </label>
            <label class="flex items-center gap-2 text-xs whitespace-nowrap">
              <UCheckbox
                v-model="field.required"
                :disabled="!field.enabled || (field.key === 'phone' && coreIdentityRequired)"
              />
              Required
            </label>
            <UFormField label="Label (EN)" class="min-w-0">
              <UInput
                :model-value="field.label?.en ?? ''"
                class="w-full text-sm"
                :placeholder="profileFieldMeta(field.key)?.label?.en"
                @update:model-value="(field.label ??= {}) && (field.label.en = String($event))"
              />
            </UFormField>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Departments -->
    <section v-if="show('sec-departments')" id="sec-departments" class="space-y-3">
      <h2 class="text-sm font-semibold">Departments & teams</h2>
      <p class="text-xs text-muted">Routing containers for assignments and queue visibility (KUSP2 department access).</p>
      <div v-for="(dept, i) in departments" :key="i" class="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-default">
        <UFormField label="Code" class="min-w-32">
          <UInput v-model="dept.code" class="font-mono" />
        </UFormField>
        <UFormField label="Name" class="flex-1 min-w-40">
          <UInput v-model="dept.name" class="w-full" />
        </UFormField>
        <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeDepartment(dept)" />
      </div>
      <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addDepartment">Add department</UButton>
    </section>

    <!-- Auth policy (spec 07 §1) -->
    <section v-if="show('sec-auth')" id="sec-auth" class="space-y-3">
      <h2 class="text-sm font-semibold">Staff authentication policy</h2>
      <p class="text-xs text-muted">
        Local login, sessions, SSO, and console perimeter. MFA is configured per role above. Complainant portal auth is separate (CD-14 / CD-08).
      </p>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleAuth('local')">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-key-round" class="size-4 text-primary" />
            <span class="text-sm font-medium">Local login</span>
          </div>
          <div class="flex items-center gap-2" @click.stop>
            <USwitch v-model="localLogin.enabled" size="sm" />
            <UIcon :name="authExpanded.has('local') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
          </div>
        </div>
        <div v-if="authExpanded.has('local')" class="border-t border-default px-4 py-3 grid sm:grid-cols-2 gap-3">
          <UFormField label="Minimum password length">
            <UInput v-model.number="localLogin.password_min_length" type="number" min="8" class="w-full" />
          </UFormField>
          <UFormField label="Password rotation (days)" help="0 = no forced rotation.">
            <UInput v-model.number="localLogin.password_rotation_days" type="number" min="0" class="w-full" />
          </UFormField>
          <UFormField label="Require uppercase">
            <USwitch v-model="localLogin.password_require_uppercase" />
          </UFormField>
          <UFormField label="Require number">
            <USwitch v-model="localLogin.password_require_number" />
          </UFormField>
          <UFormField label="Lockout after failures">
            <UInput v-model.number="localLogin.lockout_after_failures" type="number" min="1" class="w-full" />
          </UFormField>
          <UFormField label="Lockout duration (minutes)">
            <UInput v-model.number="localLogin.lockout_minutes" type="number" min="1" class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleAuth('sessions')">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clock" class="size-4 text-primary" />
            <span class="text-sm font-medium">Sessions</span>
          </div>
          <UIcon :name="authExpanded.has('sessions') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
        </div>
        <div v-if="authExpanded.has('sessions')" class="border-t border-default px-4 py-3 grid sm:grid-cols-2 gap-3">
          <UFormField label="Access token (minutes)">
            <UInput v-model.number="sessions.access_token_minutes" type="number" min="5" class="w-full" />
          </UFormField>
          <UFormField label="Refresh token (days)">
            <UInput v-model.number="sessions.refresh_token_days" type="number" min="1" class="w-full" />
          </UFormField>
          <UFormField label="Idle timeout (minutes)">
            <UInput v-model.number="sessions.idle_timeout_minutes" type="number" min="5" class="w-full" />
          </UFormField>
          <UFormField label="Absolute timeout (hours)">
            <UInput v-model.number="sessions.absolute_timeout_hours" type="number" min="1" class="w-full" />
          </UFormField>
          <UFormField label="Max concurrent sessions" help="0 = unlimited.">
            <UInput v-model.number="sessions.max_concurrent_sessions" type="number" min="0" class="w-full" />
          </UFormField>
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleAuth('sso')">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield-check" class="size-4 text-primary" />
            <span class="text-sm font-medium">SSO (OIDC / SAML)</span>
            <UBadge v-if="sso.enabled" size="sm" variant="subtle" color="primary">On</UBadge>
          </div>
          <div class="flex items-center gap-2" @click.stop>
            <USwitch v-model="sso.enabled" size="sm" />
            <UIcon :name="authExpanded.has('sso') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
          </div>
        </div>
        <div v-if="authExpanded.has('sso')" class="border-t border-default px-4 py-3 space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Protocol">
              <USelectMenu
                v-model="sso.protocol"
                :items="[{ value: 'oidc', label: 'OpenID Connect' }, { value: 'saml', label: 'SAML 2.0' }]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Issuer URL">
              <UInput v-model="sso.issuer_url" class="w-full" placeholder="https://login.example.com/…" />
            </UFormField>
            <UFormField label="Client ID">
              <UInput v-model="sso.client_id" class="w-full font-mono" />
            </UFormField>
            <UFormField label="Client secret">
              <UInput v-model="sso.client_secret" type="password" class="w-full font-mono" />
            </UFormField>
          </div>
          <div class="flex flex-wrap items-center gap-4">
            <div class="flex items-center gap-2 text-sm">
              <span>JIT provisioning</span>
              <USwitch v-model="sso.jit_provisioning" />
            </div>
            <div class="flex items-center gap-2 text-sm">
              <span>Local fallback login</span>
              <USwitch v-model="sso.fallback_local_login" />
            </div>
          </div>
          <UFormField label="Allowed email domains" help="Optional restrict SSO to these domains.">
            <UInput
              :model-value="(sso.allowed_email_domains as string[]).join(', ')"
              class="w-full"
              placeholder="@agency.go.ke, @partner.org"
              @update:model-value="sso.allowed_email_domains = String($event).split(',').map((s) => s.trim()).filter(Boolean)"
            />
          </UFormField>
          <div class="space-y-2">
            <span class="text-xs font-medium text-muted">Identity claim mapping (email, name, phone)</span>
            <div class="grid sm:grid-cols-3 gap-3">
              <UFormField label="Email claim">
                <UInput v-model="sso.claim_mapping.email" class="w-full font-mono" placeholder="email" />
              </UFormField>
              <UFormField label="Name claim">
                <UInput v-model="sso.claim_mapping.name" class="w-full font-mono" placeholder="name" />
              </UFormField>
              <UFormField label="Phone claim">
                <UInput v-model="sso.claim_mapping.phone" class="w-full font-mono" placeholder="phone_number" />
              </UFormField>
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Directory group → role mappings</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addSsoMapping">Add mapping</UButton>
            </div>
            <div
              v-for="(row, mi) in sso.group_role_mappings"
              :key="mi"
              class="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end"
            >
              <UFormField label="IdP group">
                <UInput v-model="row.group" class="w-full font-mono" placeholder="GRM-Admins" />
              </UFormField>
              <UFormField label="Role">
                <USelectMenu v-model="row.role_name" :items="roleNameItems" value-key="value" label-key="label" class="w-full" />
              </UFormField>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeSsoMapping(mi)" />
            </div>
          </div>
          <UAlert color="warning" variant="subtle" title="SSO login flow" description="OIDC/SAML redirect endpoints are not yet wired — config is stored for when SSO is enabled in a later phase." />
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleAuth('perimeter')">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield" class="size-4 text-primary" />
            <span class="text-sm font-medium">Console IP allowlist</span>
          </div>
          <UIcon :name="authExpanded.has('perimeter') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 text-muted" />
        </div>
        <div v-if="authExpanded.has('perimeter')" class="border-t border-default px-4 py-3">
          <UFormField label="Allowed IPs" help="One per line. Suffix * for prefix match. Empty = allow all.">
            <UTextarea v-model="consoleIpAllowlist" class="w-full font-mono text-xs" :rows="4" placeholder="203.0.113.10&#10;192.168.1.*" />
          </UFormField>
        </div>
      </UCard>
    </section>
  </div>
</template>
