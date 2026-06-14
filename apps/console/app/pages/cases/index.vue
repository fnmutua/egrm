<script setup lang="ts">
definePageMeta({ layout: 'shell' });

const { api } = useApi();
const { user, fetchMe } = useAuth();

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

interface FilterUnit {
  id: string;
  name: string;
  level_code: string;
}

const q = ref('');
const status = ref<string | undefined>(undefined);
const unitId = ref<string | null | undefined>(undefined);
const page = ref(1);
const rows = ref<CaseRow[]>([]);
const total = ref(0);
const loading = ref(false);
const downloading = ref(false);
const filterUnits = ref<FilterUnit[]>([]);
const tenantWide = ref(true);
const defaultUnitId = ref<string | undefined>(undefined);
const filtersReady = ref(false);

const unitItems = computed(() => {
  const items = filterUnits.value.map((u) => ({ value: u.id, label: `${u.name} (${u.level_code})` }));
  if (!tenantWide.value && filterUnits.value.length > 1) {
    return [{ value: null, label: 'All my jurisdictions' }, ...items];
  }
  return items;
});

const tagColor: Record<string, string> = {
  open: 'info', in_progress: 'warning', resolved: 'success',
  closed: 'neutral', rejected: 'error', on_hold: 'neutral', appeal: 'warning',
};

async function loadFilterUnits() {
  const res = await api<{
    tenant_wide: boolean;
    units: FilterUnit[];
    default_unit_id: string | null;
  }>('/api/v1/cases/filter-units');
  filterUnits.value = res.units;
  tenantWide.value = res.tenant_wide;
  defaultUnitId.value = res.default_unit_id ?? undefined;
  if (!res.tenant_wide && res.default_unit_id) {
    unitId.value = res.default_unit_id;
  }
  filtersReady.value = true;
}

function clearFilters() {
  status.value = undefined;
  unitId.value = tenantWide.value ? undefined : defaultUnitId.value;
}

async function load() {
  if (!filtersReady.value) return;
  loading.value = true;
  try {
    const res = await api<{ cases: CaseRow[]; total: number }>('/api/v1/cases', {
      query: {
        q: q.value || undefined,
        status: status.value,
        unit_id: unitId.value ?? undefined,
        page: page.value,
        page_size: 20,
      },
    });
    rows.value = res.cases;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  await loadFilterUnits();
  await load();
});

watch([q, status, unitId], () => {
  page.value = 1;
});
watch([q, status, unitId, page], () => load());

function escapeCell(v: unknown): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

async function downloadExcel() {
  downloading.value = true;
  try {
    const res = await api<{ cases: CaseRow[] }>('/api/v1/cases', {
      query: {
        q: q.value || undefined,
        status: status.value,
        unit_id: unitId.value ?? undefined,
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
        <p class="text-muted text-sm">
          {{ total }} case(s)<span v-if="!tenantWide && unitId"> · jurisdiction filter active</span>
        </p>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="flex flex-col sm:flex-row gap-2 mb-4">
      <UInput v-model="q" placeholder="Search reference or summary…" icon="i-lucide-search" class="w-full sm:w-72" />
      <div class="flex gap-2 sm:ml-auto flex-wrap">
        <USelectMenu
          v-if="filterUnits.length"
          v-model="unitId"
          :items="unitItems"
          value-key="value"
          label-key="label"
          placeholder="All jurisdictions"
          class="w-full sm:w-52"
        />
        <USelectMenu
          v-model="status"
          :items="['Sorting', 'Investigation', 'Escalated', 'Returned', 'Resolved', 'Closed', 'Rejected', 'In Court']"
          placeholder="All statuses"
          class="w-full sm:w-44"
        />
        <UButton v-if="status || (unitId && unitId !== defaultUnitId)" variant="ghost" size="sm" @click="clearFilters">
          Clear
        </UButton>
        <UButton
          variant="outline"
          icon="i-lucide-download"
          size="sm"
          :loading="downloading"
          :disabled="total === 0"
          @click="downloadExcel"
        >
          Export
        </UButton>
      </div>
    </div>

    <!-- Table -->
    <div class="border border-default rounded-lg overflow-hidden">
      <div v-if="loading" class="py-16 text-center text-sm text-muted">Loading…</div>
      <div v-else-if="rows.length === 0" class="py-16 text-center text-sm text-muted">No cases found.</div>
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
  </div>
</template>
