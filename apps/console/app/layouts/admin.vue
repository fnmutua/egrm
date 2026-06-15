<script setup lang="ts">
import { canAccessAdminConsole, canAccessAdminPage } from '@egrm/core';

const { user, logout } = useAuth();
const { count: caseCount, loadCaseCount } = useCaseCount();
const drawerOpen = ref(false);
const route = useRoute();

watch(() => route.fullPath, () => (drawerOpen.value = false));

onMounted(() => {
  if (user.value) loadCaseCount();
});

watch(user, (u) => {
  if (u) loadCaseCount();
  else caseCount.value = null;
});

const nav = computed(() => {
  const perms = user.value?.permissions ?? [];
  const opts = { managesStaffUsers: user.value?.manages_staff_users === true };
  const canAdmin = canAccessAdminConsole(perms);
  const canManageUsers = canAccessAdminPage(perms, '/admin/settings/users', opts);
  const canManageUnits = canAccessAdminPage(perms, '/admin/settings/units');

  const items: Record<string, unknown>[] = [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
    {
      label: 'Cases',
      icon: 'i-lucide-inbox',
      to: '/cases',
      badge: caseCount.value != null ? caseCount.value.toLocaleString() : undefined,
    },
    { label: 'Reports', icon: 'i-lucide-bar-chart-3', to: '/', disabled: true, badge: 'Phase 4' },
  ];

  if (canAdmin || canManageUsers || canManageUnits) {
    const children: Record<string, unknown>[] = [
      { label: 'Programme admin', icon: 'i-lucide-shield', to: '/admin' },
    ];
    if (canAdmin) children.push({ label: 'Configuration', icon: 'i-lucide-sliders-horizontal', to: '/admin/config' });
    if (canManageUsers || canManageUnits) {
      children.push({ label: 'Settings', icon: 'i-lucide-wrench', to: '/admin/settings' });
    }
    items.push({ label: 'Administration', icon: 'i-lucide-settings', children });
  }

  return [items];
});
</script>

<template>
  <div class="min-h-screen flex flex-col md:flex-row">
    <!-- Mobile top bar -->
    <div class="md:hidden border-b border-default px-4 py-2.5 shrink-0">
      <div class="flex items-center justify-between">
        <span class="font-semibold">eGRM Console</span>
        <UButton icon="i-lucide-menu" variant="ghost" color="neutral" aria-label="Open menu" @click="drawerOpen = true" />
      </div>
    </div>

    <!-- Mobile drawer: main nav + config nav -->
    <USlideover v-model:open="drawerOpen" side="left" title="Navigation">
      <template #body>
        <UNavigationMenu orientation="vertical" :items="nav" class="mb-4" />
        <div class="border-t border-default pt-3 space-y-3">
          <div>
            <p class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Configuration</p>
            <AdminNav />
          </div>
          <div>
            <p class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Settings</p>
            <SettingsNav />
          </div>
        </div>
      </template>
    </USlideover>

    <!-- Desktop: main shell sidebar -->
    <aside class="hidden md:flex w-56 border-r border-default p-4 flex-col gap-4 sticky top-0 h-screen shrink-0">
      <div class="font-semibold text-lg px-2">eGRM Console</div>
      <UNavigationMenu orientation="vertical" :items="nav" class="flex-1" />
      <div class="border-t border-default pt-3 px-2">
        <div class="text-sm font-medium">{{ user?.name }}</div>
        <div class="text-xs text-muted truncate">{{ user?.email }}</div>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" class="mt-2" @click="logout">
          Sign out
        </UButton>
      </div>
    </aside>

    <!-- Desktop: config sidebar + content -->
    <div class="flex flex-col lg:flex-row flex-1 min-w-0 md:h-screen md:overflow-hidden">
      <aside class="hidden lg:flex w-64 shrink-0 border-r border-default bg-elevated/30 flex-col">
        <div class="px-4 py-3 border-b border-default flex items-center gap-2">
          <UIcon name="i-lucide-shield" class="text-primary" />
          <h2 class="font-semibold">Programme admin</h2>
        </div>
        <div class="flex-1 overflow-y-auto p-3 space-y-4">
          <div>
            <p class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Configuration</p>
            <AdminNav />
          </div>
          <div>
            <p class="text-xs font-semibold text-muted uppercase tracking-wide mb-2 px-2">Settings</p>
            <SettingsNav />
          </div>
        </div>
      </aside>

      <main class="flex-1 min-w-0 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
