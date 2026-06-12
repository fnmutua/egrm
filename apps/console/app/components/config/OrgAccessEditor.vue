<script setup lang="ts">
/**
 * CD-10 Org & access: role definitions (permission sets), departments, auth policy.
 * Roles sync to the database when this config version is activated.
 */
import { PERMISSION_GROUPS, PERMISSION_WILDCARDS } from '@egrm/core';

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
  p.auth_policy ??= { password_min_length: 12, session_idle_minutes: 60, mfa_required_roles: [] };
  p.auth_policy.password_min_length ??= 12;
  p.auth_policy.session_idle_minutes ??= 60;
  p.auth_policy.mfa_required_roles ??= [];
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const roles = computed<RoleDef[]>(() => props.payload.roles);
const departments = computed<Department[]>(() => props.payload.departments);
const authPolicy = computed(() => props.payload.auth_policy);

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
      description="Saving and activating this config updates the live role table used for login permissions. User assignments are managed separately (coming soon)."
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

    <!-- Auth policy -->
    <section v-if="show('sec-auth')" id="sec-auth" class="space-y-3">
      <h2 class="text-sm font-semibold">Authentication policy</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
        <UFormField label="Minimum password length">
          <UInput v-model.number="authPolicy.password_min_length" type="number" min="8" />
        </UFormField>
        <UFormField label="Session idle timeout (minutes)">
          <UInput v-model.number="authPolicy.session_idle_minutes" type="number" min="5" />
        </UFormField>
      </div>
      <UFormField label="MFA required for roles" help="Privileged roles must use multi-factor authentication when enabled.">
        <USelectMenu
          v-model="authPolicy.mfa_required_roles"
          :items="roleNameItems"
          value-key="value"
          label-key="label"
          multiple
          class="w-full max-w-md"
          placeholder="Select roles...…"
        />
      </UFormField>
    </section>
  </div>
</template>
