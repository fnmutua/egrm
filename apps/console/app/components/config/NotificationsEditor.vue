<script setup lang="ts">
/**
 * CD-09 Notifications: declarative rules, templates, senders, delivery policy (spec 06).
 */
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  TEMPLATE_VARIABLES,
  defaultNotificationPack,
  DEFAULT_INTAKE_ALERTS,
  DEFAULT_STATUS_CHANGE_ALERTS,
  CASE_INTAKE_ALERT_TEMPLATE,
  CASE_STATUS_CHANGED_STAFF_TEMPLATE,
  stripEmptyTemplateVariants,
  ADVANTA_SMS_SENDOTP_URL,
  ADVANTA_SMS_SENDBULK_URL,
  SMS_PROVIDER_PRESETS,
  EMAIL_PROVIDER_PRESETS,
  WHATSAPP_PROVIDER_PRESETS,
  META_WHATSAPP_API_VERSION,
  PROVIDER_FIELD_PLACEHOLDERS,
  applyProviderPreset,
  ensureChannelApiConfig,
  migrateLegacySender,
  COMPLAINANT_WHATSAPP_TEMPLATE_ID_SET,
  KISIP_META_WHATSAPP_TEMPLATES,
} from '@egrm/config-schemas';
import type { ProviderField } from '@egrm/config-schemas';

const EVENT_ITEMS = NOTIFICATION_EVENTS.map((e) => ({
  value: e,
  label: e.replace(/\./g, ' › '),
}));

const CHANNEL_ITEMS = NOTIFICATION_CHANNELS.map((c) => ({
  value: c,
  label: c === 'in_app' ? 'In-app' : c.toUpperCase(),
}));

const RECIPIENT_KINDS = [
  { value: 'party', label: 'Party' },
  { value: 'user', label: 'User' },
  { value: 'role', label: 'Role' },
  { value: 'team', label: 'Team' },
  { value: 'address', label: 'Explicit address' },
];

const PARTY_TARGETS = [
  { value: 'complainant', label: 'Complainant' },
  { value: 'representative', label: 'Representative' },
];

const USER_TARGETS = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'case_creator', label: 'Case creator' },
];

const ROLE_SCOPES = [
  { value: 'case_unit', label: 'Case unit' },
  { value: 'unit_and_above', label: 'Unit & above' },
  { value: 'level', label: 'Level' },
  { value: 'tenant', label: 'Tenant-wide' },
];

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();
const { roleNames, loadRoleNames } = useTenantRoles();

const show = (id: string) => !props.section || props.section === id;

const locales = ref<string[]>(['en', 'sw']);
const workflowStatuses = ref<string[]>(['Rejected', 'Referred', 'Closed', 'Sorting', 'Investigation', 'Resolved']);
const expandedRule = ref<number | null>(0);
const expandedTemplate = ref<number | null>(0);

type SenderChannel = 'email' | 'sms' | 'whatsapp';
const senderExpanded = ref(new Set<SenderChannel>());

function toggleSender(channel: SenderChannel) {
  if (senderExpanded.value.has(channel)) senderExpanded.value.delete(channel);
  else senderExpanded.value.add(channel);
  senderExpanded.value = new Set(senderExpanded.value);
}

onMounted(async () => {
  try {
    const [identity, workflow] = await Promise.all([
      api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity'),
      api<{ payload?: { statuses?: { name: string }[] } }>('/api/v1/config/cd04_workflow').catch(() => ({ payload: undefined })),
    ]);
    if (identity.payload?.locales?.enabled?.length) locales.value = identity.payload.locales.enabled;
    if (workflow.payload?.statuses?.length) {
      workflowStatuses.value = workflow.payload.statuses.map((s) => s.name);
    }
  } catch {
    /* optional */
  }
  await loadRoleNames();
  ensure();
});

const workflowStatusItems = computed(() =>
  workflowStatuses.value.map((n) => ({ value: n, label: n })),
);

const PROVIDER_PRESETS = {
  email: [
    { value: 'smtp', label: 'SMTP' },
    { value: 'gmail', label: 'Gmail' },
    { value: 'sendgrid', label: 'SendGrid' },
    { value: 'mailgun', label: 'Mailgun' },
    { value: 'ses', label: 'Amazon SES' },
  ],
  sms: [
    { value: 'advanta', label: 'Advanta' },
    { value: 'africas_talking', label: "Africa's Talking" },
    { value: 'twilio', label: 'Twilio' },
  ],
  whatsapp: [
    { value: 'meta', label: 'Meta Cloud API' },
    { value: 'twilio', label: 'Twilio WhatsApp' },
  ],
} as const;

function ensureSenderIdentity(sender: Record<string, unknown>, kind: 'sms' | 'email' | 'whatsapp') {
  migrateLegacySender(sender, kind);
  ensureChannelApiConfig(sender);
}

function ensureSmsSender(sms: Record<string, unknown>) {
  ensureSenderIdentity(sms, 'sms');
  if ((sms.fields as ProviderField[]).length === 0) {
    loadSmsPreset(sms);
  }
  sms.bulk_api_url ??= ADVANTA_SMS_SENDBULK_URL;
  if ((sms.provider ?? 'advanta') === 'advanta' && !sms.api_url) {
    sms.api_url = ADVANTA_SMS_SENDOTP_URL;
  }
}

function ensureWhatsappSender(wa: Record<string, unknown>) {
  ensureSenderIdentity(wa, 'whatsapp');
  wa.mode = 'live';
  wa.template_language ??= 'en_US';
  if (!(wa.headers as ProviderField[] | undefined)?.length) {
    loadWhatsappPreset(wa);
  }
}

function addProviderField(list: ProviderField[]) {
  list.push({ key: '', value: '', secret: false });
}

function removeProviderField(list: ProviderField[], i: number) {
  list.splice(i, 1);
}

function loadSmsPreset(sender: Record<string, unknown>) {
  const key = String(sender.provider ?? 'custom').toLowerCase();
  const preset = SMS_PROVIDER_PRESETS[key] ?? SMS_PROVIDER_PRESETS.custom;
  applyProviderPreset(sender, preset, { keepSecrets: true });
  if (key === 'advanta') sender.bulk_api_url = ADVANTA_SMS_SENDBULK_URL;
}

function loadEmailPreset(sender: Record<string, unknown>) {
  const key = String(sender.provider ?? 'smtp').toLowerCase();
  const preset = EMAIL_PROVIDER_PRESETS[key] ?? EMAIL_PROVIDER_PRESETS.smtp;
  applyProviderPreset(sender, preset, { keepSecrets: true });
}

function loadWhatsappPreset(sender: Record<string, unknown>) {
  const key = String(sender.provider ?? 'meta').toLowerCase();
  const preset = WHATSAPP_PROVIDER_PRESETS[key] ?? WHATSAPP_PROVIDER_PRESETS.custom;
  applyProviderPreset(sender, preset, { keepSecrets: true });
  if (key === 'meta' && !String(sender.api_url ?? '').trim()) {
    sender.api_url = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}/{{phone_number_id}}/messages`;
  }
}

watch(
  () => props.payload.senders?.sms?.provider,
  (next, prev) => {
    if (prev !== undefined && next && next !== prev && props.payload.senders?.sms) {
      loadSmsPreset(props.payload.senders.sms);
    }
  },
);

watch(
  () => props.payload.senders?.email?.provider,
  (next, prev) => {
    if (prev !== undefined && next && next !== prev && props.payload.senders?.email) {
      loadEmailPreset(props.payload.senders.email);
    }
  },
);

watch(
  () => props.payload.senders?.whatsapp?.provider,
  (next, prev) => {
    if (prev !== undefined && next && next !== prev && props.payload.senders?.whatsapp) {
      loadWhatsappPreset(props.payload.senders.whatsapp);
    }
  },
);

const waConfigInvalid = computed(() => {
  const wa = props.payload.senders?.whatsapp;
  if (!wa?.enabled) return false;
  if (!String(wa.phone_number_id ?? '').trim()) return true;
  if (!String(wa.waba_id ?? '').trim()) return true;
  if (!waAccessToken.value.trim()) return true;
  const templateName = String(wa.template_name ?? '').trim().toLowerCase();
  return templateName === 'hello_world';
});

interface MetaTemplateRow {
  name: string;
  language: string;
  status: string;
  body_preview?: string;
  body_param_count: number;
  label: string;
  value: string;
}

const metaTemplates = ref<MetaTemplateRow[]>([]);
const metaTemplatesLoading = ref(false);
const metaTemplatesError = ref('');
const metaTemplatesLoaded = ref(false);
const pushingToMeta = ref(false);
const pushToMetaMessage = ref('');

function waAuthHeaderRow(): ProviderField {
  const wa = props.payload.senders?.whatsapp as Record<string, unknown> | undefined;
  const headers = (wa?.headers ?? []) as ProviderField[];
  let row = headers.find((h) => h.key?.toLowerCase() === 'authorization');
  if (!row) {
    row = { key: 'Authorization', value: 'Bearer ', secret: false };
    headers.push(row);
    if (wa) wa.headers = headers;
  }
  return row;
}

const waAccessToken = computed({
  get() {
    const val = waAuthHeaderRow().value ?? '';
    return val.replace(/^Bearer\s*/i, '');
  },
  set(raw: string) {
    const row = waAuthHeaderRow();
    row.key = 'Authorization';
    row.secret = false;
    const trimmed = raw.trim().replace(/^Bearer\s*/i, '');
    row.value = trimmed ? `Bearer ${trimmed}` : 'Bearer ';
    metaTemplatesLoaded.value = false;
  },
});

const approvedMetaTemplateItems = computed(() =>
  metaTemplates.value
    .filter((t) => t.status === 'APPROVED')
    .map((t) => ({ value: t.name, label: t.label, language: t.language })),
);

const metaTemplateItemsWithCustom = computed(() => {
  const items = [...approvedMetaTemplateItems.value];
  const current = String(props.payload.senders?.whatsapp?.template_name ?? '').trim();
  if (current && !items.some((i) => i.value === current)) {
    items.unshift({ value: current, label: `${current} (manual)`, language: '' });
  }
  return items;
});

interface DiscoveredWabaRow {
  id: string;
  name?: string;
  phone_number_ids: string[];
  source: string;
  label: string;
  value: string;
}

const discoveredWabas = ref<DiscoveredWabaRow[]>([]);
const discoveringWabas = ref(false);

const wabaSelectItems = computed(() => {
  const items = discoveredWabas.value.map((w) => ({
    value: w.id,
    label: w.label,
    phone_number_ids: w.phone_number_ids,
  }));
  const current = String(props.payload.senders?.whatsapp?.waba_id ?? '').trim();
  if (current && !items.some((i) => i.value === current)) {
    items.unshift({ value: current, label: `${current} (manual)`, phone_number_ids: [] });
  }
  return items;
});

function mapDiscoveredWabas(rows: Array<{ id: string; name?: string; phone_number_ids?: string[]; source?: string }>) {
  discoveredWabas.value = rows.map((w) => ({
    id: w.id,
    name: w.name,
    phone_number_ids: w.phone_number_ids ?? [],
    source: w.source ?? '',
    value: w.id,
    label: w.name
      ? `${w.name} — ${w.id}${w.phone_number_ids?.length ? ` (phone ${w.phone_number_ids.join(', ')})` : ''}`
      : `${w.id}${w.phone_number_ids?.length ? ` (phone ${w.phone_number_ids.join(', ')})` : ''}`,
  }));
}

function applyDiscoveredWaba(wabaId: string) {
  if (!props.payload.senders?.whatsapp) return;
  props.payload.senders.whatsapp.waba_id = wabaId;
  const row = discoveredWabas.value.find((w) => w.id === wabaId);
  if (row?.phone_number_ids.length === 1 && !String(props.payload.senders.whatsapp.phone_number_id ?? '').trim()) {
    props.payload.senders.whatsapp.phone_number_id = row.phone_number_ids[0];
  }
  metaTemplatesLoaded.value = false;
}

async function discoverWhatsAppAccounts() {
  const token = waAccessToken.value.trim();
  metaTemplatesError.value = '';
  if (!token) {
    metaTemplatesError.value = 'Enter access token first';
    return;
  }
  discoveringWabas.value = true;
  try {
    const res = await api<{ accounts: Array<{ id: string; name?: string; phone_number_ids: string[]; source: string }> }>(
      '/api/v1/config/whatsapp/discover-accounts',
      { method: 'POST', body: { token: `Bearer ${token}` } },
    );
    mapDiscoveredWabas(res.accounts ?? []);
    if (res.accounts?.length === 1) {
      applyDiscoveredWaba(res.accounts[0]!.id);
    }
    if (!res.accounts?.length) {
      metaTemplatesError.value =
        'No WhatsApp Business accounts found. Regenerate the token with whatsapp_business_management permission in Meta → Business settings → System users.';
    }
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; statusMessage?: string; message?: string };
    metaTemplatesError.value =
      e.data?.message ?? e.statusMessage ?? e.message ?? 'Failed to discover WhatsApp accounts';
  } finally {
    discoveringWabas.value = false;
  }
}

async function loadMetaTemplates() {
  const wa = props.payload.senders?.whatsapp;
  if (!wa) return;
  const phone_number_id = String(wa.phone_number_id ?? '').trim();
  const waba_id = String(wa.waba_id ?? '').trim();
  const token = waAccessToken.value.trim();
  metaTemplatesError.value = '';
  if (!token) {
    metaTemplatesError.value = 'Enter access token first';
    return;
  }
  if (!waba_id && !phone_number_id) {
    metaTemplatesError.value = 'Enter WABA ID or phone number ID (or click Discover accounts)';
    return;
  }
  metaTemplatesLoading.value = true;
  try {
    const res = await api<{
      waba_id: string;
      discovered_wabas?: Array<{ id: string; name?: string; phone_number_ids: string[]; source: string }>;
      templates: Array<{
        name: string;
        language: string;
        status: string;
        body_preview?: string;
        body_param_count: number;
      }>;
    }>('/api/v1/config/whatsapp/meta-templates', {
      method: 'POST',
      body: {
        phone_number_id: phone_number_id || undefined,
        waba_id: waba_id || undefined,
        token: `Bearer ${token}`,
      },
    });
    if (res.waba_id) props.payload.senders.whatsapp.waba_id = res.waba_id;
    if (res.discovered_wabas?.length) mapDiscoveredWabas(res.discovered_wabas);
    metaTemplates.value = (res.templates ?? []).map((t) => ({
      ...t,
      value: t.name,
      label:
        t.status === 'APPROVED'
          ? `${t.name} (${t.language})`
          : `${t.name} (${t.language}) — ${t.status}`,
    }));
    metaTemplatesLoaded.value = true;
  } catch (err: unknown) {
    const e = err as {
      data?: {
        message?: string;
        discovered_wabas?: Array<{ id: string; name?: string; phone_number_ids: string[]; source: string }>;
      };
      statusMessage?: string;
      message?: string;
    };
    metaTemplatesError.value =
      e.data?.message ?? e.statusMessage ?? e.message ?? 'Failed to load templates from Meta';
    if (e.data?.discovered_wabas?.length) mapDiscoveredWabas(e.data.discovered_wabas);
    metaTemplates.value = [];
    metaTemplatesLoaded.value = false;
  } finally {
    metaTemplatesLoading.value = false;
  }
}

function applyDefaultMetaTemplate(name: string) {
  if (!props.payload.senders?.whatsapp) return;
  props.payload.senders.whatsapp.template_name = name;
  const row = metaTemplates.value.find((t) => t.name === name);
  if (row?.language) props.payload.senders.whatsapp.template_language = row.language;
}

function applyWaMetaTemplate(tpl: Record<string, unknown>, locale: string, name: string) {
  const variant = getVariant(tpl, locale, 'whatsapp');
  variant.wa_template_name = name;
  const row = metaTemplates.value.find((t) => t.name === name);
  if (row?.language) variant.wa_template_language = row.language;
}

function waTemplateItemsForVariant(variant: Record<string, unknown>) {
  const current = String(variant.wa_template_name ?? '').trim();
  const items = [...approvedMetaTemplateItems.value];
  if (current && !items.some((i) => i.value === current)) {
    items.unshift({ value: current, label: `${current} (manual)`, language: '' });
  }
  return items;
}

const DEFAULT_WA_BY_TEMPLATE = (() => {
  const map = new Map<string, Record<string, Record<string, unknown>>>();
  for (const tpl of defaultNotificationPack().templates) {
    const byLoc: Record<string, Record<string, unknown>> = {};
    for (const [loc, channels] of Object.entries(tpl.variants)) {
      const wa = (channels as { whatsapp?: Record<string, unknown> }).whatsapp;
      if (wa?.body) byLoc[loc] = { ...wa };
    }
    if (Object.keys(byLoc).length) map.set(tpl.id, byLoc);
  }
  return map;
})();

const DEFAULT_WA_PARAM_KEYS = [
  'party.name',
  'case.reference',
  'tenant.name',
  'tracking.url',
] as const;

function normalizeMetaLanguage(lang: string): string {
  const t = lang.trim();
  if (!t || t === 'en') return 'en_US';
  if (/^[a-z]{2}_[A-Z]{2}$/.test(t)) return t;
  if (t === 'sw') return 'sw';
  return 'en_US';
}

function extractWaParamKeysFromBody(body: string): string[] {
  const re = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;
  const keys: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const k = m[1]!;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

function inferMetaTemplateName(templateId: string, variant?: Record<string, unknown>): string {
  const explicit = String(variant?.wa_template_name ?? '').trim().toLowerCase();
  if (explicit) return explicit;
  const def = DEFAULT_WA_BY_TEMPLATE.get(templateId);
  const fromDef = Object.values(def ?? {})
    .map((v) => String(v.wa_template_name ?? '').trim().toLowerCase())
    .find(Boolean);
  if (fromDef) return fromDef;
  return `kisip_${templateId.replace(/-/g, '_')}`;
}

function backfillWhatsAppMeta(tpl: Record<string, unknown>) {
  const id = String(tpl.id ?? '');
  const defaults = DEFAULT_WA_BY_TEMPLATE.get(id);
  const variants = (tpl.variants ??= {}) as Record<string, Record<string, Record<string, unknown>>>;
  const senderKeys = (props.payload.senders?.whatsapp?.template_body_param_keys as string[] | undefined) ?? [
    ...DEFAULT_WA_PARAM_KEYS,
  ];

  for (const loc of Object.keys(variants)) {
    const wa = variants[loc]?.whatsapp;
    if (!wa || !String(wa.body ?? '').trim()) continue;
    const def = defaults?.[loc];

    if (!String(wa.wa_template_name ?? '').trim()) {
      wa.wa_template_name = def?.wa_template_name ?? inferMetaTemplateName(id, wa);
    }
    if (!String(wa.wa_template_language ?? '').trim()) {
      wa.wa_template_language =
        def?.wa_template_language ?? props.payload.senders?.whatsapp?.template_language ?? 'en_US';
    }
    const keys = wa.wa_body_param_keys as string[] | undefined;
    if (!keys?.length) {
      wa.wa_body_param_keys = (def?.wa_body_param_keys as string[] | undefined)?.length
        ? [...(def.wa_body_param_keys as string[])]
        : [...senderKeys];
    }
  }
}

function diagnoseWhatsAppPushGaps(): string {
  const lines: string[] = [];
  for (const tpl of templates.value) {
    const id = String(tpl.id ?? '');
    for (const loc of Object.keys((tpl.variants as Record<string, unknown>) ?? {})) {
      const variant = (tpl.variants as Record<string, Record<string, Record<string, unknown>>>)?.[loc]?.whatsapp;
      if (!variant || !String(variant.body ?? '').trim()) continue;
      const issues: string[] = [];
      if (!inferMetaTemplateName(id, variant)) issues.push('Meta template name');
      if (!effectiveWaParamKeys(variant).length) issues.push('body parameters');
      if (issues.length) lines.push(`• ${id} (${loc}): missing ${issues.join(' and ')}`);
    }
  }
  if (lines.length === 0) {
    return 'No WhatsApp channel bodies found. Add WhatsApp to a template (or enable WhatsApp sender to mirror SMS).';
  }
  return `Could not build Meta payloads:\n${lines.join('\n')}`;
}

function whatsappPushItemsFromPayload(): Array<{
  name: string;
  language: string;
  body: string;
  param_keys: string[];
  source: string;
}> {
  for (const tpl of templates.value) backfillWhatsAppMeta(tpl);

  const items: Array<{
    name: string;
    language: string;
    body: string;
    param_keys: string[];
    source: string;
  }> = [];
  const seen = new Set<string>();

  for (const tpl of templates.value) {
    const templateId = String(tpl.id ?? '');
    if (!COMPLAINANT_WHATSAPP_TEMPLATE_ID_SET.has(templateId)) continue;

    const variants = (tpl.variants as Record<string, Record<string, Record<string, unknown>>>) ?? {};
    for (const loc of Object.keys(variants)) {
      const variant = (tpl.variants as Record<string, Record<string, Record<string, unknown>>>)?.[loc]?.whatsapp;
      if (!variant || !String(variant.body ?? '').trim()) continue;

      const name = inferMetaTemplateName(templateId, variant);
      const language = normalizeMetaLanguage(
        String(variant.wa_template_language ?? props.payload.senders?.whatsapp?.template_language ?? 'en_US'),
      );
      const dedupe = `${name}::${language}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      const param_keys = canonicalWaParamKeys(name, variant);
      if (!param_keys.length) continue;

      // Persist inferred Meta fields in the editor payload.
      variant.wa_template_name = name;
      if (!String(variant.wa_template_language ?? '').trim()) variant.wa_template_language = language;
      variant.wa_body_param_keys = [...param_keys];

      items.push({
        name,
        language,
        body: String(variant.body),
        param_keys,
        source: `${templateId} (${loc})`,
      });
    }
  }
  return items;
}

async function pushWhatsAppTemplatesToMeta(items: ReturnType<typeof whatsappPushItemsFromPayload>) {
  const wa = props.payload.senders?.whatsapp;
  const waba_id = String(wa?.waba_id ?? '').trim();
  const token = waAccessToken.value.trim();
  pushToMetaMessage.value = '';

  if (!token) {
    pushToMetaMessage.value = 'Enter WhatsApp access token in Sender identities first.';
    return;
  }
  if (!waba_id) {
    pushToMetaMessage.value = 'Set WABA ID in Sender identities (use Discover).';
    return;
  }
  if (items.length === 0) {
    pushToMetaMessage.value = diagnoseWhatsAppPushGaps();
    return;
  }

  pushingToMeta.value = true;
  try {
    const res = await api<{
      results: Array<{ name: string; language: string; status: string; skipped?: boolean; reason?: string; meta_body?: string }>;
    }>('/api/v1/config/whatsapp/push-templates', {
      method: 'POST',
      body: {
        waba_id,
        token: `Bearer ${token}`,
        templates: items.map(({ name, language, body, param_keys }) => ({
          name,
          language,
          body,
          param_keys,
          category: 'UTILITY',
        })),
      },
    });

    const lines = (res.results ?? []).map((r) => {
      if (r.skipped) return `${r.name} (${r.language}): skipped — ${r.reason ?? r.status}`;
      if (r.status === 'FAILED') return `${r.name} (${r.language}): failed — ${r.reason ?? 'unknown'}`;
      return `${r.name} (${r.language}): ${r.status}`;
    });
    pushToMetaMessage.value = lines.join('\n');
    await loadMetaTemplates();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; statusMessage?: string; message?: string };
    pushToMetaMessage.value =
      e.data?.message ?? e.statusMessage ?? e.message ?? 'Failed to push templates to Meta';
  } finally {
    pushingToMeta.value = false;
  }
}

function pushAllWhatsAppToMeta() {
  void pushWhatsAppTemplatesToMeta(whatsappPushItemsFromPayload());
}

function pushWhatsAppVariantToMeta(tpl: Record<string, unknown>, loc: string) {
  backfillWhatsAppMeta(tpl);
  const variant = (tpl.variants as Record<string, Record<string, Record<string, unknown>>>)?.[loc]?.whatsapp;
  if (!variant || !String(variant.body ?? '').trim()) {
    pushToMetaMessage.value = `No WhatsApp body on ${String(tpl.id)} (${loc}).`;
    return;
  }
  const name = inferMetaTemplateName(String(tpl.id ?? ''), variant);
  const language = normalizeMetaLanguage(
    String(variant.wa_template_language ?? props.payload.senders?.whatsapp?.template_language ?? 'en_US'),
  );
  const param_keys = canonicalWaParamKeys(name, variant);
  if (!param_keys.length) {
    pushToMetaMessage.value = `Set body parameters on ${String(tpl.id)} (${loc}) WhatsApp variant.`;
    return;
  }
  variant.wa_template_name = name;
  void pushWhatsAppTemplatesToMeta([
    {
      name,
      language,
      body: String(variant.body ?? ''),
      param_keys,
      source: `${String(tpl.id)} (${loc})`,
    },
  ]);
}

function metaStatusForTemplate(name: string | undefined, language: string | undefined): string | null {
  const n = String(name ?? '').trim();
  if (!n) return null;
  const lang = String(language ?? 'en_US').trim() || 'en_US';
  const row = metaTemplates.value.find((t) => t.name === n && t.language === lang);
  return row?.status ?? null;
}

watch(
  () => [
    senderExpanded.value.has('whatsapp'),
    waAccessToken.value,
    props.payload.senders?.whatsapp?.phone_number_id,
    props.payload.senders?.whatsapp?.waba_id,
  ],
  () => {
    if (!senderExpanded.value.has('whatsapp')) return;
    if (metaTemplatesLoaded.value || metaTemplatesLoading.value) return;
    const phone = String(props.payload.senders?.whatsapp?.phone_number_id ?? '').trim();
    const waba = String(props.payload.senders?.whatsapp?.waba_id ?? '').trim();
    if (waAccessToken.value.trim() && phone && waba) void loadMetaTemplates();
  },
);

function ensure() {
  const p = props.payload;
  if (!Array.isArray(p.templates) || p.templates.length === 0) {
    Object.assign(p, defaultNotificationPack());
  }
  p.rules ??= [];
  p.senders ??= { email: {}, sms: {}, whatsapp: {} };
  p.senders.email ??= {};
  p.senders.sms ??= {};
  p.senders.whatsapp ??= {};
  ensureSenderIdentity(p.senders.email, 'email');
  ensureSmsSender(p.senders.sms);
  ensureWhatsappSender(p.senders.whatsapp);
  p.quiet_hours ??= {
    enabled: false,
    timezone: 'Africa/Nairobi',
    start: '21:00',
    end: '07:00',
    except_emergency: true,
  };
  p.kill_switches ??= [];
  p.throttling ??= { dedupe_window_minutes: 60 };
  p.intake_alerts ??= { ...DEFAULT_INTAKE_ALERTS };
  p.intake_alerts.enabled ??= DEFAULT_INTAKE_ALERTS.enabled;
  p.intake_alerts.role ??= DEFAULT_INTAKE_ALERTS.role;
  p.intake_alerts.scope ??= DEFAULT_INTAKE_ALERTS.scope;
  p.intake_alerts.channels ??= [...DEFAULT_INTAKE_ALERTS.channels];
  p.intake_alerts.template ??= DEFAULT_INTAKE_ALERTS.template;
  p.status_change_alerts ??= { ...DEFAULT_STATUS_CHANGE_ALERTS };
  p.status_change_alerts.enabled ??= DEFAULT_STATUS_CHANGE_ALERTS.enabled;
  p.status_change_alerts.role ??= DEFAULT_STATUS_CHANGE_ALERTS.role;
  p.status_change_alerts.scope ??= DEFAULT_STATUS_CHANGE_ALERTS.scope;
  p.status_change_alerts.channels ??= [...DEFAULT_STATUS_CHANGE_ALERTS.channels];
  p.status_change_alerts.template ??= DEFAULT_STATUS_CHANGE_ALERTS.template;
  p.status_change_alerts.notify_complainant ??= DEFAULT_STATUS_CHANGE_ALERTS.notify_complainant;
  p.status_change_alerts.complainant_exclude_statuses ??= [...DEFAULT_STATUS_CHANGE_ALERTS.complainant_exclude_statuses];

  if (Array.isArray(p.templates)) {
    const ids = new Set(p.templates.map((t: { id: string }) => t.id));
    if (!ids.has(p.intake_alerts.template) && p.intake_alerts.template === CASE_INTAKE_ALERT_TEMPLATE.id) {
      p.templates.push(structuredClone(CASE_INTAKE_ALERT_TEMPLATE));
    }
    if (!ids.has(p.status_change_alerts.template) && p.status_change_alerts.template === CASE_STATUS_CHANGED_STAFF_TEMPLATE.id) {
      p.templates.push(structuredClone(CASE_STATUS_CHANGED_STAFF_TEMPLATE));
    }
  }

  for (const rule of p.rules) {
    rule.enabled ??= true;
    rule.to ??= [];
    rule.id ??= `rule-${Math.random().toString(36).slice(2, 8)}`;
  }
  for (const tpl of p.templates) {
    tpl.privacy_mode ??= 'standard';
    tpl.variants ??= {};
  }
  if (Array.isArray(p.templates) && p.templates.length > 0) {
    const pruned = stripEmptyTemplateVariants(p.templates as { variants: Record<string, unknown> }[]);
    p.templates.splice(0, p.templates.length, ...pruned);
    for (const tpl of p.templates) stripEmptyLocales(tpl as Record<string, unknown>);
  }
  syncWhatsappConfig(p);
}

/** When WhatsApp sender is enabled, mirror SMS party channels + template bodies. */
function syncWhatsappConfig(p: Record<string, unknown>) {
  const wa = p.senders?.whatsapp as Record<string, unknown> | undefined;
  if (!wa?.enabled) return;

  for (const rule of (p.rules as Record<string, unknown>[]) ?? []) {
    const ch = rule.channels;
    if (ch && typeof ch === 'object' && !Array.isArray(ch)) {
      const party = (ch as { party?: string[] }).party;
      if (party?.includes('sms') && !party.includes('whatsapp')) party.push('whatsapp');
    } else if (Array.isArray(ch) && ch.includes('sms') && !ch.includes('whatsapp')) {
      ch.push('whatsapp');
    }
  }

  for (const tpl of (p.templates as { id?: string; variants: Record<string, Record<string, { body?: string }>> }[]) ?? []) {
    const tplId = String(tpl.id ?? '');
    if (!COMPLAINANT_WHATSAPP_TEMPLATE_ID_SET.has(tplId)) continue;

    for (const loc of Object.keys(tpl.variants ?? {})) {
      const sms = tpl.variants[loc]?.sms;
      if (sms?.body?.trim() && !tpl.variants[loc]?.whatsapp?.body?.trim()) {
        const def = DEFAULT_WA_BY_TEMPLATE.get(String((tpl as { id?: string }).id ?? ''))?.[loc];
        tpl.variants[loc].whatsapp = def
          ? { ...def, body: String(def.body ?? sms.body) }
          : {
              body: sms.body,
              wa_template_language: 'en_US',
              wa_body_param_keys: [...DEFAULT_WA_PARAM_KEYS],
            };
      }
    }
  }
  for (const tpl of (p.templates as Record<string, unknown>[]) ?? []) {
    backfillWhatsAppMeta(tpl);
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const smsProvider = computed(() => String(props.payload.senders?.sms?.provider ?? 'advanta').toLowerCase());
const placeholderHint = PROVIDER_FIELD_PLACEHOLDERS.join(', ');
const rules = computed(() => props.payload.rules as Record<string, unknown>[]);
const templates = computed(() => props.payload.templates as Record<string, unknown>[]);
const templateIds = computed(() => templates.value.map((t) => String(t.id)).filter(Boolean));

function addRule() {
  props.payload.rules.push({
    id: `rule-${Date.now()}`,
    name: 'New rule',
    on: 'case.created',
    to: [{ party: 'complainant' }],
    channels: ['email'],
    template: templateIds.value[0] ?? 'case-registered',
    enabled: true,
  });
  expandedRule.value = props.payload.rules.length - 1;
}

function removeRule(i: number) {
  props.payload.rules.splice(i, 1);
}

function addRecipient(rule: Record<string, unknown>) {
  const to = rule.to as Record<string, string>[];
  to.push({ party: 'complainant' });
}

function removeRecipient(rule: Record<string, unknown>, i: number) {
  (rule.to as unknown[]).splice(i, 1);
}

function recipientKind(rec: Record<string, unknown>): string {
  if ('party' in rec) return 'party';
  if ('user' in rec) return 'user';
  if ('role' in rec) return 'role';
  if ('team' in rec) return 'team';
  return 'address';
}

function setRecipientKind(rec: Record<string, unknown>, kind: string) {
  for (const k of ['party', 'user', 'role', 'team', 'address']) delete rec[k];
  delete rec.scope;
  if (kind === 'party') rec.party = 'complainant';
  else if (kind === 'user') rec.user = 'assignee';
  else if (kind === 'role') {
    rec.role = roleNames.value[0] ?? 'grm_officer';
    rec.scope = 'case_unit';
  } else if (kind === 'team') rec.team = '';
  else rec.address = '';
}

function channelMode(rule: Record<string, unknown>): 'flat' | 'split' {
  const ch = rule.channels;
  return ch && typeof ch === 'object' && !Array.isArray(ch) ? 'split' : 'flat';
}

function setChannelMode(rule: Record<string, unknown>, mode: 'flat' | 'split') {
  if (mode === 'split') {
    rule.channels = { party: ['sms', 'email', 'whatsapp'], staff: ['email', 'in_app'] };
  } else {
    rule.channels = ['email'];
  }
}

function addTemplate() {
  const id = `template-${Date.now()}`;
  props.payload.templates.push({
    id,
    label: 'New template',
    privacy_mode: 'standard',
    variants: {
      en: {
        email: {
          subject: 'Notification — {{case.reference}}',
          body: 'Your grievance {{case.reference}} has been updated.\nTrack: {{tracking.url}}',
        },
      },
    },
  });
  expandedTemplate.value = props.payload.templates.length - 1;
}

function removeTemplate(i: number) {
  if (templates.value.length <= 1) return;
  props.payload.templates.splice(i, 1);
}

function addKillSwitch() {
  props.payload.kill_switches.push({
    channel: 'sms',
    scope: 'tenant',
    enabled: false,
    reason: 'Disabled by administrator',
  });
}

function loadDefaultPack() {
  Object.assign(props.payload, defaultNotificationPack());
  ensure();
}

const CHANNEL_LABELS: Record<string, string> = {
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
  in_app: 'In-app',
};

const CHANNEL_STARTERS: Record<string, { subject?: string; body: string; wa_template_name?: string; wa_template_language?: string; wa_body_param_keys?: string[] }> = {
  sms: { body: '{{tenant.name}}: update on {{case.reference}} — {{tracking.url}}' },
  whatsapp: {
    body: '{{tenant.name}}: update on {{case.reference}} — {{tracking.url}}',
    wa_template_language: 'en_US',
    wa_body_param_keys: ['party.name', 'case.reference', 'tenant.name', 'tracking.url'],
  },
  email: {
    subject: 'Update — {{case.reference}}',
    body: 'Your grievance {{case.reference}} has been updated.\nTrack: {{tracking.url}}',
  },
  in_app: { body: 'Update on {{case.reference}} ({{case.status_label}})' },
};

function hasChannel(tpl: Record<string, unknown>, locale: string, channel: string): boolean {
  const entry = (tpl.variants as Record<string, Record<string, { body?: string }>>)?.[locale]?.[channel];
  return !!entry?.body?.trim();
}

function configuredChannels(tpl: Record<string, unknown>, locale: string): string[] {
  return NOTIFICATION_CHANNELS.filter((c) => hasChannel(tpl, locale, c));
}

function stripEmptyLocales(tpl: Record<string, unknown>) {
  const variants = tpl.variants as Record<string, Record<string, unknown>> | undefined;
  if (!variants) return;
  for (const loc of Object.keys(variants)) {
    if (configuredChannels(tpl, loc).length === 0) delete variants[loc];
  }
}

function templateLocales(tpl: Record<string, unknown>): string[] {
  stripEmptyLocales(tpl);
  const keys = Object.keys((tpl.variants as Record<string, unknown>) ?? {});
  if (keys.length > 0) return keys;
  return [locales.value[0] ?? 'en'];
}

function getVariant(tpl: Record<string, unknown>, locale: string, channel: string) {
  return (tpl.variants as Record<string, Record<string, Record<string, unknown>>>)[locale][channel]!;
}

function countParamKeys(keys: string[] | undefined): number {
  return keys?.filter((k) => k.trim()).length ?? 0;
}

function metaTemplateByName(name: string | undefined): MetaTemplateRow | undefined {
  const n = String(name ?? '').trim();
  if (!n) return undefined;
  return metaTemplates.value.find((t) => t.name === n);
}

function waParamCountMismatch(
  templateName: string | undefined,
  paramKeys: string[] | undefined,
  fallbackKeys?: string[],
): string | null {
  const meta = metaTemplateByName(templateName);
  if (!meta?.body_param_count) return null;
  const configured = countParamKeys(paramKeys?.length ? paramKeys : fallbackKeys);
  if (configured !== meta.body_param_count) {
    return `Meta template "${meta.name}" expects ${meta.body_param_count} body parameter(s) ({{1}}…{{${meta.body_param_count}}}) but ${configured} configured — Meta error #132000.`;
  }
  return null;
}

function canonicalWaParamKeys(templateName: string, variant: Record<string, unknown>): string[] {
  const canonical = KISIP_META_WHATSAPP_TEMPLATES[templateName.trim().toLowerCase()];
  if (canonical) return [...canonical.param_keys];
  return effectiveWaParamKeys(variant);
}

function effectiveWaParamKeys(variant: Record<string, unknown>): string[] {
  const body = String(variant.body ?? '');
  const configured = (variant.wa_body_param_keys as string[] | undefined)?.filter(Boolean) ?? [];
  const extracted = extractWaParamKeysFromBody(body);
  if (!configured.length) {
    if (extracted.length) return extracted;
    return (props.payload.senders?.whatsapp?.template_body_param_keys as string[] | undefined) ?? [];
  }
  if (extracted.length > configured.length) return extracted;
  for (const k of extracted) {
    if (!configured.includes(k)) return extracted;
  }
  return configured;
}

function waParamKeysStr(variant: Record<string, unknown>): string {
  const keys = variant.wa_body_param_keys as string[] | undefined;
  return keys?.join(', ') ?? '';
}

function setWaParamKeys(variant: Record<string, unknown>, raw: string) {
  variant.wa_body_param_keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function senderParamKeysStr(sender: Record<string, unknown>): string {
  const keys = sender.template_body_param_keys as string[] | undefined;
  return keys?.join(', ') ?? '';
}

function setSenderParamKeys(sender: Record<string, unknown>, raw: string) {
  sender.template_body_param_keys = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function addChannel(tpl: Record<string, unknown>, locale: string, channel: string) {
  const variants = (tpl.variants ??= {}) as Record<string, Record<string, { subject?: string; body: string }>>;
  variants[locale] ??= {};
  variants[locale][channel] = { ...CHANNEL_STARTERS[channel] };
}

function removeChannel(tpl: Record<string, unknown>, locale: string, channel: string) {
  delete (tpl.variants as Record<string, Record<string, unknown>>)?.[locale]?.[channel];
  stripEmptyLocales(tpl);
}

function varToken(name: string) {
  return `{{${name}}}`;
}
</script>

<template>
  <div class="space-y-6">
    <section v-if="show('sec-intake-alerts')" id="sec-intake-alerts" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Intake alerts</h2>
        <p class="text-xs text-muted mt-0.5">
          When a grievance is submitted for a jurisdiction unit, notify staff in the designated role assigned to that unit.
          Officers must be assigned to the unit under Users (role × jurisdiction scope).
        </p>
      </div>

      <UCard>
        <div class="space-y-4">
          <UFormField
            label="Alert officers on new grievance"
            help="Complainant acknowledgement is separate (Rules). This controls staff alerts only."
          >
            <USwitch v-model="payload.intake_alerts.enabled" />
          </UFormField>

          <template v-if="payload.intake_alerts.enabled">
            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Officer role" help="Role from Org &amp; access (e.g. grm_officer).">
                <USelectMenu v-model="payload.intake_alerts.role" :items="roleNames" class="w-full" />
              </UFormField>
              <UFormField
                label="Jurisdiction scope"
                help="Case unit = officers at the grievance settlement only. Unit &amp; above includes parent counties."
              >
                <USelectMenu
                  v-model="payload.intake_alerts.scope"
                  :items="ROLE_SCOPES"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Channels">
                <USelectMenu
                  v-model="payload.intake_alerts.channels"
                  :items="CHANNEL_ITEMS.filter((c) => c.value !== 'whatsapp')"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Template">
                <USelectMenu v-model="payload.intake_alerts.template" :items="templateIds" class="w-full" />
              </UFormField>
            </div>
          </template>
        </div>
      </UCard>
    </section>

    <section v-if="show('sec-status-change-alerts')" id="sec-status-change-alerts" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Status change alerts</h2>
        <p class="text-xs text-muted mt-0.5">
          When an officer updates case status, notify jurisdiction staff and (optionally) the complainant.
        </p>
      </div>

      <UCard>
        <div class="space-y-4">
          <UFormField
            label="Alert jurisdiction officers on status change"
            help="Staff in the designated role at the case unit receive email/in-app alerts."
          >
            <USwitch v-model="payload.status_change_alerts.enabled" />
          </UFormField>

          <UFormField
            label="Notify complainant on status change"
            help="Uses the status-change-complainant rule template (SMS/email/WhatsApp per their intake preferences)."
          >
            <USwitch v-model="payload.status_change_alerts.notify_complainant" />
          </UFormField>

          <UFormField
            v-if="payload.status_change_alerts.notify_complainant"
            label="Skip complainant notice for statuses"
            help="Complainant is not notified when the case moves to these statuses (e.g. Rejected)."
          >
            <USelectMenu
              v-model="payload.status_change_alerts.complainant_exclude_statuses"
              :items="workflowStatusItems"
              value-key="value"
              label-key="label"
              multiple
              placeholder="Select statuses…"
              class="w-full"
            />
          </UFormField>

          <template v-if="payload.status_change_alerts.enabled">
            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Officer role">
                <USelectMenu v-model="payload.status_change_alerts.role" :items="roleNames" class="w-full" />
              </UFormField>
              <UFormField label="Jurisdiction scope">
                <USelectMenu
                  v-model="payload.status_change_alerts.scope"
                  :items="ROLE_SCOPES"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Staff channels">
                <USelectMenu
                  v-model="payload.status_change_alerts.channels"
                  :items="CHANNEL_ITEMS.filter((c) => c.value !== 'whatsapp')"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Staff template">
                <USelectMenu v-model="payload.status_change_alerts.template" :items="templateIds" class="w-full" />
              </UFormField>
            </div>
          </template>
        </div>
      </UCard>
    </section>

    <section v-if="show('sec-rules')" id="sec-rules" class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold">Notification rules</h2>
          <p class="text-xs text-muted mt-0.5">
            Event → recipients → template → channels. Conditions filter by status, sensitivity, category, etc.
          </p>
        </div>
        <UButton size="xs" variant="soft" icon="i-lucide-rotate-ccw" @click="loadDefaultPack">
          Reset to default pack
        </UButton>
      </div>

      <div class="space-y-2">
        <UCard
          v-for="(rule, ri) in rules"
          :key="String(rule.id)"
          :ui="{ body: expandedRule === ri ? 'p-3 sm:p-4' : 'hidden' }"
        >
          <template #header>
            <button
              type="button"
              class="flex items-center justify-between gap-2 w-full text-left"
              @click="expandedRule = expandedRule === ri ? null : ri"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UIcon
                  :name="expandedRule === ri ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-4 shrink-0 text-muted"
                />
                <span class="text-sm font-medium truncate">{{ rule.name || rule.on }}</span>
                <UBadge v-if="!rule.enabled" size="xs" color="neutral" variant="subtle">disabled</UBadge>
              </div>
              <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click.stop="removeRule(ri)" />
            </button>
          </template>
          <div v-if="expandedRule === ri" class="space-y-3">
            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Rule name">
                <UInput v-model="rule.name" class="w-full" />
              </UFormField>
              <UFormField label="On event">
                <USelectMenu v-model="rule.on" :items="EVENT_ITEMS" value-key="value" label-key="label" class="w-full" />
              </UFormField>
            </div>
            <div class="grid sm:grid-cols-2 gap-3">
              <UFormField label="Template">
                <USelectMenu v-model="rule.template" :items="templateIds" class="w-full" />
              </UFormField>
              <UFormField label="Privacy template" help="Used for non-standard sensitivity classes.">
                <USelectMenu
                  v-model="rule.privacy_template"
                  :items="[{ label: '(none)', value: '' }, ...templateIds.map((id) => ({ label: id, value: id }))]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>
            <label class="flex items-center gap-2 text-sm">
              <USwitch v-model="rule.enabled" size="sm" />
              Rule enabled
            </label>

            <div>
              <div class="text-xs font-medium text-muted mb-2">Recipients</div>
              <div class="space-y-2">
                <div
                  v-for="(rec, rci) in rule.to as Record<string, unknown>[]"
                  :key="rci"
                  class="flex flex-wrap items-center gap-2 p-2 rounded border border-default"
                >
                  <USelectMenu
                    :model-value="recipientKind(rec)"
                    :items="RECIPIENT_KINDS"
                    value-key="value"
                    label-key="label"
                    class="w-32"
                    @update:model-value="setRecipientKind(rec, $event as string)"
                  />
                  <USelectMenu
                    v-if="recipientKind(rec) === 'party'"
                    v-model="rec.party"
                    :items="PARTY_TARGETS"
                    value-key="value"
                    label-key="label"
                    class="w-40"
                  />
                  <USelectMenu
                    v-else-if="recipientKind(rec) === 'user'"
                    v-model="rec.user"
                    :items="USER_TARGETS"
                    value-key="value"
                    label-key="label"
                    class="w-40"
                  />
                  <template v-else-if="recipientKind(rec) === 'role'">
                    <USelectMenu v-model="rec.role" :items="roleNames" class="w-40" />
                    <USelectMenu
                      v-model="rec.scope"
                      :items="ROLE_SCOPES"
                      value-key="value"
                      label-key="label"
                      class="w-36"
                    />
                  </template>
                  <UInput
                    v-else-if="recipientKind(rec) === 'team'"
                    v-model="rec.team"
                    placeholder="Team id"
                    class="flex-1 min-w-32"
                  />
                  <UInput v-else v-model="rec.address" placeholder="email or phone" class="flex-1 min-w-32" />
                  <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="removeRecipient(rule, rci)" />
                </div>
                <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addRecipient(rule)">Add recipient</UButton>
              </div>
            </div>

            <div>
              <div class="text-xs font-medium text-muted mb-2">Channels</div>
              <div class="flex gap-2 mb-2">
                <UButton
                  size="xs"
                  :variant="channelMode(rule) === 'flat' ? 'solid' : 'outline'"
                  @click="setChannelMode(rule, 'flat')"
                >
                  Same for all
                </UButton>
                <UButton
                  size="xs"
                  :variant="channelMode(rule) === 'split' ? 'solid' : 'outline'"
                  @click="setChannelMode(rule, 'split')"
                >
                  Party / staff split
                </UButton>
              </div>
              <USelectMenu
                v-if="channelMode(rule) === 'flat'"
                v-model="rule.channels"
                :items="CHANNEL_ITEMS"
                value-key="value"
                label-key="label"
                multiple
                class="w-full max-w-md"
              />
              <div v-else class="grid sm:grid-cols-2 gap-3 max-w-xl">
                <UFormField label="Party channels">
                  <USelectMenu
                    v-model="(rule.channels as Record<string, string[]>).party"
                    :items="CHANNEL_ITEMS.filter((c) => c.value !== 'in_app')"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Staff channels">
                  <USelectMenu
                    v-model="(rule.channels as Record<string, string[]>).staff"
                    :items="CHANNEL_ITEMS"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                  />
                </UFormField>
              </div>
            </div>

            <UFormField label="Condition (JSON)" help="e.g. not_status: [Referred], sensitivity: standard">
              <textarea
                :value="JSON.stringify(rule.condition ?? {}, null, 2)"
                rows="3"
                class="w-full font-mono text-xs p-2 rounded border border-default bg-elevated/40"
                @change="(e) => { try { rule.condition = JSON.parse((e.target as HTMLTextAreaElement).value); } catch { /* keep */ } }"
              />
            </UFormField>
          </div>
        </UCard>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addRule">Add rule</UButton>
      </div>
    </section>

    <section v-if="show('sec-templates')" id="sec-templates" class="space-y-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold">Message templates</h2>
          <p class="text-xs text-muted mt-0.5 max-w-2xl">
            Per locale and channel — only configured variants are saved. For WhatsApp, use
            <strong>Push to Meta</strong> to submit templates from here (Meta reviews before they go live).
            Variables:
            <code v-for="v in TEMPLATE_VARIABLES.slice(0, 5)" :key="v" class="mx-0.5">{{ varToken(v) }}</code>
            …
          </p>
        </div>
        <UButton
          size="xs"
          variant="soft"
          icon="i-lucide-upload"
          :loading="pushingToMeta"
          @click="pushAllWhatsAppToMeta"
        >
          Push all WhatsApp to Meta
        </UButton>
      </div>

      <UAlert
        v-if="pushToMetaMessage"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Meta template push"
        class="whitespace-pre-wrap text-xs"
        :description="pushToMetaMessage"
      />

      <div class="space-y-2">
        <UCard
          v-for="(tpl, ti) in templates"
          :key="String(tpl.id)"
          :ui="{ body: expandedTemplate === ti ? 'p-3 sm:p-4' : 'hidden' }"
        >
          <template #header>
            <button
              type="button"
              class="flex items-center justify-between gap-2 w-full text-left"
              @click="expandedTemplate = expandedTemplate === ti ? null : ti"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UIcon
                  :name="expandedTemplate === ti ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-4 shrink-0 text-muted"
                />
                <span class="text-sm font-medium">{{ tpl.label || tpl.id }}</span>
                <UBadge size="xs" variant="subtle" :color="tpl.privacy_mode === 'privacy_safe' ? 'warning' : 'neutral'">
                  {{ tpl.privacy_mode }}
                </UBadge>
              </div>
              <UButton
                size="xs"
                variant="ghost"
                color="error"
                icon="i-lucide-trash-2"
                :disabled="templates.length <= 1"
                @click.stop="removeTemplate(ti)"
              />
            </button>
          </template>
          <div v-if="expandedTemplate === ti" class="space-y-4">
            <div class="grid sm:grid-cols-3 gap-3">
              <UFormField label="Template id">
                <UInput v-model="tpl.id" class="w-full font-mono" />
              </UFormField>
              <UFormField label="Label">
                <UInput v-model="tpl.label" class="w-full" />
              </UFormField>
              <UFormField label="Privacy mode">
                <USelectMenu
                  v-model="tpl.privacy_mode"
                  :items="[
                    { value: 'standard', label: 'Standard' },
                    { value: 'privacy_safe', label: 'Privacy-safe' },
                  ]"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div v-for="loc in templateLocales(tpl)" :key="loc" class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-semibold uppercase text-muted">{{ loc }}</span>
                <template v-for="ch in NOTIFICATION_CHANNELS" :key="ch">
                  <UButton
                    v-if="!hasChannel(tpl, loc, ch)"
                    size="xs"
                    variant="soft"
                    icon="i-lucide-plus"
                    @click="addChannel(tpl, loc, ch)"
                  >
                    {{ CHANNEL_LABELS[ch] }}
                  </UButton>
                </template>
              </div>
              <div v-if="configuredChannels(tpl, loc).length" class="grid gap-3">
                <div
                  v-for="ch in configuredChannels(tpl, loc)"
                  :key="ch"
                  class="p-2 rounded border border-default/60"
                >
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-medium">{{ CHANNEL_LABELS[ch] }}</span>
                    <UButton
                      size="xs"
                      variant="ghost"
                      color="error"
                      icon="i-lucide-x"
                      @click="removeChannel(tpl, loc, ch)"
                    />
                  </div>
                  <UInput
                    v-if="ch === 'email'"
                    v-model="getVariant(tpl, loc, ch).subject"
                    placeholder="Subject"
                    class="w-full mb-1 font-mono text-xs"
                  />
                  <textarea
                    v-model="getVariant(tpl, loc, ch).body"
                    rows="3"
                    class="w-full font-mono text-xs p-2 rounded border border-default bg-elevated/40"
                    :placeholder="`${ch} body — use {{case.reference}} etc.`"
                  />
                  <div v-if="ch === 'whatsapp'" class="mt-2 grid sm:grid-cols-2 gap-2">
                    <div class="sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <UBadge
                          v-if="metaStatusForTemplate(String(getVariant(tpl, loc, ch).wa_template_name ?? ''), String(getVariant(tpl, loc, ch).wa_template_language ?? ''))"
                          size="xs"
                          variant="subtle"
                          :color="metaStatusForTemplate(String(getVariant(tpl, loc, ch).wa_template_name ?? ''), String(getVariant(tpl, loc, ch).wa_template_language ?? '')) === 'APPROVED' ? 'success' : 'warning'"
                        >
                          Meta: {{ metaStatusForTemplate(String(getVariant(tpl, loc, ch).wa_template_name ?? ''), String(getVariant(tpl, loc, ch).wa_template_language ?? '')) }}
                        </UBadge>
                      </div>
                      <UButton
                        size="xs"
                        variant="soft"
                        icon="i-lucide-upload"
                        :loading="pushingToMeta"
                        @click="pushWhatsAppVariantToMeta(tpl, loc)"
                      >
                        Push to Meta
                      </UButton>
                    </div>
                    <UFormField label="Meta template" help="Approved template name in Meta Business Manager. Overrides sender default.">
                      <USelectMenu
                        v-if="approvedMetaTemplateItems.length"
                        :model-value="String(getVariant(tpl, loc, ch).wa_template_name ?? '')"
                        :items="waTemplateItemsForVariant(getVariant(tpl, loc, ch))"
                        value-key="value"
                        label-key="label"
                        searchable
                        class="w-full font-mono text-xs"
                        placeholder="Select Meta template…"
                        @update:model-value="applyWaMetaTemplate(tpl, loc, $event)"
                      />
                      <UInput
                        v-else
                        v-model="getVariant(tpl, loc, ch).wa_template_name"
                        class="w-full font-mono text-xs"
                        placeholder="kisip_case_registered"
                      />
                    </UFormField>
                    <UFormField label="Template language">
                      <UInput
                        v-model="getVariant(tpl, loc, ch).wa_template_language"
                        class="w-full font-mono text-xs"
                        placeholder="en_US"
                      />
                    </UFormField>
                    <UFormField
                      label="Body parameters"
                      help="Comma-separated {{var}} keys mapped to {{1}}, {{2}}, … in the Meta template body."
                      class="sm:col-span-2"
                    >
                      <UInput
                        :model-value="waParamKeysStr(getVariant(tpl, loc, ch))"
                        class="w-full font-mono text-xs"
                        placeholder="party.name, case.reference, tenant.name, tracking.url"
                        @update:model-value="setWaParamKeys(getVariant(tpl, loc, ch), $event)"
                      />
                      <p
                        v-if="waParamCountMismatch(
                          String(getVariant(tpl, loc, ch).wa_template_name ?? ''),
                          getVariant(tpl, loc, ch).wa_body_param_keys as string[] | undefined,
                          payload.senders.whatsapp.template_body_param_keys,
                        )"
                        class="text-xs text-error mt-1"
                      >
                        {{
                          waParamCountMismatch(
                            String(getVariant(tpl, loc, ch).wa_template_name ?? ''),
                            getVariant(tpl, loc, ch).wa_body_param_keys as string[] | undefined,
                            payload.senders.whatsapp.template_body_param_keys,
                          )
                        }}
                      </p>
                      <p
                        v-else-if="metaTemplateByName(String(getVariant(tpl, loc, ch).wa_template_name ?? ''))?.body_preview"
                        class="text-xs text-muted mt-1 font-mono whitespace-pre-wrap"
                      >
                        Meta body: {{ metaTemplateByName(String(getVariant(tpl, loc, ch).wa_template_name ?? ''))?.body_preview }}
                      </p>
                    </UFormField>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addTemplate">Add template</UButton>
      </div>
    </section>

    <section v-if="show('sec-senders')" id="sec-senders" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Sender identities</h2>
        <p class="text-xs text-muted mt-0.5">
          From-address, sender ID, and provider API credentials per outbound channel (spec 06 §2).
        </p>
      </div>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleSender('email')">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-mail" class="size-4 text-primary shrink-0" />
            <span class="text-sm font-medium">Email</span>
            <UBadge v-if="!payload.senders.email.enabled" size="sm" variant="subtle" color="neutral">Off</UBadge>
          </div>
          <div class="flex items-center gap-2 shrink-0" @click.stop>
            <USwitch v-model="payload.senders.email.enabled" size="sm" />
            <UIcon
              :name="senderExpanded.has('email') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted"
            />
          </div>
        </div>
        <div v-if="senderExpanded.has('email')" class="border-t border-default px-4 py-3 space-y-3">
        <div v-if="payload.senders.email.enabled" class="space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="From name">
              <UInput v-model="payload.senders.email.from_name" class="w-full" placeholder="GRM" />
            </UFormField>
            <UFormField label="From address">
              <UInput v-model="payload.senders.email.from_address" class="w-full" placeholder="grm@tenant.go.ke" />
            </UFormField>
            <UFormField label="Provider preset">
              <USelectMenu
                v-model="payload.senders.email.provider"
                :items="[...PROVIDER_PRESETS.email]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Request format">
              <USelectMenu
                v-model="payload.senders.email.request_format"
                :items="[
                  { value: 'json', label: 'JSON body' },
                  { value: 'form', label: 'Form-urlencoded' },
                ]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="API URL / SMTP host" help="POST endpoint or mail server hostname." class="sm:col-span-2">
              <UInput v-model="payload.senders.email.api_url" class="w-full" placeholder="smtp.example.com or https://…" />
            </UFormField>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request headers</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.email.headers)">
                Add header
              </UButton>
            </div>
            <div
              v-for="(row, hi) in payload.senders.email.headers"
              :key="`eh-${hi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Header name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.email.headers, hi)" />
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request body fields</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.email.fields)">
                Add field
              </UButton>
            </div>
            <p class="text-[11px] text-muted">Runtime placeholders: {{ placeholderHint }}</p>
            <div
              v-for="(row, fi) in payload.senders.email.fields"
              :key="`ef-${fi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Field name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.email.fields, fi)" />
            </div>
          </div>
        </div>
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleSender('sms')">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-message-square" class="size-4 text-primary shrink-0" />
            <span class="text-sm font-medium">SMS</span>
            <UBadge v-if="!payload.senders.sms.enabled" size="sm" variant="subtle" color="neutral">Off</UBadge>
          </div>
          <div class="flex items-center gap-2 shrink-0" @click.stop>
            <USwitch v-model="payload.senders.sms.enabled" size="sm" />
            <UIcon
              :name="senderExpanded.has('sms') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted"
            />
          </div>
        </div>
        <div v-if="senderExpanded.has('sms')" class="border-t border-default px-4 py-3 space-y-3">
        <div v-if="payload.senders.sms.enabled" class="space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Provider preset">
              <USelectMenu
                v-model="payload.senders.sms.provider"
                :items="[...PROVIDER_PRESETS.sms]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Request format">
              <USelectMenu
                v-model="payload.senders.sms.request_format"
                :items="[
                  { value: 'json', label: 'JSON body' },
                  { value: 'form', label: 'Form-urlencoded' },
                ]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Send URL" help="POST endpoint for single messages.">
              <UInput
                v-model="payload.senders.sms.api_url"
                class="w-full font-mono text-xs"
                :placeholder="ADVANTA_SMS_SENDOTP_URL"
              />
            </UFormField>
            <UFormField v-if="smsProvider === 'advanta'" label="Bulk URL" help="Optional bulk endpoint.">
              <UInput
                v-model="payload.senders.sms.bulk_api_url"
                class="w-full font-mono text-xs"
                :placeholder="ADVANTA_SMS_SENDBULK_URL"
              />
            </UFormField>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request headers</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.sms.headers)">
                Add header
              </UButton>
            </div>
            <div
              v-for="(row, hi) in payload.senders.sms.headers"
              :key="`sh-${hi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Header name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.sms.headers, hi)" />
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request body fields</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.sms.fields)">
                Add field
              </UButton>
            </div>
            <p class="text-[11px] text-muted">Runtime placeholders: {{ placeholderHint }}</p>
            <div
              v-for="(row, fi) in payload.senders.sms.fields"
              :key="`sf-${fi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Field name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.sms.fields, fi)" />
            </div>
          </div>
        </div>
        </div>
      </UCard>

      <UCard :ui="{ body: 'p-0' }">
        <div class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none" @click="toggleSender('whatsapp')">
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-message-circle" class="size-4 text-primary shrink-0" />
            <span class="text-sm font-medium">WhatsApp</span>
            <UBadge v-if="!payload.senders.whatsapp.enabled" size="sm" variant="subtle" color="neutral">Off</UBadge>
          </div>
          <div class="flex items-center gap-2 shrink-0" @click.stop>
            <USwitch v-model="payload.senders.whatsapp.enabled" size="sm" />
            <UIcon
              :name="senderExpanded.has('whatsapp') ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted"
            />
          </div>
        </div>
        <div v-if="senderExpanded.has('whatsapp')" class="border-t border-default px-4 py-3 space-y-3">
        <div v-if="payload.senders.whatsapp.enabled" class="space-y-3">
          <UAlert
            v-if="waConfigInvalid"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="WhatsApp not ready"
            description="Enter access token, phone number ID, and WhatsApp Business Account ID (WABA), then load templates."
          />
          <UAlert
            v-else-if="metaTemplatesError"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not load Meta templates"
          >
            <p class="text-sm whitespace-pre-wrap">{{ metaTemplatesError }}</p>
            <UButton
              v-if="waAccessToken"
              class="mt-2"
              size="xs"
              variant="soft"
              icon="i-lucide-search"
              :loading="discoveringWabas"
              @click="discoverWhatsAppAccounts"
            >
              Discover WhatsApp accounts
            </UButton>
          </UAlert>
          <UAlert
            v-else-if="metaTemplatesLoaded && approvedMetaTemplateItems.length === 0"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            title="No approved templates"
            description="Meta returned no APPROVED templates for this account. Create templates in Meta Business Manager first."
          />
          <UAlert
            v-else-if="metaTemplatesLoaded"
            color="success"
            variant="subtle"
            icon="i-lucide-check"
            :title="`${approvedMetaTemplateItems.length} approved template(s) loaded`"
            description="Pick a default template below or override per notification rule."
          />
          <UAlert
            v-else
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Meta message templates"
            description="Enter your access token, phone number ID, and WABA ID, then load templates from Meta. Business-initiated WhatsApp requires approved templates."
          />

          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Access token" help="Permanent token from Meta → WhatsApp → API Setup. Enter this first." class="sm:col-span-2" required>
              <PasswordInput
                v-model="waAccessToken"
                default-visible
                class="w-full font-mono text-xs"
                placeholder="EAAxxxx…"
                autocomplete="off"
              />
            </UFormField>
            <UFormField
              label="WhatsApp Business Account ID (WABA)"
              help="Not the Business Portfolio ID. Click Discover accounts after entering token — or find WABA ID in WhatsApp Manager → Account overview."
              class="sm:col-span-2"
              required
            >
              <div class="flex gap-2">
                <USelectMenu
                  v-if="wabaSelectItems.length"
                  :model-value="String(payload.senders.whatsapp.waba_id ?? '')"
                  :items="wabaSelectItems"
                  value-key="value"
                  label-key="label"
                  searchable
                  class="flex-1 font-mono text-xs"
                  placeholder="Select WABA account…"
                  @update:model-value="applyDiscoveredWaba"
                />
                <UInput
                  v-else
                  v-model="payload.senders.whatsapp.waba_id"
                  class="flex-1 font-mono text-xs"
                  placeholder="123456789012345"
                  @update:model-value="metaTemplatesLoaded = false"
                />
                <UButton
                  variant="soft"
                  icon="i-lucide-search"
                  :loading="discoveringWabas"
                  @click="discoverWhatsAppAccounts"
                >
                  Discover
                </UButton>
              </div>
            </UFormField>
            <UFormField label="Phone number ID" help="Numeric ID from Meta → WhatsApp → API Setup (not your +254 display number)." required>
              <UInput v-model="payload.senders.whatsapp.phone_number_id" class="w-full font-mono" placeholder="1150176101510853" />
            </UFormField>
            <UFormField label="Templates" help="Fetch approved templates using token, WABA ID, and phone number ID.">
              <UButton
                class="w-full justify-center"
                variant="soft"
                icon="i-lucide-refresh-cw"
                :loading="metaTemplatesLoading"
                @click="loadMetaTemplates"
              >
                Load templates from Meta
              </UButton>
            </UFormField>
            <UFormField label="Default Meta template" help="Fallback when a notification rule omits its own template name.">
              <USelectMenu
                v-if="metaTemplateItemsWithCustom.length"
                :model-value="String(payload.senders.whatsapp.template_name ?? '')"
                :items="metaTemplateItemsWithCustom"
                value-key="value"
                label-key="label"
                searchable
                class="w-full font-mono text-xs"
                placeholder="Select template…"
                @update:model-value="applyDefaultMetaTemplate"
              />
              <UInput
                v-else
                v-model="payload.senders.whatsapp.template_name"
                class="w-full font-mono"
                placeholder="kisip_case_registered"
              />
            </UFormField>
            <UFormField label="Default template language">
              <UInput v-model="payload.senders.whatsapp.template_language" class="w-full font-mono" placeholder="en_US" />
            </UFormField>
            <UFormField
              label="Default body parameters"
              help="Comma-separated {{var}} keys for the default template body."
              class="sm:col-span-2"
            >
              <UInput
                :model-value="senderParamKeysStr(payload.senders.whatsapp)"
                class="w-full font-mono text-xs"
                placeholder="party.name, case.reference, tenant.name, tracking.url"
                @update:model-value="setSenderParamKeys(payload.senders.whatsapp, $event)"
              />
              <p
                v-if="waParamCountMismatch(
                  String(payload.senders.whatsapp.template_name ?? ''),
                  payload.senders.whatsapp.template_body_param_keys,
                )"
                class="text-xs text-error mt-1"
              >
                {{
                  waParamCountMismatch(
                    String(payload.senders.whatsapp.template_name ?? ''),
                    payload.senders.whatsapp.template_body_param_keys,
                  )
                }}
              </p>
            </UFormField>
            <UFormField label="Display number" help="Business number shown to recipients (E.164).">
              <UInput v-model="payload.senders.whatsapp.display_number" class="w-full" placeholder="+254…" />
            </UFormField>
            <UFormField label="Provider preset">
              <USelectMenu
                v-model="payload.senders.whatsapp.provider"
                :items="[...PROVIDER_PRESETS.whatsapp]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Request format">
              <USelectMenu
                v-model="payload.senders.whatsapp.request_format"
                :items="[
                  { value: 'json', label: 'JSON body' },
                  { value: 'form', label: 'Form-urlencoded' },
                ]"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <UFormField label="API URL" help="Graph API or gateway URL." class="sm:col-span-2">
              <UInput v-model="payload.senders.whatsapp.api_url" class="w-full" placeholder="https://graph.facebook.com/v23.0/{{phone_number_id}}/messages" />
            </UFormField>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request headers</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.whatsapp.headers)">
                Add header
              </UButton>
            </div>
            <div
              v-for="(row, hi) in payload.senders.whatsapp.headers"
              v-show="row.key?.toLowerCase() !== 'authorization'"
              :key="`wh-${hi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Header name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.whatsapp.headers, hi)" />
            </div>
          </div>
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-muted">Request body fields</span>
              <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addProviderField(payload.senders.whatsapp.fields)">
                Add field
              </UButton>
            </div>
            <p class="text-[11px] text-muted">Runtime placeholders: {{ placeholderHint }}</p>
            <div
              v-for="(row, fi) in payload.senders.whatsapp.fields"
              :key="`wf-${fi}`"
              class="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
            >
              <UInput v-model="row.key" placeholder="Field name" class="font-mono text-xs" />
              <UInput
                v-model="row.value"
                :type="row.secret ? 'password' : 'text'"
                placeholder="Value or {{placeholder}}"
                class="font-mono text-xs"
              />
              <label class="flex items-center gap-1 text-xs whitespace-nowrap">
                <UCheckbox v-model="row.secret" />
                Secret
              </label>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeProviderField(payload.senders.whatsapp.fields, fi)" />
            </div>
          </div>
        </div>
        </div>
      </UCard>
    </section>

    <section v-if="show('sec-delivery')" id="sec-delivery" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Delivery policy</h2>
        <p class="text-xs text-muted mt-0.5">Quiet hours, kill switches, and throttling (spec 06 §2).</p>
      </div>

      <UCard :ui="{ body: 'p-4 space-y-3' }">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">Quiet hours</span>
          <USwitch v-model="payload.quiet_hours.enabled" />
        </div>
        <div v-if="payload.quiet_hours.enabled" class="grid sm:grid-cols-2 gap-3">
          <UFormField label="Timezone">
            <UInput v-model="payload.quiet_hours.timezone" class="w-full" />
          </UFormField>
          <UFormField label="Start → end">
            <div class="flex gap-2">
              <UInput v-model="payload.quiet_hours.start" placeholder="21:00" class="w-full" />
              <UInput v-model="payload.quiet_hours.end" placeholder="07:00" class="w-full" />
            </div>
          </UFormField>
          <label class="flex items-center gap-2 text-sm sm:col-span-2">
            <USwitch v-model="payload.quiet_hours.except_emergency" size="sm" />
            Bypass quiet hours for emergency priority
          </label>
        </div>
      </UCard>

      <div>
        <div class="text-sm font-medium mb-2">Kill switches</div>
        <div class="space-y-2">
          <div
            v-for="(ks, ki) in payload.kill_switches"
            :key="ki"
            class="flex flex-wrap items-center gap-2 p-2 rounded border border-default"
          >
            <USelectMenu v-model="ks.channel" :items="CHANNEL_ITEMS" value-key="value" label-key="label" class="w-28" />
            <USelectMenu
              v-model="ks.scope"
              :items="[
                { value: 'tenant', label: 'Tenant' },
                { value: 'module', label: 'Module' },
              ]"
              value-key="value"
              label-key="label"
              class="w-28"
            />
            <UInput v-if="ks.scope === 'module'" v-model="ks.module" placeholder="module" class="w-32" />
            <label class="flex items-center gap-1.5 text-xs">
              <USwitch v-model="ks.enabled" size="sm" />
              {{ ks.enabled ? 'On' : 'Killed' }}
            </label>
            <UInput v-model="ks.reason" placeholder="Reason (logged)" class="flex-1 min-w-40" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="payload.kill_switches.splice(ki, 1)" />
          </div>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addKillSwitch">Add kill switch</UButton>
        </div>
      </div>

      <div class="grid sm:grid-cols-2 gap-3 max-w-xl">
        <UFormField
          label="Dedupe window (minutes)"
          help="Same event + recipient + template within window → one message."
        >
          <UInput v-model.number="payload.throttling.dedupe_window_minutes" type="number" min="0" class="w-full" />
        </UFormField>
        <UFormField label="Daily cap per recipient" help="Optional; 0 = unlimited.">
          <UInput v-model.number="payload.throttling.daily_cap_per_recipient" type="number" min="0" class="w-full" />
        </UFormField>
      </div>
    </section>
  </div>
</template>
