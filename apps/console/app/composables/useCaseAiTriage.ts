import { hasPermission } from '@egrm/core';
import { apiErrorMessage } from '~/utils/api-errors';

export interface TriageSuggestion {
  categories?: string[];
  category_confidence?: number;
  priority?: string;
  priority_confidence?: number;
  sensitivity_class?: string | null;
  sensitivity_confidence?: number;
  indicators?: string[];
  rationale?: string;
  sensitivity_pending_confirm?: boolean;
  sensitivity_applied?: boolean;
  applied_sensitivity?: string;
  has_actionable_category?: boolean;
}

export interface AiInteraction {
  id: string;
  capability: string;
  suggestion: TriageSuggestion;
  confidence: number | null;
  status: string;
  decision: string | null;
  error?: string | null;
  created_at: string;
}

export interface TriageConfig {
  ready: boolean;
  reason?: string;
  ai_assistance: boolean;
  cd16_enabled: boolean;
  auto_categorize: boolean;
  sensitivity_detect: boolean;
}

export interface TriageView {
  config: TriageConfig;
  interactions: AiInteraction[];
  pending: AiInteraction[];
  latest: AiInteraction | null;
  labels: TaxonomyLabels;
}

export interface TaxonomyLabels {
  categories: Record<string, string>;
  priorities: Record<string, string>;
  sensitivity: Record<string, string>;
}

export function useCaseAiTriage(caseId: Ref<string> | string) {
  const { api } = useApi();
  const { user } = useAuth();
  const toast = useToast();

  const resolvedCaseId = computed(() => (typeof caseId === 'string' ? caseId : caseId.value));

  const loading = ref(true);
  const deciding = ref(false);
  const rerunning = ref(false);
  const polled = ref(0);
  const view = ref<TriageView | null>(null);
  const taxonomyLabels = computed<TaxonomyLabels>(() =>
    view.value?.labels ?? { categories: {}, priorities: {}, sensitivity: {} },
  );

  const triage = computed(() =>
    view.value?.pending.find((i) => i.capability === 'auto_categorize' && i.status === 'completed') ?? null,
  );

  const failed = computed(() => {
    const latest = view.value?.latest;
    if (!latest || latest.status !== 'failed') return null;
    return latest;
  });

  const configHint = computed(() => {
    const cfg = view.value?.config;
    if (!cfg || cfg.ready) return null;
    if (cfg.reason === 'cd14_off') return 'AI assistance is off under Platform → Feature flags (CD-14).';
    if (cfg.reason === 'cd16_off') return 'Turn on the AI master switch under Admin → Chatbot & AI (CD-16) and save.';
    if (cfg.reason === 'capabilities_off') {
      return 'Enable Auto-categorization and/or Sensitivity detection under CD-16 → Capabilities, then save.';
    }
    if (cfg.reason === 'no_profile') return 'Enable at least one provider profile in CD-16 and assign it to triage capabilities.';
    return 'AI triage is not configured for this tenant.';
  });

  const canEditFields = computed(() => hasPermission(user.value?.permissions ?? [], 'case:edit_fields'));
  const canHandleSensitive = computed(() => hasPermission(user.value?.permissions ?? [], 'sensitive:handle'));

  function pct(n?: number) {
    if (n == null) return '—';
    return `${Math.round(n * 100)}%`;
  }

  function label(map: Record<string, string>, code: string) {
    return map[code] ?? code.replace(/_/g, ' ');
  }

  function formatCodes(map: Record<string, string>, codes: string[]) {
    if (!codes.length) return '—';
    return codes.map((c) => label(map, c)).join(', ');
  }

  async function load() {
    try {
      view.value = await api<TriageView>(`/api/v1/cases/${resolvedCaseId.value}/ai/triage`);
    } catch {
      view.value = null;
    } finally {
      loading.value = false;
      polled.value += 1;
    }
  }

  async function rerunTriage() {
    rerunning.value = true;
    try {
      view.value = await api<TriageView>(`/api/v1/cases/${resolvedCaseId.value}/ai/triage/run`, { method: 'POST' });
      if (!view.value.pending.length && view.value.latest?.status === 'failed') {
        toast.add({
          title: 'AI triage failed',
          description: view.value.latest.error ?? 'Check provider settings in CD-16.',
          color: 'error',
        });
      }
    } catch (e: unknown) {
      toast.add({ title: 'Could not run AI triage', description: apiErrorMessage(e), color: 'error' });
    } finally {
      rerunning.value = false;
    }
  }

  async function decide(
    interactionId: string,
    decision: 'accepted' | 'edited' | 'rejected',
    edited_payload?: Record<string, unknown>,
  ) {
    deciding.value = true;
    try {
      await api(`/api/v1/ai/interactions/${interactionId}/decide`, {
        method: 'POST',
        body: { decision, edited_payload },
      });
      toast.add({
        title: decision === 'rejected' ? 'AI suggestion dismissed' : 'Grievance details updated',
        color: decision === 'rejected' ? 'neutral' : 'success',
      });
      await load();
      return true;
    } catch (e: unknown) {
      toast.add({ title: 'Could not update', description: apiErrorMessage(e), color: 'error' });
      return false;
    } finally {
      deciding.value = false;
    }
  }

  async function acceptAll() {
    if (!triage.value) return false;
    return decide(triage.value.id, 'accepted', {
      confirm_sensitivity: triage.value.suggestion.sensitivity_pending_confirm ? true : undefined,
    });
  }

  async function dismissAll() {
    if (!triage.value) return false;
    return decide(triage.value.id, 'rejected');
  }

  async function applyCategories(categories: string[]) {
    if (!triage.value) return false;
    return decide(triage.value.id, 'edited', { categories });
  }

  async function applyPriority(priority: string) {
    if (!triage.value) return false;
    return decide(triage.value.id, 'edited', { priority });
  }

  async function confirmSensitivity() {
    if (!triage.value) return false;
    return decide(triage.value.id, 'accepted', { confirm_sensitivity: true });
  }

  async function clearSensitivity() {
    if (!triage.value) return false;
    return decide(triage.value.id, 'rejected', { clear_sensitivity: true });
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    polled.value = 0;
    pollTimer = setInterval(() => {
      if (triage.value || failed.value || polled.value >= 12 || configHint.value) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        return;
      }
      load();
    }, 2500);
  }

  onMounted(() => {
    load();
    startPolling();
  });

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  watch(resolvedCaseId, () => {
    loading.value = true;
    load();
    startPolling();
  });

  return {
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
    label,
    formatCodes,
    load,
    rerunTriage,
    acceptAll,
    dismissAll,
    applyCategories,
    applyPriority,
    confirmSensitivity,
    clearSensitivity,
  };
}
