<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui';

const route = useRoute();
const drawerOpen = ref(false);

// Close the mobile drawer after navigating.
watch(() => route.fullPath, () => (drawerOpen.value = false));

const navItems = computed<NavigationMenuItem[]>(() => {
  const items: NavigationMenuItem[] = [
    { label: 'Overview', icon: 'i-lucide-layout-grid', to: '/admin', exact: true },
  ];
  for (const section of ADMIN_SECTIONS) {
    items.push({ label: section.label, type: 'label' });
    for (const entry of section.entries) {
      if (entry.type === 'page') {
        items.push({ label: entry.label, icon: entry.icon, to: entry.to });
      } else {
        const meta = domainMeta(entry.domain);
        if (!meta) continue;
        const to = `/admin/config/${entry.domain}`;
        if (meta.subsections?.length) {
          // Render editor sections as sub-items; open automatically while on that page.
          items.push({
            label: meta.title,
            icon: meta.icon,
            defaultOpen: route.path === to,
            children: meta.subsections.map((s) => ({
              label: s.label,
              to: `${to}#${s.id}`,
              exactHash: true,
            })),
          });
        } else {
          items.push({ label: meta.title, icon: meta.icon, to });
        }
      }
    }
  }
  return items;
});
</script>

<template>
  <div class="flex flex-col lg:flex-row h-screen overflow-hidden">
    <!-- Mobile top bar -->
    <div class="lg:hidden flex items-center justify-between border-b border-default px-4 py-2.5 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-settings" class="text-primary shrink-0" />
        <span class="font-semibold truncate">Administration</span>
      </div>
      <UButton icon="i-lucide-menu" variant="ghost" color="neutral" aria-label="Open menu" @click="drawerOpen = true" />
    </div>

    <!-- Mobile drawer -->
    <USlideover v-model:open="drawerOpen" side="left" title="Administration">
      <template #body>
        <NuxtLink to="/" class="flex items-center gap-1.5 text-xs text-muted hover:text-highlighted transition mb-3">
          <UIcon name="i-lucide-arrow-left" />
          Back to dashboard
        </NuxtLink>
        <UNavigationMenu orientation="vertical" :items="navItems" highlight />
      </template>
    </USlideover>

    <!-- Desktop sidebar -->
    <aside class="hidden lg:flex w-64 shrink-0 border-r border-default bg-elevated/30 flex-col">
      <div class="px-4 py-3 border-b border-default">
        <NuxtLink to="/" class="flex items-center gap-1.5 text-xs text-muted hover:text-highlighted transition">
          <UIcon name="i-lucide-arrow-left" />
          Back to dashboard
        </NuxtLink>
        <div class="flex items-center gap-2 mt-2">
          <UIcon name="i-lucide-settings" class="text-primary" />
          <h2 class="font-semibold">Administration</h2>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto p-3">
        <UNavigationMenu orientation="vertical" :items="navItems" highlight />
      </nav>
    </aside>

    <main class="flex-1 min-w-0 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
