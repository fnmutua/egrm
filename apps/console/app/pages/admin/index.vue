<script setup lang="ts">
definePageMeta({ layout: 'shell' });

const { user, fetchMe } = useAuth();
const { canAdmin, canPage } = usePermissions();

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
});

const showConfig = computed(() => canAdmin());
const showSettings = computed(() =>
  SETTINGS_SECTIONS.some((section) =>
    section.entries.some((entry) => canPage(entry.to)),
  ),
);

watchEffect(() => {
  if (user.value && !showConfig.value && !showSettings.value) navigateTo('/');
});
</script>

<template>
  <div v-if="user && (showConfig || showSettings)" class="p-4 sm:p-8 max-w-3xl">
    <h1 class="text-2xl font-semibold mb-6">Admin</h1>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard
        v-if="showConfig"
        class="cursor-pointer hover:ring-1 hover:ring-primary/30 transition"
        @click="navigateTo('/admin/config')"
      >
        <div class="flex items-start gap-4">
          <div class="rounded-lg bg-primary/10 p-3">
            <UIcon name="i-lucide-sliders-horizontal" class="size-6 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-semibold text-lg">Configuration</h2>
          </div>
          <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 mt-1" />
        </div>
      </UCard>

      <UCard
        v-if="showSettings"
        class="cursor-pointer hover:ring-1 hover:ring-primary/30 transition"
        @click="navigateTo('/admin/settings')"
      >
        <div class="flex items-start gap-4">
          <div class="rounded-lg bg-primary/10 p-3">
            <UIcon name="i-lucide-wrench" class="size-6 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 class="font-semibold text-lg">Settings</h2>
          </div>
          <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0 mt-1" />
        </div>
      </UCard>
    </div>
  </div>
</template>
