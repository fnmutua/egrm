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

const q = ref('');
const status = ref<string | undefined>(undefined);
const page = ref(1);
const rows = ref<CaseRow[]>([]);
const total = ref(0);
const loading = ref(false);

const tagColor: Record<string, string> = {
  open: 'info', in_progress: 'warning', resolved: 'success',
  closed: 'neutral', rejected: 'error', on_hold: 'neutral', appeal: 'warning',
};

async function load() {
  loading.value = true;
  try {
    const res = await api<{ cases: CaseRow[]; total: number }>('/api/v1/cases', {
      query: { q: q.value || undefined, status: status.value, page: page.value, page_size: 20 },
    });
    rows.value = res.cases;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  if (!(await fetchMe())) return navigateTo('/login');
  await load();
});

watch([q, status, page], () => load());
</script>

<template>
  <div v-if="user" class="p-8 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Cases</h1>
        <p class="text-muted text-sm">{{ total }} case(s)</p>
      </div>
      <UButton to="/" variant="ghost" icon="i-lucide-arrow-left">Dashboard</UButton>
    </div>

    <div class="flex gap-3 mb-4">
      <UInput v-model="q" placeholder="Search reference or summary…" icon="i-lucide-search" class="w-72" />
      <USelectMenu
        v-model="status"
        :items="['Sorting', 'Investigation', 'Escalated', 'Returned', 'Resolved', 'Closed', 'Rejected', 'In Court']"
        placeholder="All statuses"
        class="w-48"
      />
      <UButton v-if="status" variant="ghost" size="sm" @click="status = undefined">Clear</UButton>
    </div>

    <UCard>
      <div v-if="loading" class="p-8 text-center text-muted">Loading…</div>
      <div v-else-if="rows.length === 0" class="p-8 text-center text-muted">No cases found.</div>
      <table v-else class="w-full text-sm">
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
    </UCard>
  </div>
</template>
