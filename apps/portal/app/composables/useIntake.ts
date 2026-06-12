export interface IntakeField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'multiselect' | 'date' | 'phone' | 'email' | 'number';
  section: 'complainant' | 'grievance' | 'outcome';
  required: boolean;
  label: Record<string, string>;
  help?: Record<string, string>;
  options?: { value: string; label: Record<string, string> }[];
  options_ref?: string;
}

export interface IntakeMeta {
  locales: { default: string; enabled: string[] };
  anonymous_allowed: boolean;
  consent_text: Record<string, string>;
  fields: IntakeField[];
  categories: { code: string; label: Record<string, string> }[];
  levels: { code: string; label: string; is_intake_default: boolean }[];
  units: { id: string; levelCode: string; parentId: string | null; name: string }[];
}

export function useIntake() {
  const config = useRuntimeConfig();
  const headers = { 'x-tenant': config.public.tenant };

  const meta = useState<IntakeMeta | null>('intake_meta', () => null);

  async function loadMeta() {
    if (meta.value) return meta.value;
    meta.value = await $fetch<IntakeMeta>('/api/v1/public/intake-meta', {
      baseURL: config.public.apiBase,
      headers,
    });
    return meta.value;
  }

  /** Options for a field, resolving options_ref against meta (units / taxonomy lists). */
  function fieldOptions(field: IntakeField, locale: string) {
    if (field.options) {
      return field.options.map((o) => ({ value: o.value, label: o.label[locale] ?? o.label.en ?? o.value }));
    }
    if (field.options_ref === 'units' && meta.value) {
      const byId = new Map(meta.value.units.map((u) => [u.id, u]));
      const intakeLevel = meta.value.levels.find((l) => l.is_intake_default)?.code;
      return meta.value.units
        .filter((u) => !intakeLevel || u.levelCode === intakeLevel)
        .map((u) => {
          const parent = u.parentId ? byId.get(u.parentId) : null;
          return { value: u.id, label: parent ? `${u.name} (${parent.name})` : u.name };
        });
    }
    if (field.options_ref === 'taxonomy:categories' && meta.value) {
      return meta.value.categories.map((c) => ({ value: c.code, label: c.label[locale] ?? c.label.en ?? c.code }));
    }
    return [];
  }

  async function submit(payload: { anonymous: boolean; consent: boolean; values: Record<string, unknown> }) {
    return await $fetch<{
      reference: string;
      status: string;
      tracking_pin?: string;
      possible_duplicates: number;
    }>('/api/v1/public/cases', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers,
      body: payload,
    });
  }

  async function track(reference: string, verifier: string) {
    return await $fetch<{
      reference: string;
      status: string;
      status_tag: string;
      level: string;
      submitted_at: string;
      timeline: { kind: string; data: Record<string, unknown>; createdAt: string }[];
    }>('/api/v1/public/cases/track', {
      baseURL: config.public.apiBase,
      method: 'POST',
      headers,
      body: { reference, verifier },
    });
  }

  return { meta, loadMeta, fieldOptions, submit, track };
}
