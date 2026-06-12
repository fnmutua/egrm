<script setup lang="ts">
/**
 * Dedicated form for CD-01 Identity & branding.
 * Mutates the payload object in place; the page owns save/activate.
 */
const props = defineProps<{ payload: Record<string, any> }>();

const STATEMENTS = [
  { key: 'free_of_charge', label: 'Free of charge', hint: 'Shown on the portal: submitting a grievance costs nothing.' },
  { key: 'non_retaliation', label: 'Non-retaliation', hint: 'No reprisals for submitting a grievance in good faith.' },
  { key: 'confidentiality', label: 'Confidentiality', hint: 'How complainant information is protected.' },
] as const;

// Ensure the expected structure exists so v-model bindings never hit undefined.
function ensure() {
  const p = props.payload;
  p.name ??= '';
  p.locales ??= {};
  p.locales.default ??= 'en';
  p.locales.enabled ??= ['en'];
  p.timezone ??= 'Africa/Nairobi';
  p.branding ??= {};
  p.branding.primary_color ??= '#0f3a5e';
  p.statements ??= {};
  for (const s of STATEMENTS) p.statements[s.key] ??= {};
  for (const s of STATEMENTS) {
    for (const loc of p.locales.enabled) p.statements[s.key][loc] ??= '';
  }
}
ensure();
watch(() => props.payload, ensure, { deep: false });

const enabledLocalesText = computed({
  get: () => (props.payload.locales?.enabled ?? []).join(', '),
  set: (v: string) => {
    props.payload.locales.enabled = v.split(',').map((s) => s.trim()).filter(Boolean);
    ensure();
  },
});

const enabledLocales = computed<string[]>(() => props.payload.locales?.enabled ?? []);
</script>

<template>
  <div class="space-y-6">
    <!-- Identity -->
    <div>
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Identity</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField label="Display name" required help="Shown in the portal header and notifications.">
          <UInput v-model="payload.name" class="w-full" />
        </UFormField>
        <UFormField label="Legal name">
          <UInput v-model="payload.legal_name" class="w-full" />
        </UFormField>
        <UFormField label="Programme">
          <UInput v-model="payload.programme" class="w-full" placeholder="e.g. Kenya Informal Settlements Improvement Project" />
        </UFormField>
        <UFormField label="Timezone">
          <UInput v-model="payload.timezone" class="w-full" placeholder="Africa/Nairobi" />
        </UFormField>
      </div>
    </div>

    <!-- Locales -->
    <div>
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Languages</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField label="Default locale" required>
          <USelectMenu
            v-model="payload.locales.default"
            :items="enabledLocales"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Enabled locales" required help="Comma-separated codes, e.g. en, sw">
          <UInput v-model="enabledLocalesText" class="w-full font-mono" />
        </UFormField>
      </div>
    </div>

    <!-- Branding -->
    <div>
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Branding</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <UFormField label="Primary color" required>
          <div class="flex items-center gap-2">
            <input
              type="color"
              v-model="payload.branding.primary_color"
              class="h-9 w-12 rounded border border-default cursor-pointer bg-transparent"
            />
            <UInput v-model="payload.branding.primary_color" class="w-28 font-mono" />
          </div>
        </UFormField>
        <UFormField label="Accent color">
          <div class="flex items-center gap-2">
            <input
              type="color"
              :value="payload.branding.accent_color ?? '#888888'"
              class="h-9 w-12 rounded border border-default cursor-pointer bg-transparent"
              @input="payload.branding.accent_color = ($event.target as HTMLInputElement).value"
            />
            <UInput v-model="payload.branding.accent_color" class="w-28 font-mono" placeholder="#rrggbb" />
          </div>
        </UFormField>
        <UFormField label="Logo URL">
          <UInput v-model="payload.branding.logo_url" class="w-full" placeholder="https://…/logo.png" />
          <img
            v-if="payload.branding.logo_url"
            :src="payload.branding.logo_url"
            alt="Logo preview"
            class="mt-2 h-12 object-contain rounded border border-default p-1"
          />
        </UFormField>
      </div>
      <!-- live swatch preview -->
      <div class="mt-3 flex items-center gap-3">
        <span class="text-xs text-muted">Preview:</span>
        <div
          class="rounded-lg px-4 py-2 text-white text-sm font-medium"
          :style="{ backgroundColor: payload.branding.primary_color }"
        >
          {{ payload.name || 'Portal header' }}
        </div>
        <div
          v-if="payload.branding.accent_color"
          class="rounded-lg px-3 py-2 text-white text-xs"
          :style="{ backgroundColor: payload.branding.accent_color }"
        >
          Accent
        </div>
      </div>
    </div>

    <!-- Mandatory statements -->
    <div>
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-1">Mandatory public statements</h3>
      <p class="text-xs text-muted mb-3">
        Required on the public portal in every enabled language. Validation blocks activation if any translation is missing.
      </p>
      <div class="space-y-4">
        <UCard v-for="s in STATEMENTS" :key="s.key" :ui="{ body: 'p-4 sm:p-4' }">
          <div class="font-medium text-sm mb-0.5">{{ s.label }}</div>
          <div class="text-xs text-muted mb-3">{{ s.hint }}</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <UFormField v-for="loc in enabledLocales" :key="loc" :label="loc.toUpperCase()">
              <UTextarea v-model="payload.statements[s.key][loc]" :rows="2" autoresize class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
