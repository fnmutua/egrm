import { hasPermission } from '@egrm/core';
import { apiErrorMessage } from '~/utils/api-errors';

export interface CaseFieldOptions {
  categories: { value: string; label: string }[];
  priorities: { value: string; label: string }[];
  sensitivity: { value: string; label: string; restricted: boolean }[];
  complainant?: {
    gender: { value: string; label: string }[];
    age_band: { value: string; label: string }[];
    preferred_language: { value: string; label: string }[];
    notification_channels: { value: string; label: string }[];
  };
}

export interface CaseFieldPatchResult {
  summary: string;
  description: string | null;
  expected_outcome: string | null;
  date_occurred: string | null;
  categories: string[];
  priority: string;
  sensitivity: string;
  unit_id: string | null;
  unit: string | null;
  level: string;
}

export interface ComplainantPatchResult {
  name: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  age_band: string | null;
  preferred_language: string | null;
  notification_channels: string[];
}

export function useCaseFieldEdit(caseId: Ref<string> | string) {
  const { api } = useApi();
  const { user } = useAuth();
  const toast = useToast();

  const resolvedCaseId = computed(() => (typeof caseId === 'string' ? caseId : caseId.value));
  const options = ref<CaseFieldOptions | null>(null);
  const optionsLoading = ref(false);
  const savingField = ref<string | null>(null);

  const canEditFields = computed(() => hasPermission(user.value?.permissions ?? [], 'case:edit_fields'));
  const canEditSensitivity = computed(() => {
    if (!canEditFields.value) return false;
    if (hasPermission(user.value?.permissions ?? [], 'sensitive:handle')) return true;
    const restricted = options.value?.sensitivity.filter((s) => s.restricted).map((s) => s.value) ?? [];
    const cleared = user.value?.permissions?.includes('admin:*') ?? false;
    return cleared || restricted.length === 0;
  });

  function canEditSensitivityValue(code: string): boolean {
    if (!canEditFields.value) return false;
    const cls = options.value?.sensitivity.find((s) => s.value === code);
    if (!cls?.restricted) return true;
    return hasPermission(user.value?.permissions ?? [], 'sensitive:handle');
  }

  async function loadOptions() {
    if (!canEditFields.value || options.value) return options.value;
    optionsLoading.value = true;
    try {
      const res = await api<{ options: CaseFieldOptions }>('/api/v1/cases/field-options');
      options.value = res.options;
      return options.value;
    } catch {
      options.value = null;
      return null;
    } finally {
      optionsLoading.value = false;
    }
  }

  async function saveField(field: string, value: unknown): Promise<CaseFieldPatchResult | null> {
    savingField.value = field;
    try {
      const res = await api<{ case: CaseFieldPatchResult }>(`/api/v1/cases/${resolvedCaseId.value}/fields`, {
        method: 'PATCH',
        body: { fields: { [field]: value } },
      });
      toast.add({ title: 'Case updated', color: 'success' });
      return res.case;
    } catch (e: unknown) {
      toast.add({ title: 'Could not save', description: apiErrorMessage(e), color: 'error' });
      return null;
    } finally {
      savingField.value = null;
    }
  }

  async function saveComplainantField(field: string, value: unknown): Promise<ComplainantPatchResult | null> {
    savingField.value = `complainant.${field}`;
    try {
      const res = await api<{ complainant: ComplainantPatchResult }>(`/api/v1/cases/${resolvedCaseId.value}/complainant`, {
        method: 'PATCH',
        body: { fields: { [field]: value } },
      });
      toast.add({ title: 'Complainant updated', color: 'success' });
      return res.complainant;
    } catch (e: unknown) {
      toast.add({ title: 'Could not save', description: apiErrorMessage(e), color: 'error' });
      return null;
    } finally {
      savingField.value = null;
    }
  }

  function labelFor(map: { value: string; label: string }[], code: string): string {
    return map.find((o) => o.value === code)?.label ?? code.replace(/_/g, ' ');
  }

  function formatCategoryList(codes: string[]): string {
    if (!codes.length) return '—';
    const map = options.value?.categories ?? [];
    return codes.map((c) => labelFor(map, c)).join(', ');
  }

  function formatNotificationChannels(channels: string[]): string {
    if (!channels.length) return '—';
    const map = options.value?.complainant?.notification_channels ?? [];
    return channels.map((c) => labelFor(map, c)).join(', ');
  }

  return {
    options,
    optionsLoading,
    savingField,
    canEditFields,
    canEditSensitivity,
    canEditSensitivityValue,
    loadOptions,
    saveField,
    saveComplainantField,
    labelFor,
    formatCategoryList,
    formatNotificationChannels,
  };
}
