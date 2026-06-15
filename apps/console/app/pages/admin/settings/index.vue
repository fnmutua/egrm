<script setup lang="ts">
definePageMeta({ layout: 'shell' });

const { user, fetchMe } = useAuth();
const { canPage } = usePermissions();

onMounted(async () => {
  const me = await fetchMe();
  if (!me) return navigateTo('/login');
});

const permittedSections = computed(() =>
  SETTINGS_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) => canPage(entry.to)),
  })).filter((section) => section.entries.length > 0),
);

const hasAccess = computed(() => permittedSections.value.length > 0);

watchEffect(() => {
  if (user.value && !hasAccess.value) navigateTo('/');
});
</script>

<template>
  <div v-if="user && hasAccess" class="p-4 sm:p-8">
    <h1 class="text-2xl font-semibold mb-4">Settings</h1>

    <div class="space-y-6">
      <div v-for="section in permittedSections" :key="section.label">
        <h2 class="text-xs font-semibold text-muted uppercase tracking-wide mb-2">{{ section.label }}</h2>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="entry in section.entries"
              :key="entry.to"
              class="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-elevated/50 cursor-pointer transition"
              @click="navigateTo(entry.to)"
            >
              <div class="flex items-center gap-3 min-w-0">
                <UIcon :name="entry.icon" class="text-primary shrink-0" />
                <span class="font-medium text-sm">{{ entry.label }}</span>
              </div>
              <UIcon name="i-lucide-chevron-right" class="text-muted shrink-0" />
            </li>
          </ul>
        </UCard>
      </div>
    </div>
  </div>
</template>
