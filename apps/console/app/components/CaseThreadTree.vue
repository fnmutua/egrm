<script setup lang="ts">
import { threadChannelLabel } from '@egrm/config-schemas';
import type { ThreadTreeNode } from '@egrm/core';
import CaseThreadTree from '~/components/CaseThreadTree.vue';

export interface ThreadEntryItem {
  id: string;
  direction: string;
  message_kind: string;
  channel: string;
  body: string;
  body_display: string;
  author_name: string | null;
  in_reply_to_id?: string | null;
  attachments: { id: string; filename: string; kind: string; kind_label: string }[];
  created_at: string;
}

const props = defineProps<{
  nodes: ThreadTreeNode<ThreadEntryItem>[];
  entryById: Record<string, ThreadEntryItem>;
  canReply?: boolean;
}>();

const emit = defineEmits<{
  reply: [entry: ThreadEntryItem];
  download: [id: string, filename: string];
}>();

function directionLabel(entry: ThreadEntryItem): string {
  if (entry.direction === 'inbound') return 'Complainant reply';
  if (entry.direction === 'internal_note') return 'Internal note';
  if (entry.message_kind === 'logged_contact') return 'Logged contact';
  return 'Outbound message';
}

function directionColor(entry: ThreadEntryItem): string {
  if (entry.direction === 'inbound') return 'info';
  if (entry.direction === 'internal_note') return 'warning';
  if (entry.message_kind === 'logged_contact') return 'neutral';
  return 'primary';
}

function parentEntry(entry: ThreadEntryItem): ThreadEntryItem | null {
  if (!entry.in_reply_to_id) return null;
  return props.entryById[entry.in_reply_to_id] ?? null;
}
</script>

<template>
  <div class="space-y-4">
    <div v-for="node in nodes" :key="node.entry.id">
      <div
        class="rounded-lg border border-default p-4 transition-colors"
        :class="node.entry.direction === 'internal_note' ? 'bg-warning/5' : ''"
      >
        <p
          v-if="parentEntry(node.entry)"
          class="text-xs text-muted mb-2 flex items-center gap-1.5"
        >
          <UIcon name="i-lucide-corner-down-right" class="size-3.5 shrink-0 text-primary" />
          <span>
            Reply to
            <span class="font-medium text-default">{{ parentEntry(node.entry)!.author_name ?? 'message' }}</span>
          </span>
        </p>

        <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            <UBadge :color="(directionColor(node.entry) as any)" variant="subtle" size="sm">
              {{ directionLabel(node.entry) }}
            </UBadge>
            <UBadge color="neutral" variant="outline" size="sm">
              <UIcon name="i-lucide-radio" class="size-3 mr-1" />
              {{ threadChannelLabel(node.entry.channel) }}
            </UBadge>
            <span class="text-sm font-medium">{{ node.entry.author_name ?? '—' }}</span>
          </div>
          <time class="text-xs text-muted">{{ new Date(node.entry.created_at).toLocaleString() }}</time>
        </div>

        <p class="text-sm whitespace-pre-wrap">{{ node.entry.body_display }}</p>

        <ul v-if="node.entry.attachments.length" class="mt-2 text-xs text-muted space-y-1">
          <li v-for="att in node.entry.attachments" :key="att.id">
            <button type="button" class="text-primary hover:underline" @click="emit('download', att.id, att.filename)">
              {{ att.kind_label }}: {{ att.filename }}
            </button>
          </li>
        </ul>

        <div v-if="canReply && node.entry.direction === 'inbound'" class="mt-3 pt-2 border-t border-default/60">
          <UButton size="xs" variant="soft" icon="i-lucide-reply" @click="emit('reply', node.entry)">
            Reply
          </UButton>
        </div>

        <div
          v-if="node.children.length"
          class="mt-4 ml-3 sm:ml-4 pl-3 sm:pl-4 border-l-2 border-primary/30 space-y-4"
        >
          <CaseThreadTree
            :nodes="node.children"
            :entry-by-id="entryById"
            :can-reply="canReply"
            @reply="emit('reply', $event)"
            @download="(id, filename) => emit('download', id, filename)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
