import { normalizeIntakeValues, coerceIntakeString } from '~/utils/intake-values';

export interface AssistedIntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'phone' | 'email' | 'number';
  section: 'complainant' | 'grievance' | 'outcome';
  required: boolean;
  label: Record<string, string>;
  help?: Record<string, string>;
  options?: { value: string; label: Record<string, string> }[];
  options_ref?: string;
}

export interface AssistedIntakeMeta {
  locales: { default: string; enabled: string[] };
  anonymous_allowed: boolean;
  consent_text: Record<string, string>;
  fields: AssistedIntakeField[];
  categories: { code: string; label: Record<string, string> }[];
  notification_channels: Array<{
    value: 'sms' | 'email' | 'whatsapp';
    label: Record<string, string>;
    requires: 'phone' | 'email';
  }>;
}

export interface SourceChannelOption {
  value: string;
  label: string;
}

function formatSourceChannelLabel(code: string): string {
  return code
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function useAssistedIntake() {
  const { api } = useApi();

  const meta = useState<AssistedIntakeMeta | null>('assisted_intake_meta', () => null);
  const sourceChannels = useState<SourceChannelOption[]>('assisted_source_channels', () => []);

  async function loadMeta() {
    if (meta.value) return meta.value;
    meta.value = await api<AssistedIntakeMeta>('/api/v1/public/intake-meta');
    return meta.value;
  }

  async function loadSourceChannels() {
    const res = await api<{
      payload?: { modules?: { assisted?: { enabled?: boolean; source_channels?: string[] } } };
    }>('/api/v1/config/cd08_channels');
    const assisted = res.payload?.modules?.assisted;
    if (!assisted?.enabled) {
      sourceChannels.value = [];
      return sourceChannels.value;
    }
    sourceChannels.value = (assisted.source_channels ?? []).map((code) => ({
      value: code,
      label: formatSourceChannelLabel(code),
    }));
    return sourceChannels.value;
  }

  async function searchIntakeUnits(opts: { q?: string; id?: string; limit?: number }) {
    const rows = await api<{
      units: { id: string; name: string; breadcrumb: string }[];
    }>('/api/v1/public/intake-units/search', { query: opts });
    return rows.units.map((u) => ({
      value: u.id,
      label: u.name,
      description: u.breadcrumb,
    }));
  }

  function fieldOptions(field: AssistedIntakeField, locale: string) {
    if (field.options) {
      return field.options.map((o) => ({
        value: o.value,
        label: o.label[locale] ?? o.label.en ?? o.value,
      }));
    }
    if (field.options_ref === 'taxonomy:categories' && meta.value) {
      return meta.value.categories.map((c) => ({
        value: c.code,
        label: c.label[locale] ?? c.label.en ?? c.code,
      }));
    }
    return [];
  }

  async function submitAssisted(payload: {
    source_channel: unknown;
    anonymous: boolean;
    consent: boolean;
    values: Record<string, unknown>;
  }) {
    const source_channel = coerceIntakeString(payload.source_channel)
      ?? (payload.source_channel && typeof payload.source_channel === 'object' && 'value' in payload.source_channel
        ? coerceIntakeString((payload.source_channel as { value: unknown }).value)
        : null);
    if (!source_channel) {
      throw new Error('Select how the grievance was received (source channel).');
    }

    return api<{
      case_id: string;
      reference: string;
      status: string;
      tracking_pin?: string;
      possible_duplicates?: number;
    }>('/api/v1/cases', {
      method: 'POST',
      body: {
        source_channel,
        anonymous: payload.anonymous,
        consent: payload.consent,
        values: normalizeIntakeValues(payload.values),
      },
    });
  }

  return {
    meta,
    sourceChannels,
    loadMeta,
    loadSourceChannels,
    searchIntakeUnits,
    fieldOptions,
    submitAssisted,
  };
}
