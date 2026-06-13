<script setup lang="ts">
definePageMeta({ layout: 'admin' });

const { api } = useApi();
const { user, fetchMe } = useAuth();
const { canPage } = usePermissions();
const toast = useToast();

interface UserRole {
  id: string;
  role_id: string;
  role_name: string;
  unit_id: string | null;
  unit_name: string | null;
}

interface StaffUser {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  registration_status: 'pending' | 'approved' | 'rejected';
  profile: Record<string, string>;
  created_at: string;
  roles: UserRole[];
}

interface TenantRole {
  id: string;
  name: string;
  label: string;
}

interface UnitRow {
  id: string;
  name: string;
  levelCode: string;
}

const users = ref<StaffUser[]>([]);
const roles = ref<TenantRole[]>([]);
const units = ref<UnitRow[]>([]);
const loading = ref(true);
const saving = ref(false);
const search = ref('');
const statusFilter = ref<'all' | 'pending' | 'approved' | 'rejected'>('all');

const createOpen = ref(false);
const editOpen = ref(false);
const approveOpen = ref(false);
const rejectOpen = ref(false);
const selected = ref<StaffUser | null>(null);

const createForm = reactive({
  email: '',
  display_name: '',
  password: '',
  phone: '',
  active: true,
  role_id: '' as string,
  unit_id: null as string | null,
});

const editForm = reactive({
  display_name: '',
  active: true,
  password: '',
  phone: '',
});

const approveRoles = ref<{ role_id: string; unit_id: string | null }[]>([{ role_id: '', unit_id: null }]);
const rejectReason = ref('');

const statusColor: Record<string, 'warning' | 'success' | 'error' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

const roleItems = computed(() =>
  roles.value.map((r) => ({ value: r.id, label: r.label || r.name })),
);

const unitItems = computed(() => [
  { value: null, label: '(no jurisdiction)' },
  ...units.value.map((u) => ({ value: u.id, label: `${u.name} (${u.levelCode})` })),
]);

const filteredUsers = computed(() => {
  const q = search.value.trim().toLowerCase();
  return users.value.filter((u) => {
    if (statusFilter.value !== 'all' && u.registration_status !== statusFilter.value) return false;
    if (!q) return true;
    const phone = u.profile?.phone ?? '';
    return (
      u.email.toLowerCase().includes(q) ||
      u.display_name.toLowerCase().includes(q) ||
      phone.toLowerCase().includes(q)
    );
  });
});

const pendingCount = computed(() => users.value.filter((u) => u.registration_status === 'pending').length);

async function loadUsers() {
  const res = await api<{ users: StaffUser[] }>('/api/v1/users');
  users.value = res.users;
}

async function loadMeta() {
  const [r, u] = await Promise.all([
    api<{ roles: TenantRole[] }>('/api/v1/roles', { query: { manageable: '1' } }),
    api<{ units: UnitRow[] }>('/api/v1/units'),
  ]);
  roles.value = r.roles;
  units.value = u.units;
}

async function reload() {
  loading.value = true;
  try {
    await loadUsers();
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  if (!canPage('/admin/users')) return navigateTo('/admin');
  await Promise.all([loadMeta(), reload()]);
});

function resetCreateForm() {
  createForm.email = '';
  createForm.display_name = '';
  createForm.password = '';
  createForm.phone = '';
  createForm.active = true;
  createForm.role_id = roles.value[0]?.id ?? '';
  createForm.unit_id = null;
}

function openCreate() {
  resetCreateForm();
  createOpen.value = true;
}

function openEdit(row: StaffUser) {
  selected.value = row;
  editForm.display_name = row.display_name;
  editForm.active = row.active;
  editForm.password = '';
  editForm.phone = row.profile?.phone ?? '';
  editOpen.value = true;
}

function openApprove(row: StaffUser) {
  selected.value = row;
  approveRoles.value = [{ role_id: roles.value[0]?.id ?? '', unit_id: null }];
  approveOpen.value = true;
}

function openReject(row: StaffUser) {
  selected.value = row;
  rejectReason.value = '';
  rejectOpen.value = true;
}

function apiError(e: unknown, fallback: string): string {
  const data = (e as { data?: { message?: string; error?: string } })?.data;
  return data?.message ?? data?.error ?? fallback;
}

async function createUser() {
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      email: createForm.email.trim(),
      display_name: createForm.display_name.trim(),
      password: createForm.password,
      active: createForm.active,
      profile: createForm.phone.trim() ? { phone: createForm.phone.trim() } : undefined,
      roles: createForm.role_id
        ? [{ role_id: createForm.role_id, unit_id: createForm.unit_id }]
        : [],
    };
    await api('/api/v1/users', { method: 'POST', body });
    toast.add({ title: 'User created', color: 'success' });
    createOpen.value = false;
    await reload();
  } catch (e: unknown) {
    toast.add({ title: apiError(e, 'Create failed'), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function saveEdit() {
  if (!selected.value) return;
  saving.value = true;
  try {
    const body: Record<string, unknown> = {
      display_name: editForm.display_name.trim(),
      active: editForm.active,
      profile: { ...selected.value.profile, phone: editForm.phone.trim() || undefined },
    };
    if (editForm.password) body.password = editForm.password;
    await api(`/api/v1/users/${selected.value.id}`, { method: 'PATCH', body });
    toast.add({ title: 'User updated', color: 'success' });
    editOpen.value = false;
    await reload();
  } catch (e: unknown) {
    toast.add({ title: apiError(e, 'Update failed'), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function approveUser() {
  if (!selected.value) return;
  saving.value = true;
  try {
    const rolesBody = approveRoles.value
      .filter((r) => r.role_id)
      .map((r) => ({ role_id: r.role_id, unit_id: r.unit_id }));
    await api(`/api/v1/users/${selected.value.id}/approve`, {
      method: 'POST',
      body: { roles: rolesBody },
    });
    toast.add({ title: 'Registration approved', color: 'success' });
    approveOpen.value = false;
    await reload();
  } catch (e: unknown) {
    toast.add({ title: apiError(e, 'Approve failed'), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function rejectUser() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await api(`/api/v1/users/${selected.value.id}/reject`, {
      method: 'POST',
      body: { reason: rejectReason.value.trim() || undefined },
    });
    toast.add({ title: 'Registration rejected', color: 'success' });
    rejectOpen.value = false;
    await reload();
  } catch (e: unknown) {
    toast.add({ title: apiError(e, 'Reject failed'), color: 'error' });
  } finally {
    saving.value = false;
  }
}

async function toggleActive(row: StaffUser) {
  try {
    await api(`/api/v1/users/${row.id}`, {
      method: 'PATCH',
      body: { active: !row.active },
    });
    toast.add({ title: row.active ? 'User deactivated' : 'User activated', color: 'success' });
    await reload();
  } catch (e: unknown) {
    toast.add({ title: apiError(e, 'Update failed'), color: 'error' });
  }
}

function formatRoles(row: StaffUser): string {
  if (!row.roles.length) return '—';
  return row.roles
    .map((r) => (r.unit_name ? `${r.role_name} @ ${r.unit_name}` : r.role_name))
    .join(', ');
}

function rowActions(row: StaffUser) {
  const items: { label: string; icon: string; onSelect?: () => void }[] = [
    { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => openEdit(row) },
  ];
  if (row.registration_status === 'pending') {
    items.unshift(
      { label: 'Approve', icon: 'i-lucide-check', onSelect: () => openApprove(row) },
      { label: 'Reject', icon: 'i-lucide-x', onSelect: () => openReject(row) },
    );
  } else if (row.registration_status === 'approved') {
    items.push({
      label: row.active ? 'Deactivate' : 'Activate',
      icon: row.active ? 'i-lucide-user-x' : 'i-lucide-user-check',
      onSelect: () => toggleActive(row),
    });
  }
  return [items];
}
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8 max-w-6xl">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold mb-1">Users</h1>
        <p class="text-sm text-muted">
          Staff accounts and role assignments.
          <span v-if="pendingCount" class="text-warning font-medium">{{ pendingCount }} pending approval</span>
        </p>
      </div>
      <UButton icon="i-lucide-user-plus" @click="openCreate">Add user</UButton>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 mb-4">
      <UInput
        v-model="search"
        placeholder="Search name, email, or phone…"
        icon="i-lucide-search"
        class="w-full sm:w-72"
      />
      <USelectMenu
        v-model="statusFilter"
        :items="[
          { value: 'all', label: 'All statuses' },
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
        ]"
        value-key="value"
        label-key="label"
        class="w-full sm:w-48"
      />
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="loading" class="p-8 text-center text-muted">Loading…</div>
      <div v-else-if="filteredUsers.length === 0" class="p-8 text-center text-muted">No users found.</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-sm">
          <thead>
            <tr class="text-left text-muted border-b border-default">
              <th class="py-2 px-4">Name</th>
              <th class="py-2 px-4">Email</th>
              <th class="py-2 px-4">Phone</th>
              <th class="py-2 px-4">Status</th>
              <th class="py-2 px-4">Roles</th>
              <th class="py-2 px-4">Active</th>
              <th class="py-2 px-4 w-12" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredUsers"
              :key="row.id"
              class="border-b border-default hover:bg-elevated/50"
            >
              <td class="py-2.5 px-4 font-medium">{{ row.display_name }}</td>
              <td class="py-2.5 px-4 font-mono text-xs">{{ row.email }}</td>
              <td class="py-2.5 px-4">{{ row.profile?.phone ?? '—' }}</td>
              <td class="py-2.5 px-4">
                <UBadge :color="statusColor[row.registration_status] ?? 'neutral'" variant="subtle" size="sm">
                  {{ row.registration_status }}
                </UBadge>
              </td>
              <td class="py-2.5 px-4 text-xs text-muted max-w-xs truncate">{{ formatRoles(row) }}</td>
              <td class="py-2.5 px-4">
                <UBadge :color="row.active ? 'success' : 'neutral'" variant="subtle" size="sm">
                  {{ row.active ? 'yes' : 'no' }}
                </UBadge>
              </td>
              <td class="py-2.5 px-4">
                <UDropdownMenu :items="rowActions(row)">
                  <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-ellipsis-vertical" aria-label="Actions" />
                </UDropdownMenu>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>

    <!-- Create -->
    <UModal v-model:open="createOpen" title="Add staff user">
      <template #body>
        <form class="space-y-4" @submit.prevent="createUser">
          <UFormField label="Email" required>
            <UInput v-model="createForm.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Full name" required>
            <UInput v-model="createForm.display_name" class="w-full" />
          </UFormField>
          <UFormField label="Mobile number">
            <UInput v-model="createForm.phone" type="tel" class="w-full" />
          </UFormField>
          <UFormField label="Password" required>
            <PasswordInput v-model="createForm.password" autocomplete="new-password" :required="true" />
          </UFormField>
          <UFormField label="Role">
            <USelectMenu
              v-model="createForm.role_id"
              :items="roleItems"
              value-key="value"
              label-key="label"
              class="w-full"
              placeholder="Select role…"
            />
          </UFormField>
          <UFormField label="Jurisdiction unit">
            <USelectMenu
              v-model="createForm.unit_id"
              :items="unitItems"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <label class="flex items-center gap-2 text-sm">
            <UCheckbox v-model="createForm.active" />
            Active immediately
          </label>
        </form>
      </template>
      <template #footer>
        <UButton variant="ghost" color="neutral" @click="createOpen = false">Cancel</UButton>
        <UButton :loading="saving" @click="createUser">Create</UButton>
      </template>
    </UModal>

    <!-- Edit -->
    <UModal v-model:open="editOpen" title="Edit user">
      <template #body>
        <form class="space-y-4" @submit.prevent="saveEdit">
          <UFormField label="Email">
            <UInput :model-value="selected?.email" class="w-full" disabled />
          </UFormField>
          <UFormField label="Full name" required>
            <UInput v-model="editForm.display_name" class="w-full" />
          </UFormField>
          <UFormField label="Mobile number">
            <UInput v-model="editForm.phone" type="tel" class="w-full" />
          </UFormField>
          <UFormField label="New password" help="Leave blank to keep current password">
            <PasswordInput v-model="editForm.password" autocomplete="new-password" />
          </UFormField>
          <label class="flex items-center gap-2 text-sm">
            <UCheckbox v-model="editForm.active" />
            Account active
          </label>
        </form>
      </template>
      <template #footer>
        <UButton variant="ghost" color="neutral" @click="editOpen = false">Cancel</UButton>
        <UButton :loading="saving" @click="saveEdit">Save</UButton>
      </template>
    </UModal>

    <!-- Approve -->
    <UModal v-model:open="approveOpen" title="Approve registration">
      <template #body>
        <p class="text-sm text-muted mb-4">
          Approve <span class="font-medium text-default">{{ selected?.display_name }}</span>
          ({{ selected?.email }}). Assign at least one role unless a default is configured in CD-10.
        </p>
        <div class="space-y-3">
          <div
            v-for="(row, i) in approveRoles"
            :key="i"
            class="grid sm:grid-cols-2 gap-3"
          >
            <UFormField label="Role">
              <USelectMenu
                v-model="row.role_id"
                :items="roleItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Jurisdiction">
              <USelectMenu
                v-model="row.unit_id"
                :items="unitItems"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton variant="ghost" color="neutral" @click="approveOpen = false">Cancel</UButton>
        <UButton color="success" :loading="saving" @click="approveUser">Approve</UButton>
      </template>
    </UModal>

    <!-- Reject -->
    <UModal v-model:open="rejectOpen" title="Reject registration">
      <template #body>
        <p class="text-sm text-muted mb-4">
          Reject registration for <span class="font-medium text-default">{{ selected?.display_name }}</span>.
        </p>
        <UFormField label="Reason (optional)">
          <UTextarea v-model="rejectReason" class="w-full" :rows="3" />
        </UFormField>
      </template>
      <template #footer>
        <UButton variant="ghost" color="neutral" @click="rejectOpen = false">Cancel</UButton>
        <UButton color="error" :loading="saving" @click="rejectUser">Reject</UButton>
      </template>
    </UModal>
  </div>
</template>
