<script setup lang="ts">
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
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6 gap-3">
      <div>
        <h1 class="text-2xl font-semibold">Cases</h1>
        <p class="text-muted text-sm">
          {{ total }} case(s)
          <span v-if="!tenantWide && unitId" class="text-muted">· jurisdiction filter active</span>
        </p>
      </div>
      <UButton to="/" variant="ghost" icon="i-lucide-arrow-left">Dashboard</UButton>
    </div>

    <div class="flex flex-col sm:flex-row gap-3 mb-4">
      <UInput v-model="q" placeholder="Search reference or summary…" icon="i-lucide-search" class="w-full sm:w-72" />
      <div class="flex flex-wrap gap-3">
        <USelectMenu
          v-if="filterUnits.length"
          v-model="unitId"
          :items="unitItems"
          value-key="value"
          label-key="label"
          placeholder="All jurisdictions"
          class="flex-1 sm:w-56"
        />
        <USelectMenu
          v-model="status"
          :items="['Sorting', 'Investigation', 'Escalated', 'Returned', 'Resolved', 'Closed', 'Rejected', 'In Court']"
          placeholder="All statuses"
          class="flex-1 sm:w-48"
        />
        <UButton v-if="status || (unitId && unitId !== defaultUnitId)" variant="ghost" size="sm" @click="clearFilters">
          Clear filters
        </UButton>
      </div>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div v-if="loading" class="p-8 text-center text-muted">Loading…</div>
      <div v-else-if="rows.length === 0" class="p-8 text-center text-muted">No cases found.</div>
      <div v-else class="overflow-x-auto p-4">
      <table class="w-full min-w-[680px] text-sm">
        <thead>
          <tr class="text-left text-muted border-b border-default">
            <th class="py-2 pr-4">Reference</th>
            <th class="py-2 pr-4">Summary</th>
            <th class="py-2 pr-4">Status</th>
            <th class="py-2 pr-4">Location</th>
            <th class="py-2 pr-4">Level</th>
            <th class="py-2">Received</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="c in rows"
            :key="c.id"
            class="border-b border-default hover:bg-elevated cursor-pointer"
            @click="navigateTo(`/cases/${c.id}`)"
          >
            <td class="py-2.5 pr-4 font-mono font-medium">
              {{ c.reference }}
              <UBadge v-if="c.anonymous" size="sm" color="neutral" variant="subtle" class="ml-1">anon</UBadge>
            </td>
            <td class="py-2.5 pr-4 max-w-sm truncate">{{ c.summary }}</td>
            <td class="py-2.5 pr-4">
              <UBadge :color="(tagColor[c.statusTag] as any) ?? 'neutral'" variant="subtle">{{ c.status }}</UBadge>
            </td>
            <td class="py-2.5 pr-4">{{ c.unitName ?? '—' }}</td>
            <td class="py-2.5 pr-4 capitalize">{{ c.levelCode }}</td>
            <td class="py-2.5">{{ new Date(c.createdAt).toLocaleDateString() }}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </UCard>
  </div>
</template>
