<script setup lang="ts">
/**
 * CD-08 Channels: public contact routes (portal "Other ways to reach us")
 * and per-channel module enablement.
 */
import type { PublicChannelEntry } from '@egrm/config-schemas';

const CHANNEL_TYPES = [
  { value: 'hotline', label: 'Hotline', icon: 'i-lucide-phone-call', placeholder: '0800 …' },
  { value: 'ussd', label: 'USSD', icon: 'i-lucide-smartphone', placeholder: '*XXX#' },
  { value: 'email', label: 'Email', icon: 'i-lucide-mail', placeholder: 'grm@…' },
  { value: 'office', label: 'Walk-in office', icon: 'i-lucide-building-2', placeholder: 'Office name / location' },
  { value: 'sms', label: 'SMS', icon: 'i-lucide-message-square', placeholder: 'Shortcode or number' },
] as const;

const ASSISTED_SOURCES = [
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone' },
  { value: 'letter', label: 'Letter' },
  { value: 'community_meeting', label: 'Community meeting' },
  { value: 'complaint_box', label: 'Complaint box' },
];

const props = defineProps<{ payload: Record<string, any>; section?: string }>();

const show = (id: string) => !props.section || props.section === id;

function ensure() {
  const p = props.payload;
  p.public_channels ??= [];
  for (const ch of p.public_channels as PublicChannelEntry[]) {
    ch.enabled ??= true;
    ch.show_on_portal ??= true;
  }
  p.modules ??= {};
  p.modules.web_portal ??= { enabled: true };
  p.modules.assisted ??= { enabled: true, source_channels: ['walk_in', 'phone', 'letter', 'community_meeting', 'complaint_box'] };
  p.modules.ussd ??= { enabled: false };
  p.modules.sms ??= { enabled: false };
  p.modules.email_inbound ??= { enabled: false };
  p.modules.hotline ??= { enabled: false };
  p.modules.mobile_app ??= { enabled: false, show_on_portal: true };
  p.modules.partner_api ??= { enabled: false };
  p.modules.chatbot ??= { enabled: false };
}

ensure();
watch(() => props.payload, ensure, { deep: false });

const publicChannels = computed(() => props.payload.public_channels as PublicChannelEntry[]);

const channelPlaceholder = (type: string) => CHANNEL_TYPES.find((c) => c.value === type)?.placeholder ?? '';

const channelIcon = (type: string) => CHANNEL_TYPES.find((c) => c.value === type)?.icon ?? 'i-lucide-radio';

function addChannel() {
  props.payload.public_channels.push({
    type: 'hotline',
    value: '',
    enabled: true,
    show_on_portal: true,
  });
}

function removeChannel(i: number) {
  props.payload.public_channels.splice(i, 1);
}

/** Portal display preview — same mapping as apps/portal/pages/index.vue */
const portalPreview = computed(() =>
  publicChannels.value
    .filter((ch) => ch.enabled && ch.show_on_portal && ch.value)
    .map((ch) => ({
      icon: channelIcon(ch.type),
      label: CHANNEL_TYPES.find((t) => t.value === ch.type)?.label ?? ch.type,
      value: ch.value,
    })),
);
</script>

<template>
  <div class="space-y-6">
    <!-- Public contact channels -->
    <section v-if="show('sec-public')" id="sec-public" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Other ways to reach us</h2>
        <p class="text-xs text-muted mt-0.5">
          Contact details shown on the public portal landing page — hotline, email, walk-in offices, USSD, etc.
          Matches the <b>Other ways to reach us</b> section complainants see.
        </p>
      </div>

      <div class="space-y-2">
        <div
          v-for="(ch, i) in publicChannels"
          :key="i"
          class="flex flex-wrap items-center gap-2 p-2 rounded-lg border border-default"
        >
          <UIcon :name="channelIcon(ch.type)" class="size-4 text-primary shrink-0" />
          <USelectMenu
            v-model="ch.type"
            :items="[...CHANNEL_TYPES]"
            value-key="value"
            label-key="label"
            class="w-36 shrink-0"
          />
          <UInput v-model="ch.value" class="flex-1 min-w-40" :placeholder="channelPlaceholder(ch.type)" />
          <div class="flex items-center gap-3 text-xs shrink-0">
            <label class="flex items-center gap-1.5">
              <USwitch v-model="ch.show_on_portal" size="sm" />
              Portal
            </label>
            <label class="flex items-center gap-1.5">
              <USwitch v-model="ch.enabled" size="sm" />
              Active
            </label>
          </div>
          <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="removeChannel(i)" />
        </div>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addChannel">Add contact route</UButton>
      </div>

      <UCard v-if="portalPreview.length" :ui="{ body: 'p-3 sm:p-4' }">
        <template #header>
          <span class="text-xs font-medium text-muted">Portal preview</span>
        </template>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div v-for="(c, pi) in portalPreview" :key="pi" class="flex items-start gap-2">
            <UIcon :name="c.icon" class="size-4 shrink-0 mt-0.5 text-primary" />
            <div>
              <div class="text-[11px] text-muted">{{ c.label }}</div>
              <div class="text-sm font-medium">{{ c.value }}</div>
            </div>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Intake modules -->
    <section v-if="show('sec-modules')" id="sec-modules" class="space-y-4">
      <div>
        <h2 class="text-sm font-semibold">Intake modules</h2>
        <p class="text-xs text-muted mt-0.5">
          Which intake routes are enabled for this tenant. Web portal and assisted intake are baseline; telecom channels activate when arrangements allow.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-3xl">
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Web portal</span>
            <p class="text-xs text-muted">Public submit &amp; track (this site)</p>
          </div>
          <USwitch v-model="payload.modules.web_portal.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Mobile app</span>
            <p class="text-xs text-muted">Native iOS / Android intake (same pipeline as web)</p>
          </div>
          <USwitch v-model="payload.modules.mobile_app.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Assisted intake</span>
            <p class="text-xs text-muted">Staff submit on behalf of complainants</p>
          </div>
          <USwitch v-model="payload.modules.assisted.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Hotline / IVR</span>
            <p class="text-xs text-muted">Operator-assisted phone intake</p>
          </div>
          <USwitch v-model="payload.modules.hotline.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Inbound email</span>
            <p class="text-xs text-muted">Monitored mailbox → triage queue</p>
          </div>
          <USwitch v-model="payload.modules.email_inbound.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">USSD</span>
            <p class="text-xs text-muted">Feature-phone menu intake</p>
          </div>
          <USwitch v-model="payload.modules.ussd.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">SMS intake</span>
            <p class="text-xs text-muted">Structured SMS → completion queue</p>
          </div>
          <USwitch v-model="payload.modules.sms.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Partner API</span>
            <p class="text-xs text-muted">System-to-system submissions</p>
          </div>
          <USwitch v-model="payload.modules.partner_api.enabled" />
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-lg border border-default text-sm">
          <div>
            <span class="font-medium">Chatbot</span>
            <p class="text-xs text-muted">Conversational intake (opt-in)</p>
          </div>
          <USwitch v-model="payload.modules.chatbot.enabled" />
        </div>
      </div>

      <UFormField
        v-if="payload.modules.assisted.enabled"
        label="Assisted source channels"
        help="Options staff choose when recording how the grievance was received."
        class="max-w-xl"
      >
        <USelectMenu
          v-model="payload.modules.assisted.source_channels"
          :items="ASSISTED_SOURCES"
          value-key="value"
          label-key="label"
          multiple
          class="w-full"
        />
      </UFormField>

      <UFormField v-if="payload.modules.ussd.enabled" label="USSD shortcode" class="max-w-xs">
        <UInput v-model="payload.modules.ussd.shortcode" class="font-mono w-full" placeholder="*384*123#" />
      </UFormField>

      <div v-if="payload.modules.mobile_app.enabled" class="space-y-3 max-w-xl">
        <label class="flex items-center gap-2 text-sm">
          <USwitch v-model="payload.modules.mobile_app.show_on_portal" size="sm" />
          Show download links on portal landing page
        </label>
        <UFormField label="App Store (iOS)" help="Full App Store URL for the grievance app.">
          <UInput v-model="payload.modules.mobile_app.ios_url" class="w-full" placeholder="https://apps.apple.com/…" />
        </UFormField>
        <UFormField label="Google Play (Android)" help="Full Play Store URL for the grievance app.">
          <UInput v-model="payload.modules.mobile_app.android_url" class="w-full" placeholder="https://play.google.com/store/apps/…" />
        </UFormField>
      </div>
    </section>
  </div>
</template>
