<script setup lang="ts">
/**
 * CD-09 Notifications: declarative rules, templates, senders, delivery policy (spec 06).
 */
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  TEMPLATE_VARIABLES,
  defaultNotificationPack,
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
    const identity = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (identity.payload?.locales?.enabled?.length) locales.value = identity.payload.locales.enabled;
  } catch {
    /* optional */
  }
  await loadRoleNames();
  ensure();
});

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
  wa.mode ??= 'test';
  wa.template_name ??= 'hello_world';
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

watch(
  () => props.payload.senders?.whatsapp?.mode,
  (mode) => {
    const wa = props.payload.senders?.whatsapp;
    if (!wa) return;
    if (mode === 'test') {
      wa.template_name = 'hello_world';
      wa.template_language = 'en_US';
    }
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

  for (const tpl of (p.templates as { variants: Record<string, Record<string, { body?: string }>> }[]) ?? []) {
    for (const loc of Object.keys(tpl.variants ?? {})) {
      const sms = tpl.variants[loc]?.sms;
      if (sms?.body?.trim() && !tpl.variants[loc]?.whatsapp?.body?.trim()) {
        tpl.variants[loc].whatsapp = { body: sms.body };
      }
    }
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

const CHANNEL_STARTERS: Record<string, { subject?: string; body: string }> = {
  sms: { body: '{{tenant.name}}: update on {{case.reference}} — {{tracking.url}}' },
  whatsapp: { body: '{{tenant.name}}: update on {{case.reference}} — {{tracking.url}}' },
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
  return (tpl.variants as Record<string, Record<string, { subject?: string; body: string }>>)[locale][channel]!;
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
      <div>
        <h2 class="text-sm font-semibold">Message templates</h2>
        <p class="text-xs text-muted mt-0.5">
          Per locale and channel — only configured variants are saved. Add SMS, email, or in-app per language.
          Variables:
          <code v-for="v in TEMPLATE_VARIABLES.slice(0, 5)" :key="v" class="mx-0.5">{{ varToken(v) }}</code>
          …
        </p>
      </div>

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
            <UBadge
              v-else-if="payload.senders.whatsapp.mode === 'test'"
              size="sm"
              variant="subtle"
              color="warning"
            >
              Test
            </UBadge>
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
          <UFormField
            label="Environment"
            help="Test uses Meta sandbox (hello_world template; recipients must be on your sandbox To list). Live sends plain text via the Graph API URL below."
          >
            <USelectMenu
              v-model="payload.senders.whatsapp.mode"
              :items="[
                { value: 'test', label: 'Test (sandbox)' },
                { value: 'live', label: 'Live (production)' },
              ]"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UAlert
            v-if="payload.senders.whatsapp.mode === 'test'"
            color="warning"
            variant="subtle"
            icon="i-lucide-flask-conical"
            title="Sandbox mode"
            description="Sends hello_world only. Add each recipient number to Meta → WhatsApp → API Setup → To."
          />
          <div class="grid sm:grid-cols-2 gap-3">
            <UFormField label="Display number" help="Business number shown to recipients (E.164).">
              <UInput v-model="payload.senders.whatsapp.display_number" class="w-full" placeholder="+254…" />
            </UFormField>
            <UFormField label="Phone number ID" help="Numeric ID from Meta → WhatsApp → API Setup (not your +254 display number).">
              <UInput v-model="payload.senders.whatsapp.phone_number_id" class="w-full font-mono" placeholder="1107744639097239" />
            </UFormField>
            <UFormField
              label="Template name"
              :help="payload.senders.whatsapp.mode === 'test' ? 'Locked to hello_world in test mode.' : 'Meta-approved template name for business-initiated messages.'"
            >
              <UInput
                v-model="payload.senders.whatsapp.template_name"
                class="w-full font-mono"
                placeholder="hello_world"
                :disabled="payload.senders.whatsapp.mode === 'test'"
              />
            </UFormField>
            <UFormField label="Template language" :help="payload.senders.whatsapp.mode === 'test' ? 'Locked to en_US in test mode.' : undefined">
              <UInput
                v-model="payload.senders.whatsapp.template_language"
                class="w-full font-mono"
                placeholder="en_US"
                :disabled="payload.senders.whatsapp.mode === 'test'"
              />
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
