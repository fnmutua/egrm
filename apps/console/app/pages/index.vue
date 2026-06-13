<script setup lang="ts">
import { hasPermission } from '@egrm/core';

const { user, fetchMe, logout } = useAuth();

onMounted(async () => {
  const me = await fetchMe();
  if (!me) await navigateTo('/login');
});

const nav = computed(() => {
  const perms = user.value?.permissions ?? [];
  const items: Record<string, unknown>[] = [
    { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
    { label: 'Cases', icon: 'i-lucide-inbox', to: '/cases' },
    { label: 'Reports', icon: 'i-lucide-bar-chart-3', to: '/', disabled: true, badge: 'Phase 4' },
  ];
  if (perms.some((p) => p.startsWith('admin:'))) {
    items.push({ label: 'Configs', icon: 'i-lucide-settings', to: '/admin' });
  }
  if (hasPermission(perms, 'admin:users') || perms.includes('admin:*')) {
    items.push({
      label: 'Admin',
      icon: 'i-lucide-user-cog',
      children: [{ label: 'Users', icon: 'i-lucide-users', to: '/admin/users' }],
    });
  }
  return [items];
});
</script>

<template>
  <div v-if="user" class="min-h-screen flex flex-col md:flex-row">
    <!-- Mobile top bar -->
    <div class="md:hidden border-b border-default px-4 py-2.5">
      <div class="flex items-center justify-between">
        <span class="font-semibold">eGRM Console</span>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" aria-label="Sign out" @click="logout" />
      </div>
      <UNavigationMenu orientation="horizontal" :items="nav" class="mt-1 -mx-2 overflow-x-auto" />
    </div>

    <!-- Desktop sidebar -->
    <aside class="hidden md:flex w-60 border-r border-default p-4 flex-col gap-4">
      <div class="font-semibold text-lg px-2">eGRM Console</div>
      <UNavigationMenu orientation="vertical" :items="nav" class="flex-1" />
      <div class="border-t border-default pt-3 px-2">
        <div class="text-sm font-medium">{{ user.name }}</div>
        <div class="text-xs text-muted truncate">{{ user.email }}</div>
        <UButton size="xs" variant="ghost" color="neutral" icon="i-lucide-log-out" class="mt-2" @click="logout">
          Sign out
        </UButton>
      </div>
    </aside>

    <main class="flex-1 p-4 sm:p-8">
      <h1 class="text-2xl font-semibold mb-1">Welcome, {{ user.name }}</h1>
      <p class="text-muted mb-6">Phase 0 foundation shell — case management arrives in Phase 1.</p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UCard>
          <div class="text-sm text-muted">Tenancy kernel</div>
          <div class="text-lg font-medium">Active</div>
        </UCard>
        <UCard>
          <div class="text-sm text-muted">Config registry</div>
          <div class="text-lg font-medium">Versioned, validated</div>
        </UCard>
        <UCard>
          <div class="text-sm text-muted">Your permissions</div>
          <div class="text-lg font-medium">{{ user.permissions.length }} grants</div>
        </UCard>
      </div>
    </main>
  </div>
</template>
