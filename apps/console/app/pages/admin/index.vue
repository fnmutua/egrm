<script setup lang="ts">
definePageMeta({ layout: 'admin' });

const { api } = useApi();
const { user, fetchMe } = useAuth();
const { canAdmin, canConfig, canPage } = usePermissions();

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
  if (!canAdmin()) return navigateTo('/');
  const res = await api<{ domains: DomainRow[] }>('/api/v1/config');
  rows.value = res.domains;
  loading.value = false;
});

const visibleSections = computed(() =>
  ADMIN_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => {
      if (entry.type === 'page') return canPage(entry.to);
      return canConfig(entry.domain);
    }),
  })).filter((section) => section.entries.length > 0),
);

const byDomain = computed(() => new Map(rows.value.map((r) => [r.domain, r])));
const configuredCount = computed(() => rows.value.filter((r) => r.active_version).length);
</script>

<template>
  <div v-if="user" class="p-4 sm:p-8 max-w-4xl">
    <h1 class="text-2xl font-semibold mb-1">Configuration overview</h1>
    <p class="text-muted mb-6">
      Every domain is versioned: draft → validate → activate, with full history and rollback.
      <template v-if="!loading">{{ configuredCount }} of {{ rows.length }} domains configured.</template>
    </p>

    <div v-if="loading" class="text-muted p-8 text-center">Loading…</div>
    <div v-else class="space-y-6">
      <div v-for="section in visibleSections" :key="section.label">
        <h2 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2">{{ section.label }}</h2>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="(entry, i) in section.entries"
              :key="i"
              class="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-elevated/50 cursor-pointer transition"
              @click="navigateTo(entry.type === 'page' ? entry.to : `/admin/config/${entry.domain}`)"
            >
              <template v-if="entry.type === 'page'">
                <div class="flex items-center gap-3 min-w-0">
                  <UIcon :name="entry.icon" class="text-primary shrink-0" />
                  <div class="min-w-0">
                    <span class="font-medium text-sm">{{ entry.label }}</span>
                    <p class="text-xs text-muted truncate">{{ entry.description }}</p>
                  </div>
                </div>
                <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0" />
              </template>
              <template v-else>
                <div class="flex items-center gap-3 min-w-0">
                  <UIcon :name="domainMeta(entry.domain)?.icon ?? 'i-lucide-settings'" class="text-primary shrink-0" />
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-medium text-sm">{{ domainMeta(entry.domain)?.title }}</span>
                      <UBadge size="sm" variant="subtle" color="neutral">{{ domainMeta(entry.domain)?.cd }}</UBadge>
                    </div>
                    <p class="text-xs text-muted truncate">{{ domainMeta(entry.domain)?.description }}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <UBadge v-if="byDomain.get(entry.domain)?.draft_count" size="sm" color="info" variant="subtle">
                    {{ byDomain.get(entry.domain)!.draft_count }} draft(s)
                  </UBadge>
                  <UBadge v-if="byDomain.get(entry.domain)?.active_version" size="sm" color="success" variant="subtle">
                    v{{ byDomain.get(entry.domain)!.active_version }} active
                  </UBadge>
                  <UBadge v-else size="sm" color="warning" variant="subtle">not configured</UBadge>
                  <UIcon name="i-lucide-chevron-right" class="text-muted" />
                </div>
              </template>
            </li>
          </ul>
        </UCard>
      </div>
    </div>
  </div>
</template>
