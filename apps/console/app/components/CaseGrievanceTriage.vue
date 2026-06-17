<script setup lang="ts">
const props = defineProps<{
  caseId: string;
  categories: string[];
  priority: string;
  sensitivity: string;
}>();

const emit = defineEmits<{ applied: [] }>();

const caseIdRef = toRef(props, 'caseId');

const {
  loading,
  deciding,
  rerunning,
  polled,
  view,
  triage,
  failed,
  configHint,
  canEditFields,
  canHandleSensitive,
  taxonomyLabels,
  pct,
  formatCodes,
  rerunTriage,
  acceptAll,
  dismissAll,
  applyCategories,
  applyPriority,
  confirmSensitivity,
  clearSensitivity,
} = useCaseAiTriage(caseIdRef);

const suggestion = computed(() => triage.value?.suggestion ?? null);

const suggestedCategories = computed(() => suggestion.value?.categories ?? []);
const suggestedPriority = computed(() => suggestion.value?.priority ?? null);

const categoriesDiffer = computed(() => {
  if (!suggestedCategories.value.length) return false;
  const current = [...props.categories].sort().join(',');
  const suggested = [...suggestedCategories.value].sort().join(',');
  return current !== suggested;
});

const priorityDiffers = computed(() =>
  Boolean(suggestedPriority.value && suggestedPriority.value !== props.priority),
);

const sensitivityFlagged = computed(() => Boolean(suggestion.value?.sensitivity_pending_confirm));

async function onAcceptAll() {
  if (await acceptAll()) emit('applied');
}

async function onDismissAll() {
  if (await dismissAll()) emit('applied');
}

async function onApplyCategories() {
  if (!suggestedCategories.value.length) return;
  if (await applyCategories(suggestedCategories.value)) emit('applied');
}

async function onApplyPriority() {
  if (!suggestedPriority.value) return;
  if (await applyPriority(suggestedPriority.value)) emit('applied');
}

async function onConfirmSensitivity() {
  if (await confirmSensitivity()) emit('applied');
}

async function onClearSensitivity() {
  if (await clearSensitivity()) emit('applied');
}
</script>

<template>
  <div v-if="loading" class="text-sm text-muted py-2 border-b border-default mb-3">
    Checking AI triage…
  </div>

  <UAlert
    v-else-if="configHint"
    class="mb-3"
    color="warning"
    variant="subtle"
    title="AI triage not active"
    :description="configHint"
  >
    <template #actions>
      <UButton to="/admin/config/cd16_ai" size="xs" variant="outline">AI settings</UButton>
    </template>
  </UAlert>

  <UAlert
    v-else-if="failed && !triage"
    class="mb-3"
    color="error"
    variant="subtle"
    title="AI triage failed"
    :description="failed.error ?? 'Check your API key and model in CD-16.'"
  >
    <template #actions>
      <UButton v-if="canEditFields" size="xs" color="primary" :loading="rerunning" @click="rerunTriage">
        Retry
      </UButton>
    </template>
  </UAlert>

  <div
    v-else-if="triage && suggestion"
    class="mb-4 rounded-lg border border-primary/30 bg-primary/5 overflow-hidden"
  >
    <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-primary/20 bg-primary/10">
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
        <span class="text-sm font-medium">Officer review — AI triage</span>
        <UBadge color="warning" variant="subtle" size="sm">Pending confirmation</UBadge>
      </div>
      <p class="text-xs text-muted">Confirm or adjust before the case proceeds</p>
    </div>

    <div class="px-4 py-3 space-y-4">
      <p v-if="suggestion.rationale" class="text-sm text-muted">
        {{ suggestion.rationale }}
      </p>

      <!-- Categories -->
      <div v-if="suggestedCategories.length" class="space-y-1.5">
        <p class="text-xs font-medium text-muted uppercase tracking-wide">Categories</p>
        <div class="grid sm:grid-cols-[1fr_auto] gap-3 items-start text-sm">
          <div class="space-y-1">
            <p>
              <span class="text-muted">On file:</span>
              {{ formatCodes(taxonomyLabels.categories, categories) }}
            </p>
            <p :class="categoriesDiffer ? 'text-primary font-medium' : 'text-muted'">
              <span class="text-muted font-normal">AI suggests:</span>
              {{ formatCodes(taxonomyLabels.categories, suggestedCategories) }}
              <span class="text-xs font-normal text-muted">({{ pct(suggestion.category_confidence) }})</span>
            </p>
          </div>
          <UButton
            v-if="canEditFields && categoriesDiffer"
            size="xs"
            color="primary"
            variant="soft"
            :loading="deciding"
            @click="onApplyCategories"
          >
            Use AI categories
          </UButton>
        </div>
      </div>

      <!-- Priority -->
      <div v-if="suggestedPriority" class="space-y-1.5">
        <p class="text-xs font-medium text-muted uppercase tracking-wide">Priority</p>
        <div class="grid sm:grid-cols-[1fr_auto] gap-3 items-start text-sm">
          <div class="space-y-1">
            <p>
              <span class="text-muted">On file:</span>
              <span class="capitalize">{{ formatCodes(taxonomyLabels.priorities, [priority]) }}</span>
            </p>
            <p :class="priorityDiffers ? 'text-primary font-medium' : 'text-muted'">
              <span class="text-muted font-normal">AI suggests:</span>
              <span class="capitalize">{{ formatCodes(taxonomyLabels.priorities, [suggestedPriority]) }}</span>
              <span class="text-xs font-normal text-muted">({{ pct(suggestion.priority_confidence) }})</span>
            </p>
          </div>
          <UButton
            v-if="canEditFields && priorityDiffers"
            size="xs"
            color="primary"
            variant="soft"
            :loading="deciding"
            @click="onApplyPriority"
          >
            Use AI priority
          </UButton>
        </div>
      </div>

      <!-- Sensitivity -->
      <div v-if="sensitivityFlagged" class="space-y-1.5 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <p class="text-xs font-medium text-warning uppercase tracking-wide">Sensitivity</p>
        <div class="grid sm:grid-cols-[1fr_auto] gap-3 items-start text-sm">
          <div class="space-y-1">
            <p>
              <span class="text-muted">Current class:</span>
              {{ formatCodes(taxonomyLabels.sensitivity, [sensitivity]) }}
            </p>
            <p class="font-medium text-warning">
              AI flagged:
              {{ formatCodes(taxonomyLabels.sensitivity, [suggestion.applied_sensitivity ?? suggestion.sensitivity_class ?? '']) }}
              ({{ pct(suggestion.sensitivity_confidence) }})
            </p>
            <p v-if="suggestion.indicators?.length" class="text-xs text-muted">
              {{ suggestion.indicators.join(' · ') }}
            </p>
            <p class="text-xs text-muted">Access restrictions are active until you confirm or clear this flag.</p>
          </div>
          <div v-if="canHandleSensitive" class="flex flex-col gap-1.5">
            <UButton size="xs" color="warning" :loading="deciding" @click="onConfirmSensitivity">
              Confirm restriction
            </UButton>
            <UButton size="xs" color="neutral" variant="ghost" :loading="deciding" @click="onClearSensitivity">
              Clear flag
            </UButton>
          </div>
        </div>
      </div>

      <div
        v-if="canEditFields"
        class="flex flex-wrap gap-2 pt-2 border-t border-default/60"
      >
        <UButton size="sm" color="primary" :loading="deciding" @click="onAcceptAll">
          Confirm all suggestions
        </UButton>
        <UButton size="sm" color="neutral" variant="outline" :loading="deciding" @click="onDismissAll">
          Dismiss all
        </UButton>
      </div>
    </div>
  </div>

  <div
    v-else-if="view?.config.ready && canEditFields && polled >= 3"
    class="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted"
  >
    <span>No AI triage suggestions for this grievance.</span>
    <UButton size="xs" variant="outline" :loading="rerunning" @click="rerunTriage">Run AI triage</UButton>
  </div>
</template>
