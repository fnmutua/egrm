<script setup lang="ts">
const drawerOpen = ref(false);
const route = useRoute();

watch(() => route.fullPath, () => (drawerOpen.value = false));
</script>

<template>
  <div class="flex flex-col lg:flex-row h-screen overflow-hidden">
    <!-- Mobile top bar -->
    <div class="lg:hidden flex items-center justify-between border-b border-default px-4 py-2.5 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon name="i-lucide-settings" class="text-primary shrink-0" />
        <span class="font-semibold truncate">Configs</span>
      </div>
      <UButton icon="i-lucide-menu" variant="ghost" color="neutral" aria-label="Open menu" @click="drawerOpen = true" />
    </div>

    <!-- Mobile drawer -->
    <USlideover v-model:open="drawerOpen" side="left" title="Configs">
      <template #body>
        <NuxtLink to="/" class="flex items-center gap-1.5 text-xs text-muted hover:text-highlighted transition mb-3">
          <UIcon name="i-lucide-arrow-left" />
          Back to dashboard
        </NuxtLink>
        <AdminNav />
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
          <h2 class="font-semibold">Configs</h2>
        </div>
      </div>
      <div class="flex-1 overflow-y-auto p-3">
        <AdminNav />
      </div>
    </aside>

    <main class="flex-1 min-w-0 overflow-y-auto">
      <slot />
    </main>
  </div>
</template>
