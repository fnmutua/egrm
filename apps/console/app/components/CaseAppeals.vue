<script setup lang="ts">
import { hasPermission } from '@egrm/core';
import { apiErrorMessage } from '~/utils/api-errors';
import { formatLocalDate } from '~/utils/intake-values';

const props = defineProps<{ caseId: string; statusTag: string }>();
const emit = defineEmits<{ changed: [] }>();

const { api } = useApi();
const { user, fetchMe } = useAuth();
const toast = useToast();

interface AppealRow {
  id: string;
  round: number;
  raised_by: string;
  reason: string;
  raised_at: string;
  routed_to_level_code: string | null;
  status: string;
  decision: string | null;
  decision_note: string | null;
  decided_at: string | null;
}

const appeals = ref<AppealRow[]>([]);
const loading = ref(false);
const decideLoading = ref<string | null>(null);
const decideNote = ref<Record<string, string>>({});

const canDecide = computed(
  () =>
    hasPermission(user.value?.permissions ?? [], 'case:transition')
    || hasPermission(user.value?.permissions ?? [], 'case:*'),
);

const openAppeal = computed(() => appeals.value.find((a) => a.status === 'open'));

async function load() {
  loading.value = true;
  try {
    await fetchMe();
    const res = await api<{ appeals: AppealRow[] }>(`/api/v1/cases/${props.caseId}/appeals`);
    appeals.value = res.appeals;
  } catch {
    appeals.value = [];
  } finally {
    loading.value = false;
  }
}

async function decide(appealId: string, decision: 'uphold' | 'dismiss') {
  decideLoading.value = appealId;
  try {
    await api(`/api/v1/cases/${props.caseId}/appeals/${appealId}/decide`, {
      method: 'POST',
      body: {
        decision,
        note: decideNote.value[appealId]?.trim() || undefined,
      },
    });
    toast.add({
      title: decision === 'uphold' ? 'Appeal upheld' : 'Appeal dismissed',
      color: 'success',
    });
    decideNote.value[appealId] = '';
    await load();
    emit('changed');
  } catch (e) {
    toast.add({ title: apiErrorMessage(e), color: 'error' });
  } finally {
    decideLoading.value = null;
  }
}

function statusLabel(status: string) {
  if (status === 'open') return 'Open';
  if (status === 'upheld') return 'Upheld';
  if (status === 'dismissed') return 'Dismissed';
  return status;
}

function statusColor(status: string): string {
  if (status === 'open') return 'warning';
  if (status === 'upheld') return 'success';
  if (status === 'dismissed') return 'neutral';
  return 'neutral';
}

onMounted(() => load());

defineExpose({ reload: load });
</script>

<template>
  <details
    :open="statusTag === 'appeal' || appeals.length > 0"
    class="group rounded-lg border border-default bg-default w-full"
  >
    <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium hover:bg-elevated/40 rounded-lg [&::-webkit-details-marker]:hidden">
      <div class="flex min-w-0 items-center gap-2">
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" />
        <span>Appeals</span>
        <UBadge v-if="openAppeal" color="warning" variant="subtle" size="xs">open</UBadge>
      </div>
    </summary>
    <div class="px-4 pb-4 pt-0 border-t border-default">
      <div v-if="loading" class="py-4 text-sm text-muted">Loading appeals…</div>
      <p v-else-if="!appeals.length" class="py-4 text-sm text-muted">No appeals recorded for this case.</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="a in appeals" :key="a.id" class="py-4 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium">Round {{ a.round }}</span>
            <UBadge :color="statusColor(a.status) as any" variant="subtle" size="xs">{{ statusLabel(a.status) }}</UBadge>
            <span class="text-xs text-muted">{{ formatLocalDate(a.raised_at) }}</span>
            <span v-if="a.routed_to_level_code" class="text-xs text-muted capitalize">
              → {{ a.routed_to_level_code }} level
            </span>
          </div>
          <p class="text-sm whitespace-pre-wrap">{{ a.reason }}</p>
          <p v-if="a.decision_note" class="text-xs text-muted">
            Decision note: {{ a.decision_note }}
            <span v-if="a.decided_at"> · {{ formatLocalDate(a.decided_at) }}</span>
          </p>
          <div
            v-if="a.status === 'open' && canDecide"
            class="pt-2 space-y-2 border-t border-default"
          >
            <UTextarea
              v-model="decideNote[a.id]"
              :rows="2"
              placeholder="Optional note for the decision…"
              class="w-full"
            />
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                :loading="decideLoading === a.id"
                @click="decide(a.id, 'uphold')"
              >
                Uphold appeal
              </UButton>
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                :loading="decideLoading === a.id"
                @click="decide(a.id, 'dismiss')"
              >
                Dismiss appeal
              </UButton>
            </div>
          </div>
        </li>
      </ul>
    </div>
  </details>
</template>
