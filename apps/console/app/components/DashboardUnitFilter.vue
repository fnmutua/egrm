<script setup lang="ts">
const {
  levels,
  selections,
  loading,
  initialized,
  hasActiveFilter,
  ALL_VALUE,
  initFilter,
  resetFilter,
  onLevelChange,
  selectItems,
} = useDashboardUnitFilter();

onMounted(() => {
  if (!initialized.value) void initFilter();
});

defineExpose({ resetFilter });
</script>

<template>
  <div v-if="levels.length" class="flex items-center gap-2 flex-wrap">
    <UIcon v-if="loading" name="i-lucide-loader-2" class="size-4 animate-spin text-muted" />
    <template v-for="(level, idx) in levels" :key="level.code">
      <USelectMenu
        :model-value="selections[level.code]"
        :items="selectItems(level.code)"
        value-key="value"
        label-key="label"
        :placeholder="level.label"
        :disabled="idx > 0 && selections[levels[idx - 1]!.code] === ALL_VALUE"
        size="sm"
        class="w-full sm:w-44"
        @update:model-value="onLevelChange(level.code, $event as string)"
      />
    </template>
    <UButton
      v-if="hasActiveFilter"
      size="xs"
      variant="ghost"
      icon="i-lucide-x"
      @click="resetFilter"
    >
      Clear unit filter
    </UButton>
  </div>
</template>
