<script setup lang="ts">
definePageMeta({ layout: 'shell' });

const route = useRoute();
const { api } = useApi();
const { user, fetchMe } = useAuth();
const { canPage } = usePermissions();
const toast = useToast();

const userId = computed(() => String(route.params.id));

interface UserRole {
  id: string;
  role_id: string;
  role_name: string;
  unit_id: string | null;
  unit_name: string | null;
}

interface StaffUserDetail {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  registration_status: string;
  profile: Record<string, string>;
  created_at: string;
  open_case_count: number;
  roles: UserRole[];
}

interface AssignmentSummary {
  open_cases: number;
  assignments_made_30d: number;
}

interface CurrentCaseRow {
  id: string;
  reference: string;
  status: string;
  status_tag: string;
  summary: string;
  priority: string;
  level_code: string;
  unit_name: string | null;
  updated_at: string;
  created_at: string;
}

interface ActivityRow {
  id: string;
  case_id: string;
  reference: string;
  summary: string;
  from_assignee_id: string | null;
  from_assignee_name: string | null;
  to_assignee_id: string | null;
  to_assignee_name: string | null;
  note: string | null;
  created_at: string;
}

const profile = ref<StaffUserDetail | null>(null);
const summary = ref<AssignmentSummary | null>(null);
const initialLoading = ref(true);
const tab = ref<'current' | 'activity'>('current');

const currentCases = ref<CurrentCaseRow[]>([]);
const currentTotal = ref(0);
const currentPage = ref(1);
const currentRefreshing = ref(false);

const activity = ref<ActivityRow[]>([]);
const activityTotal = ref(0);
const activityPage = ref(1);
const activityLoading = ref(false);
const activityRefreshing = ref(false);
const activityLoaded = ref(false);

const statusColor: Record<string, 'warning' | 'success' | 'error' | 'neutral' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

const tagColor: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'error',
  on_hold: 'neutral',
  appeal: 'warning',
};

const tabItems = computed(() => [
  {
    label: summary.value != null ? `Current cases (${summary.value.open_cases})` : 'Current cases',
    value: 'current',
    icon: 'i-lucide-inbox',
  },
  {
    label:
      summary.value != null
        ? `Assignments made (${summary.value.assignments_made_30d} in 30d)`
        : 'Assignments made',
    value: 'activity',
    icon: 'i-lucide-arrow-right-left',
  },
]);

function formatRoles(row: StaffUserDetail): string {
  if (!row.roles.length) return '—';
  return row.roles
    .map((r) => (r.unit_name ? `${r.role_name} @ ${r.unit_name}` : r.role_name))
    .join(', ');
}

function activityLabel(row: ActivityRow): string {
  const from = row.from_assignee_name ?? 'Unassigned';
  const to = row.to_assignee_name ?? 'Unassigned';
  if (row.from_assignee_id && row.to_assignee_id) return `${from} → ${to}`;
  if (row.to_assignee_id) return `Assigned to ${to}`;
  if (row.from_assignee_id) return `Unassigned from ${from}`;
  return 'Assignment updated';
}

function resetTabState() {
  currentPage.value = 1;
  activityPage.value = 1;
  activityLoaded.value = false;
  activity.value = [];
  activityTotal.value = 0;
}

async function loadInitial() {
  initialLoading.value = true;
  try {
    const profileRes = await api<{ user: StaffUserDetail; assignments: AssignmentSummary }>(
      `/api/v1/users/${userId.value}`,
    );
    profile.value = profileRes.user;
    summary.value = profileRes.assignments;
  } catch {
    profile.value = null;
    summary.value = null;
    toast.add({ title: 'User not found', color: 'error' });
    await navigateTo('/admin/settings/users');
    return;
  } finally {
    initialLoading.value = false;
  }

  try {
    const casesRes = await api<{ cases: CurrentCaseRow[]; total: number }>(
      `/api/v1/users/${userId.value}/assignments/current`,
      { query: { page: currentPage.value, page_size: 20 } },
    );
    currentCases.value = casesRes.cases;
    currentTotal.value = casesRes.total;
  } catch {
    currentCases.value = [];
    currentTotal.value = 0;
    toast.add({ title: 'Could not load assigned cases', color: 'error' });
  }
}

async function loadCurrentCases(silent = false) {
  if (silent) currentRefreshing.value = true;
  try {
    const res = await api<{ cases: CurrentCaseRow[]; total: number }>(
      `/api/v1/users/${userId.value}/assignments/current`,
      { query: { page: currentPage.value, page_size: 20 } },
    );
    currentCases.value = res.cases;
    currentTotal.value = res.total;
  } finally {
    currentRefreshing.value = false;
  }
}

async function loadActivity(silent = false) {
  if (silent) activityRefreshing.value = true;
  else activityLoading.value = true;
  try {
    const res = await api<{ activity: ActivityRow[]; total: number }>(
      `/api/v1/users/${userId.value}/assignments/activity`,
      { query: { page: activityPage.value, page_size: 20 } },
    );
    activity.value = res.activity;
    activityTotal.value = res.total;
    activityLoaded.value = true;
  } finally {
    activityLoading.value = false;
    activityRefreshing.value = false;
  }
}

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  if (!canPage('/admin/settings/users')) return navigateTo('/admin/settings');
  await loadInitial();
});

watch(currentPage, (page, prev) => {
  if (page !== prev && !initialLoading.value) loadCurrentCases(true);
});

watch(activityPage, (page, prev) => {
  if (page !== prev && activityLoaded.value) loadActivity(true);
});

watch(tab, (value) => {
  if (value === 'activity' && !activityLoaded.value && !initialLoading.value) {
    void loadActivity();
  }
});

watch(userId, async () => {
  resetTabState();
  tab.value = 'current';
  await loadInitial();
});
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8">
    <UButton
      to="/admin/settings/users"
      variant="ghost"
      color="neutral"
      icon="i-lucide-arrow-left"
      size="sm"
      class="mb-4"
    >
      Back to users
    </UButton>

    <div v-if="initialLoading" class="py-20 text-center text-sm text-muted">Loading workload…</div>

    <template v-else-if="profile">
      <div class="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 class="text-2xl font-semibold mb-1">{{ profile.display_name }}</h1>
          <p class="text-sm text-muted font-mono">{{ profile.email }}</p>
          <p v-if="profile.profile?.phone" class="text-sm text-muted mt-1">{{ profile.profile.phone }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UBadge :color="statusColor[profile.registration_status] ?? 'neutral'" variant="subtle">
            {{ profile.registration_status }}
          </UBadge>
          <UBadge :color="profile.active ? 'success' : 'neutral'" variant="subtle">
            {{ profile.active ? 'Active' : 'Inactive' }}
          </UBadge>
        </div>
      </div>

      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        <UCard :ui="{ body: 'p-4' }">
          <p class="text-xs text-muted uppercase tracking-wide mb-1">Open cases</p>
          <p class="text-2xl font-semibold">{{ summary?.open_cases ?? 0 }}</p>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <p class="text-xs text-muted uppercase tracking-wide mb-1">Assignments (30 days)</p>
          <p class="text-2xl font-semibold">{{ summary?.assignments_made_30d ?? 0 }}</p>
        </UCard>
        <UCard :ui="{ body: 'p-4' }">
          <p class="text-xs text-muted uppercase tracking-wide mb-1">Jurisdictions</p>
          <p class="text-sm leading-snug">{{ formatRoles(profile) }}</p>
        </UCard>
      </div>

      <UButton
        variant="outline"
        size="sm"
        icon="i-lucide-briefcase"
        class="mb-5"
        :to="`/cases?assignee_id=${profile.id}`"
      >
        View in case list
      </UButton>

      <UTabs v-model="tab" :items="tabItems" class="mb-4" />

      <div v-if="tab === 'current'">
        <div
          v-if="currentCases.length === 0"
          class="py-12 text-center text-sm text-muted border border-default rounded-lg"
        >
          No open cases currently assigned to this officer.
        </div>
        <div v-else class="relative border border-default rounded-lg overflow-hidden">
          <div class="overflow-x-auto transition-opacity" :class="{ 'opacity-50': currentRefreshing }">
            <table class="w-full min-w-[680px] text-sm">
              <thead class="bg-elevated/50">
                <tr class="border-b border-default">
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Reference</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Summary</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Status</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Location</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Updated</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="c in currentCases"
                  :key="c.id"
                  class="hover:bg-elevated/50 cursor-pointer"
                  @click="navigateTo(`/cases/${c.id}`)"
                >
                  <td class="py-3 px-4 font-mono font-medium">{{ c.reference }}</td>
                  <td class="py-3 px-4 max-w-xs truncate text-muted">{{ c.summary }}</td>
                  <td class="py-3 px-4">
                    <UBadge :color="(tagColor[c.status_tag] as any) ?? 'neutral'" variant="subtle">{{ c.status }}</UBadge>
                  </td>
                  <td class="py-3 px-4 text-muted">{{ c.unit_name ?? '—' }}</td>
                  <td class="py-3 px-4 text-muted">{{ new Date(c.updated_at).toLocaleDateString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="currentTotal > 20" class="flex justify-end mt-4">
          <UPagination v-model:page="currentPage" :total="currentTotal" :items-per-page="20" />
        </div>
      </div>

      <div v-else>
        <div
          v-if="activityLoading && !activityLoaded"
          class="py-12 text-center text-sm text-muted border border-default rounded-lg"
        >
          Loading assignment history…
        </div>
        <div
          v-else-if="activity.length === 0"
          class="py-12 text-center text-sm text-muted border border-default rounded-lg"
        >
          No assignment actions recorded for this officer.
        </div>
        <div v-else class="relative border border-default rounded-lg overflow-hidden">
          <div class="overflow-x-auto transition-opacity" :class="{ 'opacity-50': activityRefreshing }">
            <table class="w-full min-w-[720px] text-sm">
              <thead class="bg-elevated/50">
                <tr class="border-b border-default">
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">When</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Case</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Action</th>
                  <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase">Note</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-default">
                <tr
                  v-for="row in activity"
                  :key="row.id"
                  class="hover:bg-elevated/50 cursor-pointer"
                  @click="navigateTo(`/cases/${row.case_id}`)"
                >
                  <td class="py-3 px-4 text-muted whitespace-nowrap">
                    {{ new Date(row.created_at).toLocaleString() }}
                  </td>
                  <td class="py-3 px-4">
                    <div class="font-mono font-medium">{{ row.reference }}</div>
                    <div class="text-muted text-xs truncate max-w-xs">{{ row.summary }}</div>
                  </td>
                  <td class="py-3 px-4">{{ activityLabel(row) }}</td>
                  <td class="py-3 px-4 text-muted text-xs max-w-xs truncate">{{ row.note ?? '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="activityTotal > 20" class="flex justify-end mt-4">
          <UPagination v-model:page="activityPage" :total="activityTotal" :items-per-page="20" />
        </div>
      </div>
    </template>
  </div>
</template>
