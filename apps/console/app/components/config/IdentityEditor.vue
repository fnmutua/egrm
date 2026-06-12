<script setup lang="ts">
/**
 * Dedicated form for CD-01 Identity & branding, covering the full landing page:
 * identity, locales, colors/logos, mandatory statements, hero, how-it-works,
 * channels, about, FAQ, and footer. Mutates the payload object in place.
 * When `section` is set, only that panel is shown (sidebar-driven navigation).
 */
const props = defineProps<{ payload: Record<string, any>; section?: string }>();

const show = (id: string) => !props.section || props.section === id;

const STATEMENTS = [
  { key: 'free_of_charge', label: 'Free of charge', hint: 'Shown on the portal: submitting a grievance costs nothing.' },
  { key: 'non_retaliation', label: 'Non-retaliation', hint: 'No reprisals for submitting a grievance in good faith.' },
  { key: 'confidentiality', label: 'Confidentiality', hint: 'How complainant information is protected.' },
] as const;

function localized(): Record<string, string> {
  const o: Record<string, string> = {};
  for (const loc of props.payload.locales?.enabled ?? ['en']) o[loc] = '';
  return o;
}

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
  p.branding.partner_logos ??= [];
  p.statements ??= {};
  for (const s of STATEMENTS) p.statements[s.key] ??= {};
  p.hero ??= { title: {}, subtitle: {} };
  p.hero.title ??= {};
  p.hero.subtitle ??= {};
  p.how_it_works ??= [];
  p.channels_display ??= { offices: [] };
  p.channels_display.offices ??= [];
  p.about ??= { heading: {}, body: {} };
  p.about.heading ??= {};
  p.about.body ??= {};
  p.faq ??= [];
  p.footer ??= { privacy_note: {} };
  p.footer.privacy_note ??= {};

  for (const loc of p.locales.enabled) {
    for (const s of STATEMENTS) p.statements[s.key][loc] ??= '';
    p.hero.title[loc] ??= '';
    p.hero.subtitle[loc] ??= '';
    p.about.heading[loc] ??= '';
    p.about.body[loc] ??= '';
    p.footer.privacy_note[loc] ??= '';
    for (const step of p.how_it_works) {
      step.title ??= {};
      step.description ??= {};
      step.title[loc] ??= '';
      step.description[loc] ??= '';
    }
    for (const f of p.faq) {
      f.question ??= {};
      f.answer ??= {};
      f.question[loc] ??= '';
      f.answer[loc] ??= '';
    }
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

function addStep() {
  props.payload.how_it_works.push({ title: localized(), description: localized() });
}
function addFaq() {
  props.payload.faq.push({ question: localized(), answer: localized() });
}
function addPartnerLogo() {
  props.payload.branding.partner_logos.push({ name: '', image_url: '', link: '' });
}
function addOffice() {
  props.payload.channels_display.offices.push('');
}
function removeAt(arr: unknown[], i: number) {
  arr.splice(i, 1);
}
</script>

<template>
  <div class="space-y-8">
    <!-- Identity -->
    <section v-show="show('sec-identity')" id="sec-identity">
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
    </section>

    <!-- Locales -->
    <section v-show="show('sec-languages')" id="sec-languages">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Languages</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UFormField label="Default locale" required>
          <USelectMenu v-model="payload.locales.default" :items="enabledLocales" class="w-full" />
        </UFormField>
        <UFormField label="Enabled locales" required help="Comma-separated codes, e.g. en, sw">
          <UInput v-model="enabledLocalesText" class="w-full font-mono" />
        </UFormField>
      </div>
    </section>

    <!-- Branding -->
    <section v-show="show('sec-branding')" id="sec-branding">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Colors & logos</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        <UFormField label="Primary color" required>
          <div class="flex items-center gap-2">
            <input type="color" v-model="payload.branding.primary_color" class="h-9 w-12 rounded border border-default cursor-pointer bg-transparent" />
            <UInput v-model="payload.branding.primary_color" class="w-28 font-mono" />
          </div>
        </UFormField>
        <UFormField label="Accent color" help="Used for step numbers, icons, highlights.">
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
          <img v-if="payload.branding.logo_url" :src="payload.branding.logo_url" alt="Logo preview" class="mt-2 h-12 object-contain rounded border border-default p-1" />
        </UFormField>
      </div>
      <div class="mt-3 flex items-center gap-3">
        <span class="text-xs text-muted">Preview:</span>
        <div class="rounded-lg px-4 py-2 text-white text-sm font-medium" :style="{ backgroundColor: payload.branding.primary_color }">
          {{ payload.name || 'Portal header' }}
        </div>
        <div v-if="payload.branding.accent_color" class="rounded-lg px-3 py-2 text-white text-xs" :style="{ backgroundColor: payload.branding.accent_color }">
          Accent
        </div>
      </div>

      <UFormField label="Partner logos" help="Co-branding (implementing agency, donor) shown in the about section and footer." class="mt-4">
        <div class="space-y-2">
          <div v-for="(logo, i) in payload.branding.partner_logos" :key="i" class="flex items-center gap-2">
            <UInput v-model="logo.name" placeholder="Name" class="w-40" />
            <UInput v-model="logo.image_url" placeholder="Image URL" class="flex-1" />
            <UInput v-model="logo.link" placeholder="Link (optional)" class="w-44" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="removeAt(payload.branding.partner_logos, i)" />
          </div>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addPartnerLogo">Add partner logo</UButton>
        </div>
      </UFormField>
    </section>

    <!-- Hero -->
    <section v-show="show('sec-hero')" id="sec-hero">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-1">Landing page hero</h3>
      <p class="text-xs text-muted mb-3">The first thing visitors see. A generic headline is used if left empty.</p>
      <div class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UFormField v-for="loc in enabledLocales" :key="`ht-${loc}`" :label="`Title (${loc.toUpperCase()})`">
            <UInput v-model="payload.hero.title[loc]" class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UFormField v-for="loc in enabledLocales" :key="`hs-${loc}`" :label="`Subtitle (${loc.toUpperCase()})`">
            <UTextarea v-model="payload.hero.subtitle[loc]" :rows="2" autoresize class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Background image URL" help="Optional. A subtle tint of the primary color is used otherwise.">
          <UInput v-model="payload.hero.image_url" class="w-full" placeholder="https://…/hero.jpg" />
        </UFormField>
      </div>
    </section>

    <!-- How it works -->
    <section v-show="show('sec-how')" id="sec-how">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-1">How it works</h3>
      <p class="text-xs text-muted mb-3">Process steps shown in order. Keep day counts consistent with your SLA configuration.</p>
      <div class="space-y-3">
        <UCard v-for="(step, i) in payload.how_it_works" :key="i" :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-muted">Step {{ i + 1 }}</span>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeAt(payload.how_it_works, i)" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <UFormField v-for="loc in enabledLocales" :key="`st-${i}-${loc}`" :label="`Title (${loc.toUpperCase()})`">
              <UInput v-model="step.title[loc]" class="w-full" />
            </UFormField>
            <UFormField v-for="loc in enabledLocales" :key="`sd-${i}-${loc}`" :label="`Description (${loc.toUpperCase()})`">
              <UTextarea v-model="step.description[loc]" :rows="2" autoresize class="w-full" />
            </UFormField>
          </div>
        </UCard>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addStep">Add step</UButton>
      </div>
    </section>

    <!-- Channels -->
    <section v-show="show('sec-channels')" id="sec-channels">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-1">Other channels</h3>
      <p class="text-xs text-muted mb-3">Display-only: tells visitors the other ways to file a grievance.</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UFormField label="Hotline">
          <UInput v-model="payload.channels_display.hotline" class="w-full" placeholder="0800 …" />
        </UFormField>
        <UFormField label="USSD code">
          <UInput v-model="payload.channels_display.ussd_code" class="w-full" placeholder="*XXX#" />
        </UFormField>
        <UFormField label="Email">
          <UInput v-model="payload.channels_display.email" class="w-full" placeholder="grm@…" />
        </UFormField>
      </div>
      <UFormField label="Walk-in offices" class="mt-3">
        <div class="space-y-2">
          <div v-for="(_, i) in payload.channels_display.offices" :key="i" class="flex items-center gap-2">
            <UInput v-model="payload.channels_display.offices[i]" class="flex-1" />
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-x" @click="removeAt(payload.channels_display.offices, i)" />
          </div>
          <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addOffice">Add office</UButton>
        </div>
      </UFormField>
    </section>

    <!-- About -->
    <section v-show="show('sec-about')" id="sec-about">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">About section</h3>
      <div class="space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UFormField v-for="loc in enabledLocales" :key="`ah-${loc}`" :label="`Heading (${loc.toUpperCase()})`">
            <UInput v-model="payload.about.heading[loc]" class="w-full" />
          </UFormField>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UFormField v-for="loc in enabledLocales" :key="`ab-${loc}`" :label="`Body (${loc.toUpperCase()})`">
            <UTextarea v-model="payload.about.body[loc]" :rows="4" autoresize class="w-full" />
          </UFormField>
        </div>
      </div>
    </section>

    <!-- Mandatory statements -->
    <section v-show="show('sec-statements')" id="sec-statements">
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
    </section>

    <!-- FAQ -->
    <section v-show="show('sec-faq')" id="sec-faq">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-1">FAQ</h3>
      <p class="text-xs text-muted mb-3">Common questions shown on the landing page.</p>
      <div class="space-y-3">
        <UCard v-for="(f, i) in payload.faq" :key="i" :ui="{ body: 'p-4 sm:p-4' }">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-semibold text-muted">Question {{ i + 1 }}</span>
            <UButton size="xs" variant="ghost" color="error" icon="i-lucide-trash-2" @click="removeAt(payload.faq, i)" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <UFormField v-for="loc in enabledLocales" :key="`fq-${i}-${loc}`" :label="`Question (${loc.toUpperCase()})`">
              <UInput v-model="f.question[loc]" class="w-full" />
            </UFormField>
            <UFormField v-for="loc in enabledLocales" :key="`fa-${i}-${loc}`" :label="`Answer (${loc.toUpperCase()})`">
              <UTextarea v-model="f.answer[loc]" :rows="2" autoresize class="w-full" />
            </UFormField>
          </div>
        </UCard>
        <UButton size="xs" variant="soft" icon="i-lucide-plus" @click="addFaq">Add question</UButton>
      </div>
    </section>

    <!-- Footer -->
    <section v-show="show('sec-footer')" id="sec-footer">
      <h3 class="text-sm font-semibold text-muted uppercase tracking-wide mb-3">Footer & contact</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UFormField label="Address">
          <UInput v-model="payload.footer.address" class="w-full" />
        </UFormField>
        <UFormField label="Phone">
          <UInput v-model="payload.footer.phone" class="w-full" />
        </UFormField>
        <UFormField label="Email">
          <UInput v-model="payload.footer.email" class="w-full" />
        </UFormField>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <UFormField v-for="loc in enabledLocales" :key="`pn-${loc}`" :label="`Privacy note (${loc.toUpperCase()})`">
          <UTextarea v-model="payload.footer.privacy_note[loc]" :rows="2" autoresize class="w-full" />
        </UFormField>
      </div>
    </section>
  </div>
</template>
