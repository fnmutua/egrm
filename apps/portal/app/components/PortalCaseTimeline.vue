<script setup lang="ts">
const props = defineProps<{
  events: { kind: string; data: Record<string, unknown>; createdAt: string }[];
}>();

const visible = computed(() =>
  [...props.events]
    .filter((e) => ['status_changed', 'appealed', 'appeal_decided'].includes(e.kind))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
);

function eventTitle(ev: { kind: string; data: Record<string, unknown> }): string {
  const d = ev.data;
  if (ev.kind === 'appeal_decided') {
    return typeof d.summary === 'string' ? d.summary : 'Appeal decision recorded';
  }
  if (ev.kind === 'appealed') {
    return 'You submitted an appeal';
  }
  if (ev.kind === 'status_changed') {
    if (d.context === 'complainant_appeal') return 'Appeal submitted — case under review';
    const from = d.from_status as string | undefined;
    const to = d.to_status as string | undefined;
    if (from && to) return `Status updated: ${from} → ${to}`;
    return 'Case status updated';
  }
  return 'Update';
}

function eventDetail(ev: { kind: string; data: Record<string, unknown> }): string | null {
  const d = ev.data;
  if (ev.kind === 'status_changed' && typeof d.update_summary === 'string' && d.update_summary.trim()) {
    return d.update_summary;
  }
  if (ev.kind === 'appealed' && typeof d.reason === 'string') {
    return d.reason;
  }
  return null;
}
</script>

<template>
  <div v-if="visible.length" class="space-y-2">
    <article
      v-for="(ev, i) in visible"
      :key="`${ev.kind}-${ev.createdAt}-${i}`"
      class="rounded-lg border border-default px-3 py-2 text-sm"
    >
      <div class="flex items-start justify-between gap-2">
        <p class="font-medium">{{ eventTitle(ev) }}</p>
        <time class="text-xs text-muted shrink-0">{{ new Date(ev.createdAt).toLocaleString() }}</time>
      </div>
      <p v-if="eventDetail(ev)" class="text-muted mt-1 whitespace-pre-wrap text-xs">{{ eventDetail(ev) }}</p>
    </article>
  </div>
</template>
