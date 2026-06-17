<script setup lang="ts">
/**
 * CD-16 Chatbot & AI (spec 16).
 */
import {
  AI_CAPABILITIES,
  AI_CAPABILITY_LABELS,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_PRESETS,
  CHATBOT_INTENTS,
  DEFAULT_CD16_AI,
  applyAiProviderPreset,
  type AiCapability,
  type AiProviderKind,
} from '@egrm/config-schemas';

const props = defineProps<{ payload: Record<string, any>; section?: string }>();
const { api } = useApi();
const toast = useToast();

const show = (id: string) => !props.section || props.section === id;
const locales = ref<string[]>(['en', 'sw']);

const providerKindItems = AI_PROVIDER_KINDS.map((k) => ({
  value: k,
  label: AI_PROVIDER_PRESETS[k].label,
}));

const capabilityItems = AI_CAPABILITIES.map((c) => ({
  value: c,
  label: AI_CAPABILITY_LABELS[c],
}));

const intentItems = CHATBOT_INTENTS.map((i) => ({
  value: i,
  label: i.replaceAll('_', ' '),
}));

const profileKeys = computed(() => Object.keys(props.payload.provider_profiles ?? {}));

const profileItems = computed(() =>
  profileKeys.value.map((k) => ({
    value: k,
    label: (props.payload.provider_profiles?.[k]?.label as string) || k,
  })),
);

onMounted(async () => {
  try {
    const res = await api<{ payload?: { locales?: { enabled?: string[] } } }>('/api/v1/config/cd01_identity');
    if (res.payload?.locales?.enabled?.length) locales.value = res.payload.locales.enabled;
  } catch {
    /* defaults */
  }
  ensure();
});

function deepMergeDefaults() {
  const base = structuredClone(DEFAULT_CD16_AI) as Record<string, unknown>;
  const p = props.payload;
  p.enabled ??= base.enabled;
  p.provider_profiles ??= base.provider_profiles;
  p.capabilities ??= base.capabilities;
  p.token_budget ??= base.token_budget;
  p.chatbot ??= base.chatbot;
  p.safety ??= base.safety;
  p.rag ??= base.rag;

  for (const cap of AI_CAPABILITIES) {
    p.capabilities[cap] = { ...(base.capabilities as Record<string, unknown>)[cap], ...(p.capabilities[cap] ?? {}) };
  }
}

function ensure() {
  deepMergeDefaults();
  for (const loc of locales.value) {
    props.payload.chatbot.automated_agent_disclosure[loc] ??=
      DEFAULT_CD16_AI.chatbot.automated_agent_disclosure.en ?? '';
  }
}

ensure();
watch(() => props.payload, ensure, { deep: false });

function addProfile() {
  const profiles = props.payload.provider_profiles as Record<string, Record<string, unknown>>;
  let id = 'openai_primary';
  let n = 1;
  while (profiles[id]) {
    id = `provider_${n++}`;
  }
  profiles[id] = {};
  applyAiProviderPreset(profiles[id], 'openai');
  profileExpanded.value = new Set([...profileExpanded.value, id]);
}

function removeProfile(key: string) {
  const profiles = props.payload.provider_profiles as Record<string, unknown>;
  delete profiles[key];
  profileExpanded.value.delete(key);
  profileExpanded.value = new Set(profileExpanded.value);
}

function onPresetChange(key: string, kind: AiProviderKind) {
  const profiles = props.payload.provider_profiles as Record<string, Record<string, unknown>>;
  applyAiProviderPreset(profiles[key], kind, { keepSecrets: true });
  delete profileModels.value[key];
  delete profileTest.value[key];
}

const profileTesting = ref<string | null>(null);
const profileTest = ref<Record<string, { ok?: boolean; latency_ms?: number; message?: string }>>({});
const profileModels = ref<Record<string, { chat: string[]; embedding: string[] }>>({});

function chatModelItems(key: string) {
  const list = profileModels.value[key]?.chat ?? [];
  const current = props.payload.provider_profiles[key].default_model as string;
  const items = list.map((m) => ({ value: m, label: m }));
  if (current && !list.includes(current)) {
    items.unshift({ value: current, label: `${current} (manual)` });
  }
  return items;
}

function embeddingModelItems(key: string) {
  const list = profileModels.value[key]?.embedding ?? [];
  const current = props.payload.provider_profiles[key].embedding_model as string | undefined;
  const items = list.map((m) => ({ value: m, label: m }));
  if (current && !list.includes(current)) {
    items.unshift({ value: current, label: `${current} (manual)` });
  }
  return items;
}

async function testProfile(key: string) {
  profileTesting.value = key;
  profileTest.value[key] = {};
  try {
    const res = await api<{
      ok: true;
      latency_ms: number;
      chat_models: string[];
      embedding_models: string[];
    }>('/api/v1/config/ai/test-profile', {
      method: 'POST',
      body: { profile: props.payload.provider_profiles[key] },
    });
    profileTest.value[key] = { ok: true, latency_ms: res.latency_ms };
    profileModels.value[key] = { chat: res.chat_models, embedding: res.embedding_models };

    const profile = props.payload.provider_profiles[key];
    if (res.chat_models.length && !res.chat_models.includes(profile.default_model)) {
      profile.default_model = res.chat_models[0];
    }
    if (res.embedding_models.length) {
      if (!profile.embedding_model || !res.embedding_models.includes(profile.embedding_model)) {
        profile.embedding_model = res.embedding_models[0];
      }
    }

    toast.add({
      title: 'Connection successful',
      description: `${res.chat_models.length} chat, ${res.embedding_models.length} embedding models loaded`,
      color: 'success',
    });
  } catch (e: unknown) {
    const data = (e as { data?: { message?: string; error?: string } })?.data;
    const message = data?.message ?? data?.error ?? 'Connection failed';
    profileTest.value[key] = { ok: false, message };
    delete profileModels.value[key];
    toast.add({ title: message, color: 'error' });
  } finally {
    profileTesting.value = null;
  }
}

function capability(key: AiCapability) {
  return props.payload.capabilities[key] as Record<string, unknown>;
}

const profileExpanded = ref(new Set<string>());

function toggleProfile(key: string) {
  if (profileExpanded.value.has(key)) profileExpanded.value.delete(key);
  else profileExpanded.value.add(key);
  profileExpanded.value = new Set(profileExpanded.value);
}

function providerIcon(kind: string): string {
  const icons: Record<string, string> = {
    openai: 'i-lucide-sparkles',
    xai: 'i-lucide-zap',
    azure_openai: 'i-lucide-cloud',
    anthropic: 'i-lucide-message-square',
    ollama: 'i-lucide-server',
    custom: 'i-lucide-settings',
  };
  return icons[kind] ?? 'i-lucide-bot';
}

watch(profileKeys, (keys) => {
  if (keys.length && profileExpanded.value.size === 0) {
    profileExpanded.value = new Set([keys[0]]);
  }
}, { immediate: true });
</script>

<template>
  <div class="space-y-6">
    <!-- Overview -->
    <section v-if="show('sec-overview')" class="space-y-4">
      <UAlert
        color="info"
        variant="subtle"
        title="Requires CD-14 feature flags"
        description="Turn on AI assistance and/or chatbot intake under Platform → Feature flags. API keys can use env:OPENAI_API_KEY / env:XAI_API_KEY in apps/api/.env."
      />
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-medium">AI master switch</p>
          <p class="text-sm text-muted">Enables provider calls when CD-14 flags are also on.</p>
        </div>
        <USwitch v-model="payload.enabled" />
      </div>

      <div class="grid sm:grid-cols-2 gap-4 pt-2 border-t border-default">
        <UFormField label="Monthly token limit" help="0 = unlimited. Input + output tokens combined.">
          <UInput v-model.number="payload.token_budget.monthly_token_limit" type="number" min="0" class="w-full" />
        </UFormField>
        <UFormField label="Daily token limit" help="0 = unlimited.">
          <UInput v-model.number="payload.token_budget.daily_token_limit" type="number" min="0" class="w-full" />
        </UFormField>
        <UFormField label="Alert at % of monthly" help="Notify admins via audit/dashboard when exceeded.">
          <UInput v-model.number="payload.token_budget.alert_threshold_percent" type="number" min="1" max="100" class="w-full" />
        </UFormField>
        <div class="flex items-end pb-1">
          <label class="flex items-center gap-2 text-sm">
            <UCheckbox v-model="payload.token_budget.hard_stop_at_limit" />
            Hard stop when monthly limit reached
          </label>
        </div>
      </div>
    </section>

    <!-- Providers -->
    <section v-if="show('sec-providers')" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted">OpenAI-compatible endpoints. Keys via <code class="text-xs">env:VAR</code> or inline secret (dev).</p>
        <UButton size="sm" icon="i-lucide-plus" variant="outline" @click="addProfile">Add profile</UButton>
      </div>

      <UCard v-for="key in profileKeys" :key="key" :ui="{ body: 'p-0' }">
        <div
          class="flex items-center justify-between gap-2 px-4 py-3 cursor-pointer select-none"
          @click="toggleProfile(key)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <UIcon
              :name="providerIcon(payload.provider_profiles[key].kind)"
              class="size-4 text-primary shrink-0"
            />
            <span class="text-sm font-medium truncate">{{ payload.provider_profiles[key].label || key }}</span>
            <span class="text-xs text-muted font-mono shrink-0">{{ key }}</span>
            <UBadge v-if="!payload.provider_profiles[key].enabled" size="sm" variant="subtle" color="neutral">Off</UBadge>
            <UBadge v-else-if="profileTest[key]?.ok" size="sm" variant="subtle" color="success">OK</UBadge>
          </div>
          <div class="flex items-center gap-2 shrink-0" @click.stop>
            <UButton
              v-if="profileKeys.length > 1"
              size="xs"
              color="error"
              variant="ghost"
              icon="i-lucide-trash"
              aria-label="Remove profile"
              @click="removeProfile(key)"
            />
            <USwitch v-model="payload.provider_profiles[key].enabled" size="sm" />
            <UIcon
              :name="profileExpanded.has(key) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4 text-muted"
            />
          </div>
        </div>

        <div v-if="profileExpanded.has(key)" class="border-t border-default px-4 py-3">
          <div class="flex flex-wrap items-center gap-2 mb-4">
            <UButton
              size="sm"
              icon="i-lucide-plug-zap"
              variant="outline"
              :loading="profileTesting === key"
              @click="testProfile(key)"
            >
              Test connection
            </UButton>
            <span v-if="profileTest[key]?.ok" class="text-sm text-success">
              Connected in {{ profileTest[key].latency_ms }}ms
              <template v-if="profileModels[key]">
                · {{ profileModels[key].chat.length }} chat,
                {{ profileModels[key].embedding.length }} embedding models
              </template>
            </span>
            <span v-else-if="profileTest[key]?.message" class="text-sm text-error">
              {{ profileTest[key].message }}
            </span>
            <span v-else class="text-xs text-muted">Fetches model list for dropdowns below</span>
          </div>

          <div class="grid sm:grid-cols-2 gap-4">
            <UFormField label="Provider preset">
              <USelectMenu
                :model-value="payload.provider_profiles[key].kind"
                :items="providerKindItems"
                value-key="value"
                label-key="label"
                class="w-full"
                @update:model-value="onPresetChange(key, $event as AiProviderKind)"
              />
            </UFormField>
            <UFormField label="Display label">
              <UInput v-model="payload.provider_profiles[key].label" class="w-full" />
            </UFormField>
            <UFormField label="Endpoint" class="sm:col-span-2">
              <UInput v-model="payload.provider_profiles[key].endpoint" class="w-full font-mono text-sm" />
            </UFormField>
            <UFormField label="API key env ref" help="e.g. env:OPENAI_API_KEY">
              <UInput v-model="payload.provider_profiles[key].api_key_ref" class="w-full font-mono text-sm" placeholder="env:OPENAI_API_KEY" />
            </UFormField>
            <UFormField label="API key (dev override)" help="Stored in config draft; prefer env in production.">
              <UInput v-model="payload.provider_profiles[key].api_key" type="password" class="w-full" autocomplete="off" />
            </UFormField>
            <UFormField label="Chat model" :help="chatModelItems(key).length ? 'From provider' : 'Test connection to load models'">
              <USelectMenu
                v-if="chatModelItems(key).length"
                v-model="payload.provider_profiles[key].default_model"
                :items="chatModelItems(key)"
                value-key="value"
                label-key="label"
                searchable
                class="w-full"
              />
              <UInput v-else v-model="payload.provider_profiles[key].default_model" class="w-full font-mono text-sm" />
            </UFormField>
            <UFormField label="Embedding model" help="For RAG / semantic dedupe. Test connection to load models.">
              <USelectMenu
                v-if="embeddingModelItems(key).length"
                v-model="payload.provider_profiles[key].embedding_model"
                :items="embeddingModelItems(key)"
                value-key="value"
                label-key="label"
                searchable
                class="w-full"
              />
              <UInput v-else v-model="payload.provider_profiles[key].embedding_model" class="w-full font-mono text-sm" />
            </UFormField>
            <UFormField label="Max output tokens">
              <UInput v-model.number="payload.provider_profiles[key].limits.max_output_tokens" type="number" class="w-full" />
            </UFormField>
            <UFormField label="Temperature">
              <UInput v-model.number="payload.provider_profiles[key].limits.temperature" type="number" step="0.1" min="0" max="2" class="w-full" />
            </UFormField>
            <UFormField label="Timeout (ms)">
              <UInput v-model.number="payload.provider_profiles[key].limits.timeout_ms" type="number" class="w-full" />
            </UFormField>
            <UFormField label="Data residency">
              <USelectMenu
                v-model="payload.provider_profiles[key].data_residency"
                :items="['us', 'eu', 'uk', 'apac', 'on_prem', 'unknown'].map((v) => ({ value: v, label: v }))"
                value-key="value"
                label-key="label"
                class="w-full"
              />
            </UFormField>
            <label class="flex items-center gap-2 text-sm sm:col-span-2">
              <UCheckbox v-model="payload.provider_profiles[key].no_training" />
              No training / no retention (contractual)
            </label>
          </div>
        </div>
      </UCard>
    </section>

    <!-- Capabilities -->
    <section v-if="show('sec-capabilities')" class="space-y-4">
      <p class="text-sm text-muted">Suggestions only — staff must accept before any case change (spec 16 §4).</p>
      <UCard v-for="cap in capabilityItems" :key="cap.value" :ui="{ body: 'space-y-3' }">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <span class="font-medium">{{ cap.label }}</span>
            <USwitch v-model="capability(cap.value).enabled" />
          </div>
        </template>
        <div v-if="capability(cap.value).enabled" class="grid sm:grid-cols-2 gap-3">
          <UFormField label="Provider profile">
            <USelectMenu
              v-model="capability(cap.value).profile"
              :items="profileItems"
              value-key="value"
              label-key="label"
              class="w-full"
            />
          </UFormField>
          <UFormField
            v-if="['auto_categorize', 'sensitivity_detect'].includes(cap.value)"
            label="Min confidence"
          >
            <UInput v-model.number="capability(cap.value).min_confidence" type="number" step="0.05" min="0" max="1" class="w-full" />
          </UFormField>
          <UFormField v-if="cap.value === 'semantic_dedupe'" label="Similarity threshold">
            <UInput v-model.number="capability(cap.value).similarity_threshold" type="number" step="0.05" min="0" max="1" class="w-full" />
          </UFormField>
          <UFormField v-if="cap.value === 'semantic_dedupe'" label="Lookback days">
            <UInput v-model.number="capability(cap.value).lookback_days" type="number" class="w-full" />
          </UFormField>
          <UFormField v-if="cap.value === 'kb_answer_assist'" label="Max citations">
            <UInput v-model.number="capability(cap.value).max_citations" type="number" class="w-full" />
          </UFormField>
        </div>
      </UCard>
    </section>

    <!-- Chatbot -->
    <section v-if="show('sec-chatbot')" class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="font-medium">Chatbot channel</p>
          <p class="text-sm text-muted">Also enable chatbot under CD-08 and CD-14.</p>
        </div>
        <USwitch v-model="payload.chatbot.enabled" />
      </div>
      <div v-if="payload.chatbot.enabled" class="grid sm:grid-cols-2 gap-4">
        <UFormField label="Provider profile">
          <USelectMenu v-model="payload.chatbot.profile" :items="profileItems" value-key="value" label-key="label" class="w-full" />
        </UFormField>
        <UFormField label="Assistant name">
          <UInput v-model="payload.chatbot.persona.name" class="w-full" />
        </UFormField>
        <UFormField label="Max output tokens (chat)">
          <UInput v-model.number="payload.chatbot.limits.max_output_tokens" type="number" class="w-full" />
        </UFormField>
        <UFormField label="Allowed intents" class="sm:col-span-2">
          <USelectMenu
            v-model="payload.chatbot.allowed_intents"
            :items="intentItems"
            value-key="value"
            label-key="label"
            multiple
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-for="loc in locales"
          :key="loc"
          :label="`Disclosure (${loc})`"
          class="sm:col-span-2"
          required
        >
          <UTextarea v-model="payload.chatbot.automated_agent_disclosure[loc]" :rows="2" class="w-full" />
        </UFormField>
      </div>
    </section>

    <!-- Safety -->
    <section v-if="show('sec-safety')" class="space-y-4">
      <UFormField label="PII fields stripped before provider calls">
        <UInput
          :model-value="(payload.safety.pii_redaction.strip_fields as string[]).join(', ')"
          class="w-full"
          @update:model-value="payload.safety.pii_redaction.strip_fields = String($event).split(',').map((s) => s.trim()).filter(Boolean)"
        />
      </UFormField>
      <label class="flex items-center gap-2 text-sm">
        <UCheckbox v-model="payload.safety.pii_redaction.pseudonymize_party" />
        Pseudonymize party identifiers in prompts
      </label>
      <label class="flex items-center gap-2 text-sm">
        <UCheckbox v-model="payload.safety.allow_machine_translation_outbound" />
        Allow machine translation on outbound complainant messages
      </label>
      <label class="flex items-center gap-2 text-sm">
        <UCheckbox v-model="payload.safety.moderation.enabled" />
        Content moderation on prompts
      </label>
    </section>

    <!-- RAG -->
    <section v-if="show('sec-rag')" class="space-y-4">
      <label class="flex items-center gap-2 text-sm">
        <UCheckbox v-model="payload.rag.reindex_on_publish" />
        Re-index knowledge articles on publish
      </label>
      <div class="grid sm:grid-cols-2 gap-4">
        <UFormField label="Chunk size (tokens)">
          <UInput v-model.number="payload.rag.chunk_size_tokens" type="number" class="w-full" />
        </UFormField>
        <UFormField label="Chunk overlap (tokens)">
          <UInput v-model.number="payload.rag.chunk_overlap_tokens" type="number" class="w-full" />
        </UFormField>
      </div>
    </section>
  </div>
</template>
