import { normalizeIntakeValues } from '../utils/intake-values';

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

export interface IntakeNotificationChannel {
  value: 'sms' | 'email' | 'whatsapp';
  label: Record<string, string>;
  requires: 'phone' | 'email';
}

export interface IntakeAttachmentKind {
  code: string;
  label: Record<string, string>;
}

export interface IntakeAttachmentsMeta {
  enabled: boolean;
  max_files: number;
  kinds: IntakeAttachmentKind[];
}

export interface IntakeCorrespondenceMeta {
  enabled: boolean;
  allow_reply: boolean;
  max_body_length: number;
  reply_attachments_enabled: boolean;
  max_reply_files: number;
  reply_kinds: IntakeAttachmentKind[];
}

export interface IntakeMeta {
  locales: { default: string; enabled: string[] };
  anonymous_allowed: boolean;
  consent_text: Record<string, string>;
  fields: IntakeField[];
  categories: { code: string; label: Record<string, string> }[];
  levels: { code: string; label: string; allows_intake?: boolean; is_intake_default?: boolean }[];
  /** CD-09 configured outbound channels the complainant may opt into. */
  notification_channels: IntakeNotificationChannel[];
  attachments: IntakeAttachmentsMeta;
  correspondence: IntakeCorrespondenceMeta;
}

export interface IntakeOption {
  value: string;
  label: string;
}

export type IntakeSelectItem = IntakeOption;

export interface AppealEligibility {
  enabled: boolean;
  eligible: boolean;
  reason?: string;
  window_days?: number;
  window_ends_at?: string;
  days_remaining?: number;
  rounds_used?: number;
  max_rounds?: number;
  open_appeal?: boolean;
}

export interface ComplainantAppeal {
  round: number;
  status: 'open' | 'upheld' | 'dismissed';
  raised_at: string;
  decision: 'accepted' | 'rejected' | null;
  decided_at: string | null;
  outcome_label: string;
}

export function useIntake() {
  const apiBase = usePublicApiBase();
  const config = useRuntimeConfig();
  const headers = { 'x-tenant': config.public.tenant };

  const meta = useState<IntakeMeta | null>('intake_meta', () => null);

  async function loadMeta() {
    if (meta.value) return meta.value;
    meta.value = await $fetch<IntakeMeta>('/api/v1/public/intake-meta', {
      baseURL: apiBase.value,
      headers,
    });
    return meta.value;
  }

  async function searchIntakeUnits(opts: { q?: string; id?: string; limit?: number }) {
    const rows = await $fetch<{
      units: { id: string; name: string; breadcrumb: string }[];
    }>('/api/v1/public/intake-units/search', {
      baseURL: apiBase.value,
      headers,
      query: opts,
    });
    return rows.units.map((u) => ({
      value: u.id,
      label: u.name,
      description: u.breadcrumb,
    }));
  }

  /** Options for a field, resolving options_ref against meta (taxonomy lists). */
  function fieldOptions(field: IntakeField, locale: string): IntakeSelectItem[] {
    if (field.options) {
      return field.options.map((o) => ({ value: o.value, label: o.label[locale] ?? o.label.en ?? o.value }));
    }
    if (field.options_ref === 'units') {
      return [];
    }
    if (field.options_ref === 'taxonomy:categories' && meta.value) {
      return meta.value.categories.map((c) => ({ value: c.code, label: c.label[locale] ?? c.label.en ?? c.code }));
    }
    return [];
  }

  async function submit(payload: {
    anonymous: boolean;
    consent: boolean;
    values: Record<string, unknown>;
    files?: { file: File; kind: string }[];
  }) {
    const body = {
      anonymous: payload.anonymous,
      consent: payload.consent,
      values: normalizeIntakeValues(payload.values),
    };

    if (payload.files?.length) {
      const form = new FormData();
      form.append('payload', JSON.stringify(body));
      for (const item of payload.files) {
        form.append('files', item.file);
        form.append('kinds', item.kind);
      }
      return await $fetch<{
        reference: string;
        status: string;
        tracking_pin?: string;
        possible_duplicates: number;
      }>('/api/v1/public/cases', {
        baseURL: apiBase.value,
        method: 'POST',
        headers,
        body: form,
      });
    }

    return await $fetch<{
      reference: string;
      status: string;
      tracking_pin?: string;
      possible_duplicates: number;
    }>('/api/v1/public/cases', {
      baseURL: apiBase.value,
      method: 'POST',
      headers,
      body,
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
      messages: {
        id: string;
        direction: string;
        message_kind: string;
        body: string;
        author_name: string | null;
        in_reply_to_id?: string | null;
        attachments: { id: string; filename: string; kind: string; kind_label: string }[];
        created_at: string;
      }[];
      reply_allowed: boolean;
      appeal: AppealEligibility;
      appeals: ComplainantAppeal[];
    }>('/api/v1/public/cases/track', {
      baseURL: apiBase.value,
      method: 'POST',
      headers,
      body: { reference, verifier },
    });
  }

  async function reply(payload: {
    reference: string;
    verifier: string;
    body: string;
    files?: { file: File; kind: string }[];
  }) {
    const body = {
      reference: payload.reference,
      verifier: payload.verifier,
      body: payload.body,
    };

    if (payload.files?.length) {
      const form = new FormData();
      form.append('payload', JSON.stringify(body));
      for (const item of payload.files) {
        form.append('files', item.file);
        form.append('kinds', item.kind);
      }
      return await $fetch<{ ok: boolean; id: string }>(`/api/v1/public/cases/${payload.reference}/reply`, {
        baseURL: apiBase.value,
        method: 'POST',
        headers,
        body: form,
      });
    }

    return await $fetch<{ ok: boolean; id: string }>(`/api/v1/public/cases/${payload.reference}/reply`, {
      baseURL: apiBase.value,
      method: 'POST',
      headers,
      body,
    });
  }

  async function appeal(payload: { reference: string; verifier: string; reason: string }) {
    return await $fetch<{ ok: boolean; appeal_id: string; status: string; round: number }>(
      '/api/v1/public/cases/appeal',
      {
        baseURL: apiBase.value,
        method: 'POST',
        headers,
        body: payload,
      },
    );
  }

  return { meta, loadMeta, fieldOptions, searchIntakeUnits, submit, track, reply, appeal };
}
