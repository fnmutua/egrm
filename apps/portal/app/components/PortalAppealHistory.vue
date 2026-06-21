<script setup lang="ts">
export interface ComplainantAppeal {
  round: number;
  status: 'open' | 'upheld' | 'dismissed';
  raised_at: string;
  decision: 'accepted' | 'rejected' | null;
  decided_at: string | null;
  outcome_label: string;
}

defineProps<{
  appeals: ComplainantAppeal[];
}>();

function statusColor(status: string): string {
  if (status === 'open') return 'warning';
  if (status === 'upheld') return 'success';
  return 'neutral';
}

function statusBadge(status: string): string {
  if (status === 'open') return 'Under review';
  if (status === 'upheld') return 'Accepted';
  return 'Not upheld';
}
</script>

<template>
  <div class="space-y-3">
    <article
      v-for="item in appeals"
      :key="item.round"
      class="rounded-lg border border-default p-3 text-sm"
    >
      <div class="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <span class="font-medium">Appeal round {{ item.round }}</span>
        <div class="flex items-center gap-2">
          <UBadge :color="statusColor(item.status) as any" variant="subtle" size="xs">
            {{ statusBadge(item.status) }}
          </UBadge>
          <time v-if="item.decided_at" class="text-xs text-muted">
            {{ new Date(item.decided_at).toLocaleString() }}
          </time>
          <time v-else class="text-xs text-muted">
            Submitted {{ new Date(item.raised_at).toLocaleString() }}
          </time>
        </div>
      </div>
      <p class="text-muted">{{ item.outcome_label }}</p>
    </article>
  </div>
</template>
