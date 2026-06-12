<script setup lang="ts">
type L10n = Record<string, string>;

interface IdentityPayload {
  name: string;
  legal_name?: string;
  branding: {
    logo_url?: string;
    primary_color: string;
    accent_color?: string;
    partner_logos?: { name: string; image_url: string; link?: string }[];
  };
  locales: { default: string; enabled: string[] };
  statements: Record<string, L10n>;
  hero?: { title: L10n; subtitle?: L10n; image_url?: string };
  how_it_works?: { title: L10n; description?: L10n }[];
  channels_display?: { hotline?: string; ussd_code?: string; email?: string; offices?: string[] };
  about?: { heading?: L10n; body: L10n };
  faq?: { question: L10n; answer: L10n }[];
  footer?: { address?: string; phone?: string; email?: string; privacy_note?: L10n };
}

const config = useRuntimeConfig();

// Tenant branding & landing content come from the config registry (CD-01) — not from code.
const { data: identity } = await useFetch<{ payload: IdentityPayload }>('/api/v1/config/cd01_identity', {
  baseURL: config.public.apiBase,
  headers: { 'x-tenant': config.public.tenant },
});

const p = computed(() => identity.value?.payload);
const locales = computed(() => p.value?.locales.enabled ?? ['en']);
const locale = useCookie<string>('egrm_locale', { default: () => '' });
if (!locale.value || !locales.value.includes(locale.value)) {
  locale.value = p.value?.locales.default ?? 'en';
}

/** Resolve localized text: chosen locale → default locale → first available. */
function t(text: L10n | undefined): string {
  if (!text) return '';
  return text[locale.value] || text[p.value?.locales.default ?? 'en'] || Object.values(text)[0] || '';
}

const primary = computed(() => p.value?.branding.primary_color ?? '#0f3a5e');
const accent = computed(() => p.value?.branding.accent_color ?? primary.value);

const statementCards = computed(() => [
  { icon: 'i-lucide-badge-check', text: t(p.value?.statements.free_of_charge) },
  { icon: 'i-lucide-shield-check', text: t(p.value?.statements.non_retaliation) },
  { icon: 'i-lucide-lock', text: t(p.value?.statements.confidentiality) },
]);

const channels = computed(() => {
  const c = p.value?.channels_display;
  if (!c) return [];
  const list: { icon: string; label: string; value: string }[] = [];
  if (c.hotline) list.push({ icon: 'i-lucide-phone-call', label: locale.value === 'sw' ? 'Simu ya bure' : 'Toll-free hotline', value: c.hotline });
  if (c.ussd_code) list.push({ icon: 'i-lucide-smartphone', label: 'USSD', value: c.ussd_code });
  if (c.email) list.push({ icon: 'i-lucide-mail', label: locale.value === 'sw' ? 'Barua pepe' : 'Email', value: c.email });
  for (const office of c.offices ?? []) {
    list.push({ icon: 'i-lucide-building-2', label: locale.value === 'sw' ? 'Ofisi' : 'Walk-in', value: office });
  }
  return list;
});

const faqItems = computed(() =>
  (p.value?.faq ?? [])
    .filter((f) => t(f.question))
    .map((f, i) => ({ label: t(f.question), content: t(f.answer), value: String(i) })),
);

const ui = computed(() => ({
  submit: locale.value === 'sw' ? 'Wasilisha malalamiko' : 'Submit a grievance',
  track: locale.value === 'sw' ? 'Fuatilia hali' : 'Track status',
  trackLong: locale.value === 'sw' ? 'Fuatilia kesi iliyopo' : 'Track an existing case',
  howItWorks: locale.value === 'sw' ? 'Jinsi inavyofanya kazi' : 'How it works',
  otherChannels: locale.value === 'sw' ? 'Njia nyingine za kuwasilisha' : 'Other ways to reach us',
  faq: locale.value === 'sw' ? 'Maswali yanayoulizwa mara kwa mara' : 'Frequently asked questions',
}));

const heroTitle = computed(() => t(p.value?.hero?.title) || 'Raise your concern. We will respond.');
const heroSubtitle = computed(
  () =>
    t(p.value?.hero?.subtitle) ||
    'This portal lets you submit a grievance or feedback about the programme, track its progress using your reference number, and receive a response within the published timelines.',
);
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Header -->
    <header class="border-b border-default sticky top-0 bg-default/95 backdrop-blur z-10">
      <div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <img v-if="p?.branding.logo_url" :src="p.branding.logo_url" alt="" class="h-9 w-auto object-contain" />
          <div class="font-semibold text-lg truncate" :style="{ color: primary }">
            {{ p?.name ?? 'Grievance Portal' }}
          </div>
        </div>
        <nav class="flex items-center gap-2 shrink-0">
          <div v-if="locales.length > 1" class="flex rounded-md border border-default overflow-hidden mr-1">
            <button
              v-for="loc in locales"
              :key="loc"
              class="px-2.5 py-1 text-xs font-medium uppercase transition"
              :class="loc === locale ? 'text-white' : 'text-muted hover:text-highlighted'"
              :style="loc === locale ? { backgroundColor: primary } : {}"
              @click="locale = loc"
            >
              {{ loc }}
            </button>
          </div>
          <UButton to="/submit" size="sm">{{ ui.submit }}</UButton>
          <UButton to="/track" size="sm" variant="outline">{{ ui.track }}</UButton>
        </nav>
      </div>
    </header>

    <main class="flex-1 w-full">
      <!-- Hero -->
      <section
        class="relative"
        :style="{
          background: p?.hero?.image_url
            ? `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55)), url(${p.hero.image_url}) center/cover`
            : `linear-gradient(135deg, ${primary}14, ${primary}05)`,
        }"
      >
        <div class="max-w-5xl mx-auto px-4 py-16">
          <h1 class="text-3xl md:text-4xl font-bold mb-4 max-w-3xl" :class="p?.hero?.image_url ? 'text-white' : ''">
            {{ heroTitle }}
          </h1>
          <p class="max-w-2xl mb-8 text-lg" :class="p?.hero?.image_url ? 'text-white/85' : 'text-muted'">
            {{ heroSubtitle }}
          </p>
          <div class="flex flex-wrap gap-3">
            <UButton to="/submit" size="lg">{{ ui.submit }}</UButton>
            <UButton to="/track" size="lg" variant="outline">{{ ui.trackLong }}</UButton>
          </div>
        </div>
      </section>

      <!-- Trust statements -->
      <section class="max-w-5xl mx-auto px-4 -mt-6 relative z-[1]">
        <div class="grid sm:grid-cols-3 gap-4">
          <UCard v-for="(s, i) in statementCards" :key="i" :ui="{ body: 'p-4 sm:p-4' }">
            <div class="flex items-start gap-3">
              <UIcon :name="s.icon" class="text-xl shrink-0 mt-0.5" :style="{ color: accent }" />
              <div class="text-sm">{{ s.text }}</div>
            </div>
          </UCard>
        </div>
      </section>

      <!-- How it works -->
      <section v-if="p?.how_it_works?.length" class="max-w-5xl mx-auto px-4 py-14">
        <h2 class="text-2xl font-semibold mb-8">{{ ui.howItWorks }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div v-for="(step, i) in p.how_it_works" :key="i">
            <div
              class="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold mb-3"
              :style="{ backgroundColor: accent }"
            >
              {{ i + 1 }}
            </div>
            <div class="font-medium mb-1">{{ t(step.title) }}</div>
            <p class="text-sm text-muted">{{ t(step.description) }}</p>
          </div>
        </div>
      </section>

      <!-- Other channels -->
      <section v-if="channels.length" class="border-y border-default bg-elevated/30">
        <div class="max-w-5xl mx-auto px-4 py-10">
          <h2 class="text-xl font-semibold mb-6">{{ ui.otherChannels }}</h2>
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div v-for="(c, i) in channels" :key="i" class="flex items-start gap-3">
              <UIcon :name="c.icon" class="text-xl shrink-0 mt-0.5" :style="{ color: primary }" />
              <div>
                <div class="text-xs text-muted">{{ c.label }}</div>
                <div class="text-sm font-medium">{{ c.value }}</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- About -->
      <section v-if="p?.about && t(p.about.body)" class="max-w-5xl mx-auto px-4 py-14">
        <div class="grid lg:grid-cols-3 gap-8 items-start">
          <div class="lg:col-span-2">
            <h2 class="text-2xl font-semibold mb-4">{{ t(p.about.heading) || 'About' }}</h2>
            <p class="text-muted leading-relaxed whitespace-pre-line">{{ t(p.about.body) }}</p>
          </div>
          <div v-if="p.branding.partner_logos?.length" class="flex flex-wrap items-center gap-4 lg:justify-end">
            <a
              v-for="logo in p.branding.partner_logos"
              :key="logo.name"
              :href="logo.link || undefined"
              target="_blank"
              rel="noopener"
            >
              <img :src="logo.image_url" :alt="logo.name" :title="logo.name" class="h-12 object-contain" />
            </a>
          </div>
        </div>
      </section>

      <!-- FAQ -->
      <section v-if="faqItems.length" class="max-w-3xl mx-auto px-4 pb-14 w-full">
        <h2 class="text-2xl font-semibold mb-6">{{ ui.faq }}</h2>
        <UAccordion :items="faqItems" />
      </section>
    </main>

    <!-- Footer -->
    <footer class="border-t border-default py-8 text-sm text-muted">
      <div class="max-w-5xl mx-auto px-4 grid sm:grid-cols-2 gap-6">
        <div>
          <div class="font-medium text-highlighted mb-1">{{ p?.legal_name ?? p?.name }}</div>
          <div v-if="p?.footer?.address">{{ p.footer.address }}</div>
          <div class="flex flex-wrap gap-x-4 mt-1">
            <span v-if="p?.footer?.phone" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-phone" class="text-xs" />{{ p.footer.phone }}
            </span>
            <span v-if="p?.footer?.email" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-mail" class="text-xs" />{{ p.footer.email }}
            </span>
          </div>
        </div>
        <div class="sm:text-right">
          <div v-if="p?.footer?.privacy_note" class="text-xs max-w-sm sm:ml-auto">{{ t(p.footer.privacy_note) }}</div>
          <div class="text-xs mt-2">{{ p?.name }} — electronic Grievance Redress Mechanism</div>
        </div>
      </div>
    </footer>
  </div>
</template>
