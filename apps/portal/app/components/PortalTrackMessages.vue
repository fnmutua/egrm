<script setup lang="ts">
import type { PortalThreadMessage } from './PortalThreadTree.vue';

const props = defineProps<{
  messages: PortalThreadMessage[];
}>();

const sorted = computed(() =>
  [...props.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  ),
);

function authorLabel(entry: PortalThreadMessage): string {
  return entry.author_name ?? (entry.direction === 'inbound' ? 'You' : 'GRM office');
}
</script>

<template>
  <div class="space-y-3">
    <article
      v-for="msg in sorted"
      :key="msg.id"
      class="rounded-lg border border-default p-3 text-sm"
      :class="msg.direction === 'inbound' ? 'bg-primary/5' : 'bg-default'"
    >
      <div class="flex items-center justify-between gap-2 mb-2">
        <span class="font-medium">{{ authorLabel(msg) }}</span>
        <time class="text-xs text-muted shrink-0">{{ new Date(msg.created_at).toLocaleString() }}</time>
      </div>
      <p class="whitespace-pre-wrap">{{ msg.body }}</p>
      <ul v-if="msg.attachments?.length" class="mt-2 text-xs text-muted space-y-1">
        <li v-for="att in msg.attachments" :key="att.id">{{ att.kind_label }}: {{ att.filename }}</li>
      </ul>
    </article>
  </div>
</template>
