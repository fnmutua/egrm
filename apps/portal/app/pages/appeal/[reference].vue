<script setup lang="ts">
import type { AppealEligibility, ComplainantAppeal } from '~/composables/useIntake';

const route = useRoute();
const { track, appeal } = useIntake();
const { trackPath } = usePortalCasePaths();

const reference = computed(() => decodeURIComponent(String(route.params.reference ?? '')).trim());

const verifier = ref('');
const loading = ref(false);
const loadError = ref('');
const caseStatus = ref<string | null>(null);
const statusTag = ref('neutral');
const appealInfo = ref<AppealEligibility | null>(null);
const appealHistory = ref<ComplainantAppeal[]>([]);
const timeline = ref<{ kind: string; data: Record<string, unknown>; createdAt: string }[]>([]);

const appealReason = ref('');
const appealLoading = ref(false);
const appealError = ref('');
const appealSuccess = ref('');

const tagColor: Record<string, string> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
  rejected: 'error',
  on_hold: 'neutral',
  appeal: 'warning',
};

const appealWindowHint = computed(() => {
  const a = appealInfo.value;
  if (!a?.enabled || a.eligible) return '';
  if (a.reason === 'appeal_pending') return 'Your appeal is already being reviewed.';
  if (a.reason === 'window_closed') return 'The appeal window for this resolution has closed.';
  if (a.reason === 'max_rounds_reached') return 'The maximum number of appeals has been reached.';
  if (a.reason === 'not_resolved') return 'Appeals are only available after a case has been resolved.';
  if (a.reason === 'appeals_disabled') return 'Appeals are not available for this programme.';
  return '';
});

const showAppealForm = computed(() => Boolean(appealInfo.value?.eligible));

function appealErrorMessage(code: string, fallback?: string) {
  const messages: Record<string, string> = {
    appeals_disabled: 'Appeals are not available for this programme.',
    not_resolved: 'Appeals are only allowed after a case has been resolved.',
    appeal_pending: 'An appeal is already being reviewed.',
    max_rounds_reached: 'No further appeals are allowed for this case.',
    window_closed: 'The appeal window has closed.',
    reason_too_short: 'Please explain why you are appealing (at least 10 characters).',
  };
  return messages[code] ?? fallback ?? 'Could not submit your appeal.';
}

async function loadCase() {
  if (!reference.value || !verifier.value.trim()) return;
  loading.value = true;
  loadError.value = '';
  appealInfo.value = null;
  caseStatus.value = null;
  statusTag.value = 'neutral';
  appealHistory.value = [];
  timeline.value = [];
  appealError.value = '';
  appealSuccess.value = '';
  try {
    const result = await track(reference.value, verifier.value.trim());
    caseStatus.value = result.status;
    statusTag.value = result.status_tag;
    appealInfo.value = result.appeal;
    appealHistory.value = result.appeals ?? [];
    timeline.value = result.timeline ?? [];
  } catch {
    loadError.value = 'No case found for that reference and verification detail.';
  } finally {
    loading.value = false;
  }
}

async function doAppeal() {
  if (!showAppealForm.value || !appealReason.value.trim()) return;
  appealLoading.value = true;
  appealError.value = '';
  appealSuccess.value = '';
  try {
    await appeal({
      reference: reference.value,
      verifier: verifier.value.trim(),
      reason: appealReason.value.trim(),
    });
    appealReason.value = '';
    appealSuccess.value = 'Your appeal has been submitted. The case will be reviewed at the next level.';
    await loadCase();
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    appealError.value = appealErrorMessage(err.data?.error ?? '', err.data?.message);
  } finally {
    appealLoading.value = false;
  }
}

useHead({
  title: () => (reference.value ? `Appeal ${reference.value}` : 'Appeal'),
});
</script>

<template>
  <div class="min-h-screen flex flex-col bg-elevated/30">
    <PortalPageHeader>
      <NuxtLink to="/" class="text-sm text-muted hover:text-highlighted transition-colors">&larr; Home</NuxtLink>
    </PortalPageHeader>

    <div class="border-b border-default bg-default">
      <div class="max-w-xl mx-auto px-4 py-4">
        <div class="flex items-center gap-2.5">
          <UIcon name="i-lucide-scale" class="text-xl text-primary shrink-0" />
          <h1 class="text-xl font-bold">Appeal a resolution</h1>
        </div>
        <p class="text-muted text-sm mt-1 ml-8">
          If you are not satisfied with the outcome, you may request a review within the published appeal window.
        </p>
      </div>
    </div>

    <main class="flex-1 py-6 px-4">
      <div class="max-w-xl mx-auto space-y-6">
        <UCard>
          <template #header>
            <div class="space-y-1">
              <div class="flex items-center justify-between gap-2 flex-wrap">
                <span class="font-mono text-lg font-bold tracking-wide">{{ reference || '—' }}</span>
                <UBadge
                  v-if="caseStatus"
                  :color="(tagColor[statusTag] as any) ?? 'neutral'"
                  variant="subtle"
                  size="lg"
                >
                  {{ caseStatus }}
                </UBadge>
              </div>
              <p class="text-xs text-muted">Confirm your identity to continue.</p>
            </div>
          </template>

          <form class="space-y-4" @submit.prevent="loadCase">
            <UFormField label="Phone, email or tracking PIN" required help="The phone/email you submitted with, or the PIN issued for anonymous cases.">
              <UInput v-model="verifier" class="w-full" autocomplete="off" />
            </UFormField>
            <UAlert v-if="loadError" color="error" :title="loadError" />
            <UButton type="submit" block :loading="loading" :disabled="!verifier.trim()">
              Continue
            </UButton>
          </form>
        </UCard>

        <UCard v-if="appealInfo && !loadError">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-scale" class="text-primary" />
              <span class="font-semibold">Your appeals</span>
            </div>
          </template>

          <div class="space-y-4">
            <PortalAppealHistory v-if="appealHistory.length" :appeals="appealHistory" />

            <UAlert
              v-if="appealSuccess"
              color="success"
              :title="appealSuccess"
            />
            <template v-else-if="showAppealForm">
              <p class="text-sm text-muted">
                You may appeal within
                <strong>{{ appealInfo.days_remaining }}</strong>
                day(s) (by {{ new Date(appealInfo.window_ends_at!).toLocaleDateString() }}).
              </p>
              <UFormField label="Why are you appealing?" required>
                <UTextarea
                  v-model="appealReason"
                  :rows="5"
                  class="w-full"
                  maxlength="4000"
                  placeholder="Explain why you disagree with the resolution…"
                />
              </UFormField>
              <UAlert v-if="appealError" color="error" :title="appealError" />
              <UButton
                :loading="appealLoading"
                :disabled="appealReason.trim().length < 10"
                block
                @click="doAppeal"
              >
                Submit appeal
              </UButton>
            </template>
            <p v-else-if="appealWindowHint" class="text-sm text-muted">{{ appealWindowHint }}</p>
            <p v-else-if="!appealHistory.length" class="text-sm text-muted">This case cannot be appealed at this time.</p>

            <div v-if="timeline.length" class="pt-4 border-t border-default">
              <p class="text-sm font-semibold mb-2">Recent updates</p>
              <PortalCaseTimeline :events="timeline" />
            </div>

            <p class="text-xs text-muted pt-2 border-t border-default">
              <NuxtLink :to="trackPath(reference)" class="text-primary underline">
                Track case status
              </NuxtLink>
              instead
            </p>
          </div>
        </UCard>
      </div>
    </main>
  </div>
</template>
