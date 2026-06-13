<script setup lang="ts">
/**
 * CD-17 Complainant correspondence (spec 15).
 */
import {
  DEFAULT_CORRESPONDENCE_POLICY,
  THREAD_DIRECTIONS,
  THREAD_MESSAGE_KINDS,
} from '@egrm/config-schemas';

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();

const show = (id: string) => !props.section || props.section === id;
const locales = ref<string[]>(['en', 'sw']);

const messageKindItems = THREAD_MESSAGE_KINDS.map((k) => ({
  value: k,
  label: k.replaceAll('_', ' '),
}));

const contactChannelItems = [
  { value: 'phone', label: 'Phone call' },
  { value: 'visit', label: 'Field visit' },
  { value: 'letter', label: 'Letter' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
];

onMounted(async () => {
  try {
    const res = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (res.payload?.locales?.enabled?.length) locales.value = res.payload.locales.enabled;
  } catch {
    /* defaults */
  }
  ensure();
});

function localizedText(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of locales.value) o[loc] = '';
  return o;
}

function ensure() {
  const p = props.payload;
  const base = DEFAULT_CORRESPONDENCE_POLICY;
  const pol = p.correspondence_policy ?? {};
  p.correspondence_policy = {
    ...base,
    ...pol,
    portal: { ...base.portal, ...(pol.portal ?? {}) },
    staff: { ...base.staff, ...(pol.staff ?? {}) },
    attachments: { ...base.attachments, ...(pol.attachments ?? {}) },
    sensitive: {
      ...base.sensitive,
      ...(pol.sensitive ?? {}),
      redacted_template: {
        ...base.sensitive.redacted_template,
        ...(pol.sensitive?.redacted_template ?? {}),
      },
    },
    workflow: { ...base.workflow, ...(pol.workflow ?? {}) },
    notify: { ...base.notify, ...(pol.notify ?? {}) },
  };
  for (const loc of locales.value) {
    p.correspondence_policy.sensitive.redacted_template[loc] ??=
      base.sensitive.redacted_template[loc as keyof typeof base.sensitive.redacted_template] ?? '';
  }
}

ensure();
watch(() => props.payload, ensure, { deep: false });

const policy = computed(() => props.payload.correspondence_policy as Record<string, any>);
const portal = computed(() => policy.value.portal as Record<string, any>);
const staff = computed(() => policy.value.staff as Record<string, any>);
const attachments = computed(() => policy.value.attachments as Record<string, any>);
const sensitive = computed(() => policy.value.sensitive as Record<string, any>);
const workflow = computed(() => policy.value.workflow as Record<string, any>);
const notify = computed(() => policy.value.notify as Record<string, any>);

const awaitingStatusesText = computed({
  get: () => (workflow.value.awaiting_status_names as string[] | undefined)?.join(', ') ?? '',
  set: (v: string) => {
    workflow.value.awaiting_status_names = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

const replyKindsText = computed({
  get: () => (attachments.value.reply_kind_codes as string[] | undefined)?.join(', ') ?? '',
  set: (v: string) => {
    attachments.value.reply_kind_codes = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

const staffKindsText = computed({
  get: () => (attachments.value.staff_kind_codes as string[] | undefined)?.join(', ') ?? '',
  set: (v: string) => {
    attachments.value.staff_kind_codes = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
</script>

<template>
  <div class="space-y-6">
    <section v-if="show('sec-overview')" id="sec-overview" class="space-y-4">
      <h2 class="text-sm font-semibold">Correspondence</h2>
      <p class="text-sm text-muted">
        Case thread for staff ↔ complainant messages, logged offline contact, and internal notes. Distinct from one-way
        notification templates (CD-09).
      </p>
      <UFormField label="Correspondence enabled">
        <USwitch v-model="policy.enabled" />
      </UFormField>
    </section>

    <section v-if="show('sec-portal')" id="sec-portal" class="space-y-4">
      <h2 class="text-sm font-semibold">Portal / complainant</h2>
      <UFormField label="Show on track portal">
        <USwitch v-model="portal.enabled" />
      </UFormField>
      <UFormField label="Allow complainant reply">
        <USwitch v-model="portal.allow_reply" />
      </UFormField>
      <UFormField label="Show messages on track page">
        <USwitch v-model="portal.show_messages_on_track" />
      </UFormField>
      <div class="grid sm:grid-cols-2 gap-4">
        <UFormField label="Max reply body length">
          <UInput v-model.number="portal.max_body_length" type="number" min="100" class="w-full" />
        </UFormField>
        <UFormField label="Max replies per day">
          <UInput v-model.number="portal.max_replies_per_day" type="number" min="1" class="w-full" />
        </UFormField>
      </div>
    </section>

    <section v-if="show('sec-staff')" id="sec-staff" class="space-y-4">
      <h2 class="text-sm font-semibold">Staff authoring</h2>
      <UFormField label="Allow outbound messages">
        <USwitch v-model="staff.allow_outbound" />
      </UFormField>
      <UFormField label="Allow logged offline contact">
        <USwitch v-model="staff.allow_logged_contact" />
      </UFormField>
      <UFormField label="Mirror status updates into thread">
        <USwitch v-model="staff.mirror_status_updates" />
      </UFormField>
      <div class="grid sm:grid-cols-2 gap-4">
        <UFormField label="Max staff message length">
          <UInput v-model.number="staff.max_body_length" type="number" min="100" class="w-full" />
        </UFormField>
        <UFormField label="Default outbound message kind">
          <USelectMenu
            v-model="staff.default_outbound_kind"
            :items="messageKindItems"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>
      </div>
      <p class="text-xs text-muted">
        Directions: {{ THREAD_DIRECTIONS.join(', ') }}. Kinds: {{ THREAD_MESSAGE_KINDS.join(', ') }}.
      </p>
    </section>

    <section v-if="show('sec-attachments')" id="sec-attachments" class="space-y-4">
      <h2 class="text-sm font-semibold">Attachments on messages</h2>
      <UFormField label="Staff outbound attachments">
        <USwitch v-model="attachments.staff_outbound_enabled" />
      </UFormField>
      <UFormField label="Complainant reply attachments">
        <USwitch v-model="attachments.complainant_reply_enabled" />
      </UFormField>
      <UFormField label="Max files per message">
        <UInput v-model.number="attachments.max_files_per_message" type="number" min="1" max="10" class="w-full max-w-xs" />
      </UFormField>
      <UFormField label="Reply kind codes (comma-separated)" help="Must match CD-06 document types with intake allowed.">
        <UInput v-model="replyKindsText" class="w-full" placeholder="evidence" />
      </UFormField>
      <UFormField label="Staff kind codes (comma-separated)">
        <UInput v-model="staffKindsText" class="w-full" placeholder="evidence, correspondence" />
      </UFormField>
    </section>

    <section v-if="show('sec-sensitive')" id="sec-sensitive" class="space-y-4">
      <h2 class="text-sm font-semibold">Sensitive cases</h2>
      <UFormField label="Redact outbound text for complainant">
        <USwitch v-model="sensitive.redact_outbound_for_party" />
      </UFormField>
      <div v-for="loc in locales" :key="loc" class="space-y-1">
        <UFormField :label="`Redacted template (${loc})`">
          <UTextarea
            v-model="sensitive.redacted_template[loc]"
            :rows="3"
            class="w-full"
            placeholder="Generic message shown instead of full body on track portal"
          />
        </UFormField>
      </div>
    </section>

    <section v-if="show('sec-workflow')" id="sec-workflow" class="space-y-4">
      <h2 class="text-sm font-semibold">Workflow integration</h2>
      <UFormField label="Inbound reply unpauses awaiting status">
        <USwitch v-model="workflow.inbound_reply_unpauses_awaiting" />
      </UFormField>
      <UFormField label="Awaiting status names (comma-separated)">
        <UInput v-model="awaitingStatusesText" class="w-full" placeholder="Awaiting information" />
      </UFormField>
      <UFormField label="Move to status on inbound reply (optional)" help="Leave empty to only unpause.">
        <UInput v-model="workflow.inbound_reply_to_status" class="w-full" placeholder="Under review" />
      </UFormField>
    </section>

    <section v-if="show('sec-notify')" id="sec-notify" class="space-y-4">
      <h2 class="text-sm font-semibold">Notification hooks</h2>
      <p class="text-sm text-muted">
        Pointer alerts via CD-09 rules (<code>thread.reply_external</code>, <code>thread.reply_inbound</code>). Full message
        body stays in the thread.
      </p>
      <UFormField label="Notify complainant on outbound message">
        <USwitch v-model="notify.on_outbound_message" />
      </UFormField>
      <UFormField label="Notify staff on inbound reply">
        <USwitch v-model="notify.on_inbound_reply" />
      </UFormField>
    </section>
  </div>
</template>
