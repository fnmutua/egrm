<script setup lang="ts">
import { hasPermission } from '@egrm/core';

const { user, logout } = useAuth();
const { loadDashboards, visibleDashboards } = useDashboards();
const route = useRoute();

const nav = computed(() => [[
  { label: 'Cases', icon: 'i-lucide-inbox', to: '/cases' },
  { label: 'Reports', icon: 'i-lucide-bar-chart-3', to: '/', disabled: true, badge: 'Phase 4' },
]]);

const showConfigs = computed(() => {
  const perms = user.value?.permissions ?? [];
  return perms.some((p) => p.startsWith('admin:'))
    || user.value?.manages_staff_users
    || hasPermission(perms, 'admin:users')
    || perms.includes('admin:*');
});

const drawerOpen = ref(false);
watch(() => route.fullPath, () => (drawerOpen.value = false));

onMounted(async () => {
  if (user.value) await loadDashboards();
});

watch(user, async (u) => {
  if (u && !visibleDashboards.value.length) await loadDashboards();
});

function dashActive(id: string) {
  if (route.path !== '/') return false;
  return route.query.d ? route.query.d === id : visibleDashboards.value[0]?.id === id;
}

const collapsibleClass = 'flex cursor-pointer list-none items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-default hover:bg-elevated/60 [&::-webkit-details-marker]:hidden';

const dashLinkClass = (active: boolean) => [
  'flex items-center gap-2 rounded-md px-2 py-1 transition-colors w-full text-left text-xs font-medium truncate',
  active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-elevated/80 hover:text-highlighted',
].join(' ');
</script>

<template>
  <div class="min-h-screen flex flex-col md:flex-row">
    <!-- Mobile top bar -->
    <div class="md:hidden border-b border-default px-4 py-2.5 flex items-center justify-between shrink-0">
      <span class="font-semibold">eGRM Console</span>
      <UButton icon="i-lucide-menu" variant="ghost" color="neutral" aria-label="Open menu" @click="drawerOpen = true" />
    </div>

    <!-- Mobile drawer -->
    <USlideover v-model:open="drawerOpen" side="left" title="Navigation">
      <template #body>
        <!-- Dashboards always first -->
        <details :open="route.path === '/'" class="group mb-1">
          <summary :class="collapsibleClass">
            <UIcon name="i-lucide-layout-dashboard" class="size-4 shrink-0 text-primary" />
            <span class="flex-1">Dashboards</span>
            <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div class="mt-1 ml-2 pl-2 border-l border-default space-y-0.5">
            <div v-if="!visibleDashboards.length" class="text-xs text-muted px-2 py-1">No dashboards configured</div>
            <NuxtLink v-for="d in visibleDashboards" :key="d.id" :to="`/?d=${d.id}`" :class="dashLinkClass(dashActive(d.id))">
              <UIcon :name="d.icon || 'i-lucide-layout-dashboard'" class="size-3.5 shrink-0" />
              <span class="truncate">{{ d.title }}</span>
            </NuxtLink>
          </div>
        </details>

        <div class="pt-2 border-t border-default mb-2">
          <UNavigationMenu orientation="vertical" :items="nav" />
        </div>

        <div v-if="showConfigs" class="pt-2 border-t border-default">
          <details class="group">
            <summary :class="collapsibleClass">
              <UIcon name="i-lucide-settings" class="size-4 shrink-0 text-primary" />
              <span class="flex-1">Settings</span>
              <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
            </summary>
            <div class="mt-1 ml-2 pl-2 border-l border-default">
              <AdminNav compact />
            </div>
          </details>
        </div>
      </template>
    </USlideover>

    <!-- Desktop sidebar -->
    <aside class="hidden md:flex w-64 border-r border-default flex-col sticky top-0 h-screen shrink-0">
      <div class="px-4 py-3 border-b border-default shrink-0">
        <span class="font-semibold text-lg">eGRM Console</span>
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <!-- Dashboards always first -->
        <details :open="route.path === '/'" class="group mb-1">
          <summary :class="collapsibleClass">
            <UIcon name="i-lucide-layout-dashboard" class="size-4 shrink-0 text-primary" />
            <span class="flex-1">Dashboards</span>
            <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div class="mt-1 ml-2 pl-2 border-l border-default space-y-0.5">
            <div v-if="!visibleDashboards.length" class="text-xs text-muted px-2 py-1">No dashboards configured</div>
            <NuxtLink v-for="d in visibleDashboards" :key="d.id" :to="`/?d=${d.id}`" :class="dashLinkClass(dashActive(d.id))">
              <UIcon :name="d.icon || 'i-lucide-layout-dashboard'" class="size-3.5 shrink-0" />
              <span class="truncate">{{ d.title }}</span>
            </NuxtLink>
          </div>
        </details>

        <div class="pt-2 border-t border-default mb-2">
          <UNavigationMenu orientation="vertical" :items="nav" />
        </div>

        <template v-if="showConfigs">
          <div class="pt-2 border-t border-default">
            <details :open="route.path.startsWith('/admin')" class="group">
              <summary :class="collapsibleClass">
                <UIcon name="i-lucide-settings" class="size-4 shrink-0 text-primary" />
                <span class="flex-1">Settings</span>
                <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
              </summary>
              <div class="mt-1 ml-2 pl-2 border-l border-default">
                <AdminNav compact />
              </div>
            </details>
          </div>
        </template>
      </div>
      <div class="border-t border-default p-4 shrink-0">
        <div class="text-sm font-medium">{{ user?.name }}</div>
        <div class="text-xs text-muted truncate">{{ user?.email }}</div>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" class="mt-2" @click="logout">
          Sign out
        </UButton>
      </div>
    </aside>

    <!-- Page content -->
    <main class="flex-1 min-w-0">
      <slot />
    </main>
  </div>
</template>
