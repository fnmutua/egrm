<script setup lang="ts">
definePageMeta({ layout: 'shell' });

import { hasPermission } from '@egrm/core';
import { useDashboardUnitFilter } from '~/composables/useDashboardUnitFilter';
import { CASE_LIST_FILTER_OPTIONS, useCaseListFilterPrefs } from '~/composables/useCaseListFilterPrefs';

const route = useRoute();
const router = useRouter();
const { api } = useApi();
const { user, fetchMe } = useAuth();
const { loadCaseCount } = useCaseCount();
const { canAdmin, managesStaffUsers } = usePermissions();
const toast = useToast();
const { prefs, setFilter, activeCount } = useCaseListFilterPrefs();
const { effectiveUnitId, hasActiveFilter, resetFilter: resetUnitFilter, setEnabled, setScopedRoot } = useDashboardUnitFilter('cases');

const isAdmin = computed(() => canAdmin());
const canFileCase = computed(() => hasPermission(user.value?.permissions ?? [], 'case:create_assisted'));

interface CaseRow {
  id: string;
  reference: string;
  status: string;
  statusTag: string;
  levelCode: string;
  categories: string[];
  summary: string;
  channel: string;
  anonymous: boolean;
  priority: string;
  createdAt: string;
  unitName: string | null;
}

const q = ref('');
const STATUS_ALL = '__all__';
const ASSIGNEE_ALL = '__all_assignees__';
const status = ref<string>(STATUS_ALL);
const assigneeId = ref<string>(ASSIGNEE_ALL);
const staffUsers = ref<{ id: string; display_name: string; email: string }[]>([]);
const page = ref(1);
const rows = ref<CaseRow[]>([]);
const total = ref(0);
const loading = ref(false);
const downloading = ref(false);
const statusItems = ref<{ value: string; label: string }[]>([]);
const filtersReady = ref(false);
const seedCount = ref(50);
const seedCasesTotal = ref(0);
const seedOpen = ref(false);
const clearSeedOpen = ref(false);
const seeding = ref(false);
const clearingSeed = ref(false);

interface JurisdictionScope {
  tenant_wide: boolean;
  units: { id: string; name: string; level_code: string }[];
  jurisdiction_roots: { id: string; name: string; level_code: string }[];
  default_unit_id: string | null;
}

const JURISDICTION_ALL = '__all_jurisdictions__';

type CaseListView = 'jurisdiction' | 'assigned';

const jurisdictionScope = ref<JurisdictionScope | null>(null);
const selectedJurisdictionRoot = ref<string>(JURISDICTION_ALL);
const listView = ref<CaseListView>('jurisdiction');
const jurisdictionTabTotal = ref<number | null>(null);
const assignedTabTotal = ref<number | null>(null);

const isAssigneeFilterActive = computed(() => assigneeId.value !== ASSIGNEE_ALL);

const assigneeFilterUser = computed(() =>
  staffUsers.value.find((u) => u.id === assigneeId.value) ?? null,
);

const assigneeSelectItems = computed(() => [
  { value: ASSIGNEE_ALL, label: 'All assignees' },
  ...staffUsers.value.map((u) => ({
    value: u.id,
    label: `${u.display_name} (${u.email})`,
  })),
]);

const showAssigneeFilter = computed(() => managesStaffUsers.value && staffUsers.value.length > 0);

const showJurisdictionTabs = computed(() => isJurisdictionScoped.value && !isAssigneeFilterActive.value);

const isJurisdictionScoped = computed(() => jurisdictionScope.value?.tenant_wide === false);

async function loadStaffUsers() {
  if (!managesStaffUsers.value) return;
  try {
    const res = await api<{ users: { id: string; display_name: string; email: string; active: boolean }[] }>(
      '/api/v1/users',
      { query: { registration_status: 'approved' } },
    );
    staffUsers.value = res.users.filter((u) => u.active);
  } catch {
    staffUsers.value = [];
  }
}

function syncAssigneeFromRoute() {
  const fromQuery = route.query.assignee_id;
  if (typeof fromQuery === 'string' && fromQuery) {
    assigneeId.value = fromQuery;
  }
}

function syncAssigneeToRoute() {
  const query = { ...route.query };
  if (assigneeId.value === ASSIGNEE_ALL) {
    delete query.assignee_id;
  } else {
    query.assignee_id = assigneeId.value;
  }
  void router.replace({ query });
}

const hasMultipleJurisdictions = computed(
  () => (jurisdictionScope.value?.jurisdiction_roots?.length ?? 0) > 1,
);

const jurisdictionRootItems = computed(() => [
  { value: JURISDICTION_ALL, label: 'All my jurisdictions' },
  ...(jurisdictionScope.value?.jurisdiction_roots ?? []).map((r) => ({
    value: r.id,
    label: r.name,
  })),
]);

const jurisdictionScopeLabel = computed(() => {
  const roots = jurisdictionScope.value?.jurisdiction_roots ?? [];
  if (!isJurisdictionScoped.value) return null;
  if (!roots.length) return 'your assigned jurisdictions';
  return roots.map((r) => r.name).join(', ');
});

const showUnitCascade = computed(() => {
  if (!prefs.value.unit) return false;
  if (isAssigneeFilterActive.value) return true;
  if (listView.value !== 'jurisdiction') return false;
  if (!isJurisdictionScoped.value) return true;
  if (!hasMultipleJurisdictions.value) return true;
  return selectedJurisdictionRoot.value !== JURISDICTION_ALL;
});

const effectiveCaseUnitId = computed(() => effectiveUnitId.value);

const selectedScopeRoot = computed(() =>
  hasMultipleJurisdictions.value && selectedJurisdictionRoot.value !== JURISDICTION_ALL
    ? selectedJurisdictionRoot.value
    : null,
);

const statusSelectItems = computed(() => [
  { value: STATUS_ALL, label: 'All statuses' },
  ...statusItems.value,
]);

const tagColor: Record<string, string> = {
  open: 'info', in_progress: 'warning', resolved: 'success',
  closed: 'neutral', rejected: 'error', on_hold: 'neutral', appeal: 'warning',
};

const jurisdictionBannerText = computed(() => {
  const roots = jurisdictionScopeLabel.value ?? 'your assigned jurisdictions';
  if (listView.value === 'assigned') {
    return 'Cases assigned directly to you, including those outside your jurisdiction areas (e.g. cross-region assignments).';
  }
  if (selectedScopeRoot.value) {
    const name =
      jurisdictionScope.value?.jurisdiction_roots.find((r) => r.id === selectedScopeRoot.value)?.name ??
      'this jurisdiction';
    return `Cases located in ${name}. Use the unit filter to drill down further.`;
  }
  return `Cases located in ${roots}. Pick a jurisdiction above to narrow the list, or use the unit filter to drill down within one area.`;
});

const listTabItems = computed(() => [
  {
    label: jurisdictionTabTotal.value != null ? `In my jurisdiction (${jurisdictionTabTotal.value})` : 'In my jurisdiction',
    value: 'jurisdiction',
    icon: 'i-lucide-map-pin',
  },
  {
    label: assignedTabTotal.value != null ? `Assigned to me (${assignedTabTotal.value})` : 'Assigned to me',
    value: 'assigned',
    icon: 'i-lucide-user-check',
  },
]);

const pageSubtitle = computed(() => {
  if (isAssigneeFilterActive.value && assigneeFilterUser.value) {
    return `${total.value} case(s) assigned to ${assigneeFilterUser.value.display_name}`;
  }
  if (!isJurisdictionScoped.value) {
    return hasActiveFilter.value ? `${total.value} case(s) · unit filter active` : `${total.value} case(s)`;
  }
  if (listView.value === 'assigned') {
    return `${total.value} case(s) assigned to you`;
  }
  const area = selectedScopeRoot.value
    ? jurisdictionScope.value?.jurisdiction_roots.find((r) => r.id === selectedScopeRoot.value)?.name
    : jurisdictionScopeLabel.value;
  return `${total.value} case(s) in ${area ?? 'your jurisdictions'}`;
});

const hasActiveFilters = computed(() =>
  Boolean(
    q.value ||
      (prefs.value.status && status.value !== STATUS_ALL) ||
      isAssigneeFilterActive.value ||
      (listView.value === 'jurisdiction' && hasActiveFilter.value) ||
      (listView.value === 'jurisdiction' && hasMultipleJurisdictions.value && selectedJurisdictionRoot.value !== JURISDICTION_ALL),
  ),
);

async function loadJurisdictionScope() {
  try {
    jurisdictionScope.value = await api<JurisdictionScope>('/api/v1/cases/filter-units');
  } catch {
    jurisdictionScope.value = null;
  }
}

async function loadStatusOptions() {
  try {
    const res = await api<{ payload?: { statuses?: { name: string }[] } }>('/api/v1/config/cd04_workflow');
    const names = (res.payload?.statuses ?? []).map((s) => s.name).filter(Boolean);
    statusItems.value = names.map((name) => ({ value: name, label: name }));
  } catch {
    statusItems.value = [];
  }
}

async function loadSeedCount() {
  if (!isAdmin.value) return;
  try {
    const res = await api<{ count: number }>('/api/v1/cases/seed/count');
    seedCasesTotal.value = res.count;
  } catch {
    seedCasesTotal.value = 0;
  }
}

async function confirmSeed() {
  seeding.value = true;
  try {
    const res = await api<{ created: number; by_status: Record<string, number> }>('/api/v1/cases/seed', {
      method: 'POST',
      body: { count: seedCount.value },
    });
    seedOpen.value = false;
    page.value = 1;
    await Promise.all([load(), loadSeedCount()]);
    toast.add({
      title: `${res.created} seed case(s) created`,
      description: 'No notifications were sent. Cases are tagged with channel “seed”.',
      color: 'success',
    });
  } catch (e: unknown) {
    const err = e as { data?: { error?: string } };
    toast.add({ title: err.data?.error ?? 'Seed failed', color: 'error' });
  } finally {
    seeding.value = false;
  }
}

async function confirmClearSeed() {
  clearingSeed.value = true;
  try {
    const res = await api<{ cases: number }>('/api/v1/cases/seed/clear', { method: 'POST', body: {} });
    clearSeedOpen.value = false;
    page.value = 1;
    await Promise.all([load(), loadSeedCount()]);
    toast.add({
      title: res.cases ? `${res.cases} seed case(s) removed` : 'No seed cases to remove',
      color: 'success',
    });
  } catch (e: unknown) {
    const err = e as { data?: { error?: string } };
    toast.add({ title: err.data?.error ?? 'Clear failed', color: 'error' });
  } finally {
    clearingSeed.value = false;
  }
}

function clearFilters() {
  q.value = '';
  status.value = STATUS_ALL;
  assigneeId.value = ASSIGNEE_ALL;
  selectedJurisdictionRoot.value = JURISDICTION_ALL;
  resetUnitFilter();
  syncAssigneeToRoute();
}

async function loadTabCounts() {
  if (!isJurisdictionScoped.value || isAssigneeFilterActive.value) {
    jurisdictionTabTotal.value = null;
    assignedTabTotal.value = null;
    return;
  }
  const base = {
    q: prefs.value.search && q.value ? q.value : undefined,
    status: prefs.value.status && status.value !== STATUS_ALL ? status.value : undefined,
  };
  try {
    const [j, a] = await Promise.all([
      api<{ total: number }>('/api/v1/cases', {
        query: {
          ...base,
          view: 'jurisdiction',
          scope_root: selectedScopeRoot.value ?? undefined,
          unit_id: prefs.value.unit ? effectiveCaseUnitId.value ?? undefined : undefined,
          page: 1,
          page_size: 1,
        },
      }),
      api<{ total: number }>('/api/v1/cases', {
        query: { ...base, view: 'assigned', page: 1, page_size: 1 },
      }),
    ]);
    jurisdictionTabTotal.value = j.total;
    assignedTabTotal.value = a.total;
  } catch {
    jurisdictionTabTotal.value = null;
    assignedTabTotal.value = null;
  }
}

async function load() {
  if (!filtersReady.value) return;
  loading.value = true;
  try {
    const geographic = !isAssigneeFilterActive.value && (!isJurisdictionScoped.value || listView.value === 'jurisdiction');
    const res = await api<{ cases: CaseRow[]; total: number }>('/api/v1/cases', {
      query: {
        q: prefs.value.search && q.value ? q.value : undefined,
        status: prefs.value.status && status.value !== STATUS_ALL ? status.value : undefined,
        assignee_id: isAssigneeFilterActive.value ? assigneeId.value : undefined,
        view: !isAssigneeFilterActive.value && isJurisdictionScoped.value ? listView.value : undefined,
        scope_root: geographic ? selectedScopeRoot.value ?? undefined : undefined,
        unit_id: geographic && prefs.value.unit ? effectiveCaseUnitId.value ?? undefined : undefined,
        page: page.value,
        page_size: 20,
      },
    });
    rows.value = res.cases;
    total.value = res.total;
    if (isJurisdictionScoped.value && !isAssigneeFilterActive.value) {
      if (listView.value === 'jurisdiction') jurisdictionTabTotal.value = res.total;
      else assignedTabTotal.value = res.total;
      void loadTabCounts();
    }
    loadCaseCount();
  } finally {
    loading.value = false;
  }
}

function refresh() {
  void load();
}

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  setEnabled(true);
  syncAssigneeFromRoute();
  await Promise.all([loadStatusOptions(), loadJurisdictionScope(), loadStaffUsers()]);
  filtersReady.value = true;
  await Promise.all([load(), loadSeedCount()]);
});

onBeforeUnmount(() => {
  setEnabled(false);
});

watch([q, status, assigneeId, effectiveCaseUnitId, selectedScopeRoot, listView], () => {
  page.value = 1;
});
watch(assigneeId, () => syncAssigneeToRoute());
watch([q, status, assigneeId, effectiveCaseUnitId, selectedScopeRoot, listView, page, prefs], () => load(), { deep: true });

watch(listView, (view) => {
  if (view === 'assigned') {
    selectedJurisdictionRoot.value = JURISDICTION_ALL;
    resetUnitFilter();
  }
});

watch(selectedJurisdictionRoot, (value) => {
  const root =
    value !== JURISDICTION_ALL && hasMultipleJurisdictions.value
      ? jurisdictionScope.value?.jurisdiction_roots.find((r) => r.id === value)
      : null;
  setScopedRoot(root?.id ?? null, root?.level_code ?? null);
}, { flush: 'sync' });

function escapeCell(v: unknown): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

async function downloadExcel() {
  downloading.value = true;
  try {
    const geographic = !isAssigneeFilterActive.value && (!isJurisdictionScoped.value || listView.value === 'jurisdiction');
    const res = await api<{ cases: CaseRow[] }>('/api/v1/cases', {
      query: {
        q: prefs.value.search && q.value ? q.value : undefined,
        status: prefs.value.status && status.value !== STATUS_ALL ? status.value : undefined,
        assignee_id: isAssigneeFilterActive.value ? assigneeId.value : undefined,
        view: !isAssigneeFilterActive.value && isJurisdictionScoped.value ? listView.value : undefined,
        scope_root: geographic ? selectedScopeRoot.value ?? undefined : undefined,
        unit_id: geographic && prefs.value.unit ? effectiveCaseUnitId.value ?? undefined : undefined,
        page: 1,
        page_size: 5000,
      },
    });
    const headers = ['Reference', 'Summary', 'Status', 'Location', 'Level', 'Channel', 'Priority', 'Anonymous', 'Received'];
    const csvRows = res.cases.map((c) => [
      c.reference,
      c.summary,
      c.status,
      c.unitName ?? '',
      c.levelCode,
      c.channel,
      c.priority,
      c.anonymous ? 'Yes' : 'No',
      new Date(c.createdAt).toLocaleDateString(),
    ].map(escapeCell).join(','));

    const csv = [headers.join(','), ...csvRows].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <div v-if="user" class="p-4 sm:p-6">
    <!-- Page header -->
    <div class="flex items-center justify-between mb-6 gap-3">
      <div>
        <h1 class="text-xl font-semibold">Cases</h1>
        <p class="text-muted text-sm">{{ pageSubtitle }}</p>
      </div>
    </div>

    <UTabs
      v-if="showJurisdictionTabs"
      v-model="listView"
      :items="listTabItems"
      class="mb-4"
    />

    <UAlert
      v-if="isAssigneeFilterActive && assigneeFilterUser"
      color="info"
      variant="subtle"
      icon="i-lucide-user-check"
      class="mb-4"
      title="Assignee filter"
      :description="`Showing cases assigned to ${assigneeFilterUser.display_name}. Jurisdiction scope still applies to what you can see.`"
    />

    <UAlert
      v-else-if="isJurisdictionScoped"
      color="info"
      variant="subtle"
      icon="i-lucide-map-pin"
      class="mb-4"
      :title="listView === 'assigned' ? 'Your assignments' : 'Jurisdiction scope'"
      :description="jurisdictionBannerText"
    />

    <!-- Toolbar -->
    <div class="flex flex-col sm:flex-row gap-2 flex-wrap items-center mb-4">
      <UButton
        variant="outline"
        icon="i-lucide-refresh-cw"
        size="sm"
        aria-label="Refresh list"
        :loading="loading"
        class="shrink-0"
        @click="refresh"
      />
      <UInput
        v-if="prefs.search"
        v-model="q"
        placeholder="Search reference or summary…"
        icon="i-lucide-search"
        class="w-full sm:w-72"
      />
      <USelectMenu
        v-if="prefs.status"
        v-model="status"
        :items="statusSelectItems"
        value-key="value"
        label-key="label"
        class="w-full sm:w-44"
      />
      <USelectMenu
        v-if="showAssigneeFilter"
        v-model="assigneeId"
        :items="assigneeSelectItems"
        value-key="value"
        label-key="label"
        placeholder="Assignee"
        class="w-full sm:w-56"
      />
      <USelectMenu
        v-if="prefs.unit && listView === 'jurisdiction' && isJurisdictionScoped && hasMultipleJurisdictions"
        v-model="selectedJurisdictionRoot"
        :items="jurisdictionRootItems"
        value-key="value"
        label-key="label"
        class="w-full sm:w-52"
      />
      <DashboardUnitFilter
        v-if="showUnitCascade"
        :key="selectedScopeRoot ?? 'all-jurisdictions'"
        scope="cases"
        auto-skip-top
      />
      <div class="flex gap-2 sm:ml-auto flex-wrap items-center">
          <UButton
            v-if="canFileCase"
            to="/cases/new"
            icon="i-lucide-file-plus"
            size="sm"
            aria-label="File case"
          />
          <UPopover :content="{ side: 'bottom', align: 'end' }">
            <UButton
              variant="outline"
              size="sm"
              icon="i-lucide-sliders-horizontal"
              :label="`Filters (${activeCount})`"
            />
            <template #content>
              <div class="p-3 space-y-2 min-w-48">
                <p class="text-xs font-medium text-muted uppercase tracking-wide">Show filters</p>
                <label
                  v-for="opt in CASE_LIST_FILTER_OPTIONS"
                  :key="opt.key"
                  class="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <UCheckbox
                    :model-value="prefs[opt.key]"
                    @update:model-value="setFilter(opt.key, $event as boolean)"
                  />
                  {{ opt.label }}
                </label>
              </div>
            </template>
          </UPopover>
          <UButton v-if="hasActiveFilters" variant="ghost" size="sm" @click="clearFilters">
            Clear
          </UButton>
          <UButton
            variant="outline"
            icon="i-lucide-download"
            size="sm"
            aria-label="Export"
            :loading="downloading"
            :disabled="total === 0"
            @click="downloadExcel"
          />
          <template v-if="isAdmin">
            <UButton
              variant="outline"
              icon="i-lucide-flask-conical"
              size="sm"
              @click="seedOpen = true"
            >
              Seed cases
            </UButton>
            <UButton
              variant="outline"
              color="error"
              icon="i-lucide-trash-2"
              size="sm"
              :disabled="seedCasesTotal === 0"
              @click="clearSeedOpen = true"
            >
              Clear seed ({{ seedCasesTotal }})
            </UButton>
          </template>
      </div>
    </div>

    <!-- Table -->
    <div class="border border-default rounded-lg overflow-hidden">
      <div v-if="loading" class="py-16 text-center text-sm text-muted">Loading…</div>
      <div v-else-if="rows.length === 0" class="py-16 text-center text-sm text-muted">
        {{
          isAssigneeFilterActive
            ? 'No cases assigned to this officer in your scope.'
            : listView === 'assigned'
              ? 'No cases assigned to you.'
              : 'No cases found in this jurisdiction.'
        }}
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full min-w-[680px] text-sm">
          <thead class="bg-elevated/50">
            <tr class="border-b border-default">
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Reference</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Summary</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Status</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Location</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Level</th>
              <th class="py-3 px-4 text-left text-xs font-medium text-muted uppercase tracking-wide">Received</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr
              v-for="c in rows"
              :key="c.id"
              class="hover:bg-elevated/50 cursor-pointer transition-colors"
              @click="navigateTo(`/cases/${c.id}`)"
            >
              <td class="py-3.5 px-4 font-mono font-medium whitespace-nowrap">
                {{ c.reference }}
                <UBadge v-if="c.anonymous" size="xs" color="neutral" variant="subtle" class="ml-1">anon</UBadge>
              </td>
              <td class="py-3.5 px-4 max-w-xs truncate text-muted">{{ c.summary }}</td>
              <td class="py-3.5 px-4 whitespace-nowrap">
                <UBadge :color="(tagColor[c.statusTag] as any) ?? 'neutral'" variant="subtle">{{ c.status }}</UBadge>
              </td>
              <td class="py-3.5 px-4 text-muted whitespace-nowrap">{{ c.unitName ?? '—' }}</td>
              <td class="py-3.5 px-4 capitalize text-muted whitespace-nowrap">{{ c.levelCode }}</td>
              <td class="py-3.5 px-4 text-muted whitespace-nowrap">{{ new Date(c.createdAt).toLocaleDateString() }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="rows.length > 0" class="flex items-center justify-between mt-4 text-sm text-muted">
      <span>{{ (page - 1) * 20 + 1 }}–{{ Math.min(page * 20, total) }} of {{ total }}</span>
      <UPagination v-model:page="page" :total="total" :items-per-page="20" />
    </div>

    <UModal
      v-model:open="seedOpen"
      title="Seed test cases"
      description="Creates synthetic cases across all workflow statuses with varied categories, priorities, and locations. No email, SMS, or WhatsApp messages are sent."
    >
      <template #body>
        <UFormField label="Number of cases" hint="1–500, spread evenly across statuses">
          <UInput v-model.number="seedCount" type="number" min="1" max="500" class="w-full" />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="seedOpen = false">Cancel</UButton>
          <UButton :loading="seeding" @click="confirmSeed">Create seed cases</UButton>
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="clearSeedOpen"
      title="Clear seed cases?"
      :description="`Permanently deletes ${seedCasesTotal} seed case(s) and their parties. Real cases submitted through intake are not affected.`"
    >
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton variant="ghost" color="neutral" @click="clearSeedOpen = false">Cancel</UButton>
          <UButton :loading="clearingSeed" color="error" @click="confirmClearSeed">Clear seed data</UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
