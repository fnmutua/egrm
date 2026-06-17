<script setup lang="ts">
const { items } = usePageBreadcrumbs();
</script>

<template>
  <UBreadcrumb
    v-if="items.length"
    :items="items"
    class="px-4 sm:px-8 pt-4 shrink-0 border-b border-default/50 pb-3 mb-0"
  />
</template>
