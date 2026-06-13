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

const expandedIds = ref<Record<string, boolean>>({});

function toggleExpanded(id: string) {
  expandedIds.value = { ...expandedIds.value, [id]: !expandedIds.value[id] };
}

function isExpanded(id: string) {
  return !!expandedIds.value[id];
}

function authorLabel(entry: PortalThreadMessage): string {
  return entry.author_name ?? (entry.direction === 'inbound' ? 'You' : 'GRM office');
}

function preview(body: string, max = 72): string {
  const text = body.replace(/\s+/g, ' ').trim();
  if (!text) return 'No message text';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function parentEntry(entry: PortalThreadMessage): PortalThreadMessage | null {
  if (!entry.in_reply_to_id) return null;
  return props.entryById[entry.in_reply_to_id] ?? null;
}
</script>

<template>
  <div class="space-y-2">
    <div v-for="node in nodes" :key="node.entry.id">
      <div
        class="rounded-lg border border-default text-sm overflow-hidden"
        :class="node.entry.direction === 'inbound' ? 'bg-primary/5' : 'bg-default'"
      >
        <button
          type="button"
          class="w-full text-left p-3 flex items-start gap-2 hover:bg-elevated/40 transition-colors"
          :aria-expanded="isExpanded(node.entry.id)"
          @click="toggleExpanded(node.entry.id)"
        >
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 mt-0.5 shrink-0 text-muted transition-transform"
            :class="isExpanded(node.entry.id) ? 'rotate-90' : ''"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-2 mb-0.5">
              <span class="font-medium truncate">{{ authorLabel(node.entry) }}</span>
              <time class="text-xs text-muted shrink-0">{{ new Date(node.entry.created_at).toLocaleString() }}</time>
            </div>
            <p v-if="!isExpanded(node.entry.id)" class="text-muted truncate">
              {{ preview(node.entry.body) }}
            </p>
          </div>
        </button>

        <div v-if="isExpanded(node.entry.id)" class="px-3 pb-3 pt-0 ml-6 border-t border-default/60">
          <p v-if="parentEntry(node.entry)" class="text-xs text-muted mt-2 mb-1.5 flex items-center gap-1">
            <UIcon name="i-lucide-corner-down-right" class="size-3 shrink-0" />
            Reply to {{ authorLabel(parentEntry(node.entry)!) }}
          </p>
          <p class="whitespace-pre-wrap mt-2">{{ node.entry.body }}</p>
          <ul v-if="node.entry.attachments?.length" class="mt-2 text-xs text-muted space-y-1">
            <li v-for="att in node.entry.attachments" :key="att.id">{{ att.kind_label }}: {{ att.filename }}</li>
          </ul>

          <div
            v-if="node.children.length"
            class="mt-3 ml-1 pl-3 border-l-2 border-primary/30 space-y-2"
          >
            <PortalThreadTree :nodes="node.children" :entry-by-id="entryById" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
