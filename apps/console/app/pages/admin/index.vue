<script setup lang="ts">
const { api } = useApi();
const { user, fetchMe } = useAuth();

interface DomainRow {
  domain: string;
  active_version: number | null;
  activated_at: string | null;
  draft_count: number;
  latest_version: number | null;
}

const rows = ref<DomainRow[]>([]);
const loading = ref(true);

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
  if (!me.permissions.some((p) => p === 'admin:*' || p.startsWith('admin:'))) return navigateTo('/');
  const res = await api<{ domains: DomainRow[] }>('/api/v1/config');
  rows.value = res.domains;
  loading.value = false;
});

const byDomain = computed(() => new Map(rows.value.map((r) => [r.domain, r])));
</script>

<template>
  <div v-if="user" class="p-8 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-2xl font-semibold">Administration</h1>
      <UButton to="/" variant="ghost" icon="i-lucide-arrow-left">Dashboard</UButton>
    </div>
    <p class="text-muted mb-6">
      Tenant configuration registry — every domain is versioned: draft → validate → activate, with full history and rollback.
    </p>

    <div class="mb-6">
      <UCard>
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">Jurisdiction units</div>
            <div class="text-sm text-muted">Manage the unit tree (instances of the CD-02 levels): counties, settlements, …</div>
          </div>
          <UButton to="/admin/units" icon="i-lucide-network" variant="outline">Manage units</UButton>
        </div>
      </UCard>
    </div>

    <div v-if="loading" class="text-muted p-8 text-center">Loading…</div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <UCard
        v-for="meta in DOMAIN_CATALOGUE"
        :key="meta.domain"
        class="hover:ring-2 ring-primary/40 cursor-pointer transition"
        @click="navigateTo(`/admin/config/${meta.domain}`)"
      >
        <div class="flex items-start gap-3">
          <UIcon :name="meta.icon" class="text-xl text-primary mt-0.5 shrink-0" />
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium">{{ meta.title }}</span>
              <UBadge size="sm" variant="subtle" color="neutral">{{ meta.cd }}</UBadge>
            </div>
            <p class="text-xs text-muted mt-1 line-clamp-2">{{ meta.description }}</p>
            <div class="flex items-center gap-2 mt-2">
              <UBadge
                v-if="byDomain.get(meta.domain)?.active_version"
                size="sm" color="success" variant="subtle"
              >
                v{{ byDomain.get(meta.domain)!.active_version }} active
              </UBadge>
              <UBadge v-else size="sm" color="warning" variant="subtle">not configured</UBadge>
              <UBadge
                v-if="byDomain.get(meta.domain)?.draft_count"
                size="sm" color="info" variant="subtle"
              >
                {{ byDomain.get(meta.domain)!.draft_count }} draft(s)
              </UBadge>
            </div>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
