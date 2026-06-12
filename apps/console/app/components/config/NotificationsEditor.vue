<script setup lang="ts">
/**
 * CD-09 Notifications: declarative rules, templates, senders, delivery policy (spec 06).
 */
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_CHANNELS,
  TEMPLATE_VARIABLES,
  defaultNotificationPack,
} from '@egrm/config-schemas';

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

function ensure() {
  const p = props.payload;
  if (!Array.isArray(p.templates) || p.templates.length === 0) {
    Object.assign(p, defaultNotificationPack());
  }
  p.rules ??= [];
  p.senders ??= { email: {}, sms: {} };
  p.senders.email ??= {};
  p.senders.sms ??= {};
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
    for (const loc of locales.value) {
      tpl.variants[loc] ??= {};
    }
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

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
    rule.channels = { party: ['sms', 'email'], staff: ['email', 'in_app'] };
  } else {
    rule.channels = ['email'];
  }
}

function addTemplate() {
  const id = `template-${Date.now()}`;
  const variants: Record<string, Record<string, { body: string }>> = {};
  for (const loc of locales.value) variants[loc] = { email: { body: 'Hello {{case.reference}}' } };
  props.payload.templates.push({
    id,
    label: 'New template',
    privacy_mode: 'standard',
    variants,
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

function templateVariant(tpl: Record<string, unknown>, locale: string, channel: string) {
  const variants = tpl.variants as Record<string, Record<string, { subject?: string; body?: string }>>;
  variants[locale] ??= {};
  variants[locale][channel] ??= { body: '' };
  return variants[locale][channel]!;
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
          :ui="{ body: expandedRule === ri ? 'p-3 sm:p-4' : 'p-0' }"
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
          Per locale and channel. Variables:
          <code v-for="v in TEMPLATE_VARIABLES.slice(0, 5)" :key="v" class="mx-0.5">{{ varToken(v) }}</code>
          …
        </p>
      </div>

      <div class="space-y-2">
        <UCard
          v-for="(tpl, ti) in templates"
          :key="String(tpl.id)"
          :ui="{ body: expandedTemplate === ti ? 'p-3 sm:p-4' : 'p-0' }"
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
            <div v-for="loc in locales" :key="loc" class="space-y-2">
              <div class="text-xs font-semibold uppercase text-muted">{{ loc }}</div>
              <div class="grid gap-3">
                <div v-for="ch in NOTIFICATION_CHANNELS" :key="ch" class="p-2 rounded border border-default/60">
                  <div class="text-xs font-medium mb-1">{{ ch === 'in_app' ? 'In-app' : ch.toUpperCase() }}</div>
                  <UInput
                    v-if="ch === 'email'"
                    v-model="templateVariant(tpl, loc, ch).subject"
                    placeholder="Subject"
                    class="w-full mb-1 font-mono text-xs"
                  />
                  <textarea
                    v-model="templateVariant(tpl, loc, ch).body"
                    rows="2"
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
        <p class="text-xs text-muted mt-0.5">From-address and SMS sender ID shown to recipients.</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-4 max-w-2xl">
        <UFormField label="Email from name">
          <UInput v-model="payload.senders.email.from_name" class="w-full" placeholder="GRM" />
        </UFormField>
        <UFormField label="Email from address">
          <UInput v-model="payload.senders.email.from_address" class="w-full" placeholder="grm@tenant.go.ke" />
        </UFormField>
        <UFormField label="SMS sender ID">
          <UInput v-model="payload.senders.sms.sender_id" class="w-full" placeholder="KISIP" />
        </UFormField>
        <UFormField label="SMS provider profile">
          <UInput v-model="payload.senders.sms.provider" class="w-full" placeholder="advanta" />
        </UFormField>
      </div>
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
