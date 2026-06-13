<script setup lang="ts">
import type { ThreadTreeNode } from '@egrm/core';
import PortalThreadTree from '~/components/PortalThreadTree.vue';

export interface PortalThreadMessage {
  id: string;
  direction: string;
  message_kind: string;
  body: string;
  author_name: string | null;
  in_reply_to_id?: string | null;
  attachments?: { id: string; filename: string; kind: string; kind_label: string }[];
  created_at: string;
}

const props = defineProps<{
  nodes: ThreadTreeNode<PortalThreadMessage>[];
  entryById: Record<string, PortalThreadMessage>;
}>();

function parentEntry(entry: PortalThreadMessage): PortalThreadMessage | null {
  if (!entry.in_reply_to_id) return null;
  return props.entryById[entry.in_reply_to_id] ?? null;
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="node in nodes" :key="node.entry.id">
      <div
        class="rounded-lg border border-default p-3 text-sm"
        :class="node.entry.direction === 'inbound' ? 'bg-primary/5' : ''"
      >
        <p v-if="parentEntry(node.entry)" class="text-xs text-muted mb-1.5 flex items-center gap-1">
          <UIcon name="i-lucide-corner-down-right" class="size-3 shrink-0" />
          Reply to {{ parentEntry(node.entry)!.author_name ?? 'GRM office' }}
        </p>
        <div class="flex items-center justify-between gap-2 mb-1">
          <span class="font-medium">{{ node.entry.author_name ?? (node.entry.direction === 'inbound' ? 'You' : 'GRM office') }}</span>
          <time class="text-xs text-muted">{{ new Date(node.entry.created_at).toLocaleString() }}</time>
        </div>
        <p class="whitespace-pre-wrap">{{ node.entry.body }}</p>
        <ul v-if="node.entry.attachments?.length" class="mt-2 text-xs text-muted">
          <li v-for="att in node.entry.attachments" :key="att.id">{{ att.kind_label }}: {{ att.filename }}</li>
        </ul>

        <div
          v-if="node.children.length"
          class="mt-3 ml-2 pl-3 border-l-2 border-primary/30 space-y-3"
        >
          <PortalThreadTree :nodes="node.children" :entry-by-id="entryById" />
        </div>
      </div>
    </div>
  </div>
</template>
