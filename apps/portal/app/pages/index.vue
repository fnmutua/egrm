<script setup lang="ts">
type L10n = Record<string, string>;

interface IdentityPayload {
  name: string;
  legal_name?: string;
  branding: {
    logo_url?: string;
    primary?: string;
    secondary?: string;
    neutral?: string;
    partner_logos?: { name: string; image_url: string; link?: string }[];
  };
  locales: { default: string; enabled: string[] };
  statements: Record<string, L10n>;
  hero?: { title: L10n; subtitle?: L10n; image_url?: string };
  how_it_works?: { title: L10n; description?: L10n }[];
  channels_display?:
    | { type: 'hotline' | 'ussd' | 'email' | 'office'; value: string }[]
    | { hotline?: string; ussd_code?: string; email?: string; offices?: string[] };
  about?: { heading?: L10n; body: L10n };
  faq?: { question: L10n; answer: L10n }[];
  footer?: { address?: string; phone?: string; email?: string; privacy_note?: L10n };
}

const apiBase = usePublicApiBase();
const config = useRuntimeConfig();

// Tenant branding & landing content come from the config registry (CD-01) — not from code.
const { data: identity } = await useFetch<{ payload: IdentityPayload }>('/api/v1/config/cd01_identity', {
  baseURL: apiBase.value,
  headers: { 'x-tenant': config.public.tenant },
});

/** Public contact routes (CD-08) — preferred source for "Other ways to reach us". */
const { data: channelsConfig } = await useFetch<{
  payload?: {
    public_channels?: { type: string; value: string; enabled?: boolean; show_on_portal?: boolean }[];
    modules?: {
      mobile_app?: { enabled?: boolean; ios_url?: string; android_url?: string; show_on_portal?: boolean };
    };
  };
}>('/api/v1/config/cd08_channels', {
  baseURL: apiBase.value,
  headers: { 'x-tenant': config.public.tenant },
  ignoreResponseError: true,
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

// Hide the logo slot entirely if the configured URL doesn't load (broken link, not an image).
const logoFailed = ref(false);

const statementCards = computed(() => [
  { icon: 'i-lucide-badge-check', text: t(p.value?.statements.free_of_charge) },
  { icon: 'i-lucide-shield-check', text: t(p.value?.statements.non_retaliation) },
  { icon: 'i-lucide-lock', text: t(p.value?.statements.confidentiality) },
]);

const channels = computed(() => {
  const sw = locale.value === 'sw';
  const display: Record<string, { icon: string; label: string }> = {
    hotline: { icon: 'i-lucide-phone-call', label: sw ? 'Simu ya bure' : 'Toll-free hotline' },
    ussd: { icon: 'i-lucide-smartphone', label: 'USSD' },
    email: { icon: 'i-lucide-mail', label: sw ? 'Barua pepe' : 'Email' },
    office: { icon: 'i-lucide-building-2', label: sw ? 'Ofisi' : 'Walk-in' },
    sms: { icon: 'i-lucide-message-square', label: 'SMS' },
  };

  const fromCd08 = channelsConfig.value?.payload?.public_channels;
  if (Array.isArray(fromCd08) && fromCd08.length > 0) {
    return fromCd08
      .filter((ch) => ch.enabled !== false && ch.show_on_portal !== false && ch.value)
      .map((ch) => ({ ...display[ch.type] ?? display.office!, value: ch.value }));
  }

  const c = p.value?.channels_display;
  if (!c) return [];
  // Legacy CD-01 shape: ordered list of typed entries.
  if (Array.isArray(c)) {
    return c
      .filter((ch) => ch.value)
      .map((ch) => ({ ...display[ch.type] ?? display.office!, value: ch.value }));
  }
  // Legacy object shape from older config versions.
  const list: { icon: string; label: string; value: string }[] = [];
  if (c.hotline) list.push({ ...display.hotline!, value: c.hotline });
  if (c.ussd_code) list.push({ ...display.ussd!, value: c.ussd_code });
  if (c.email) list.push({ ...display.email!, value: c.email });
  for (const office of c.offices ?? []) list.push({ ...display.office!, value: office });
  return list;
});

const mobileAppLinks = computed(() => {
  const mod = channelsConfig.value?.payload?.modules?.mobile_app;
  if (!mod?.enabled || mod.show_on_portal === false) return [];
  const sw = locale.value === 'sw';
  const links: { icon: string; label: string; value: string; href: string }[] = [];
  if (mod.ios_url?.trim()) {
    links.push({
      icon: 'i-lucide-smartphone',
      label: sw ? 'Programu ya iOS' : 'iOS app',
      value: sw ? 'Pakua kwenye App Store' : 'Download on App Store',
      href: mod.ios_url.trim(),
    });
  }
  if (mod.android_url?.trim()) {
    links.push({
      icon: 'i-lucide-smartphone',
      label: sw ? 'Programu ya Android' : 'Android app',
      value: sw ? 'Pakua kwenye Google Play' : 'Download on Google Play',
      href: mod.android_url.trim(),
    });
  }
  return links;
});

const reachUsItems = computed(() => [...channels.value, ...mobileAppLinks.value]);

const faqItems = computed(() =>
  (p.value?.faq ?? [])
    .filter((f) => t(f.question))
    .map((f, i) => ({ label: t(f.question), content: t(f.answer), value: String(i) })),
);

const ui = computed(() => ({
  submit: locale.value === 'sw' ? 'Wasilisha malalamiko' : 'Submit a grievance',
  submitShort: locale.value === 'sw' ? 'Wasilisha' : 'Submit',
  track: locale.value === 'sw' ? 'Fuatilia hali' : 'Track status',
  trackShort: locale.value === 'sw' ? 'Fuatilia' : 'Track',
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
      <div class="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3 flex items-center justify-between gap-2 sm:gap-3">
        <div class="flex items-center gap-2 sm:gap-3 min-w-0">
          <img
            v-if="p?.branding.logo_url && !logoFailed"
            :src="p.branding.logo_url"
            alt=""
            class="h-7 sm:h-9 w-auto object-contain shrink-0"
            @error="logoFailed = true"
          />
          <div class="font-semibold text-base sm:text-lg truncate text-primary">
            {{ p?.name ?? 'Grievance Portal' }}
          </div>
        </div>
        <nav class="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <div v-if="locales.length > 1" class="flex rounded-md border border-default overflow-hidden sm:mr-1">
            <button
              v-for="loc in locales"
              :key="loc"
              class="px-2 sm:px-2.5 py-1 text-xs font-medium uppercase transition"
              :class="loc === locale ? 'bg-primary text-inverted' : 'text-muted hover:text-highlighted'"
              @click="locale = loc"
            >
              {{ loc }}
            </button>
          </div>
          <PortalStaffLoginButton />
          <UButton to="/submit" size="sm">
            <span class="sm:hidden">{{ ui.submitShort }}</span>
            <span class="hidden sm:inline">{{ ui.submit }}</span>
          </UButton>
          <UButton to="/track" size="sm" variant="outline">
            <span class="sm:hidden">{{ ui.trackShort }}</span>
            <span class="hidden sm:inline">{{ ui.track }}</span>
          </UButton>
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
            : `linear-gradient(135deg, color-mix(in srgb, var(--ui-primary) 10%, transparent), color-mix(in srgb, var(--ui-primary) 3%, transparent))`,
        }"
      >
        <div class="max-w-6xl mx-auto px-4 py-16 sm:py-24 text-center">
          <h1
            class="text-3xl sm:text-4xl md:text-5xl font-bold mb-5 max-w-3xl mx-auto leading-tight"
            :class="p?.hero?.image_url ? 'text-white' : ''"
          >
            {{ heroTitle }}
          </h1>
          <p
            class="max-w-2xl mx-auto mb-10 text-base sm:text-lg"
            :class="p?.hero?.image_url ? 'text-white/85' : 'text-muted'"
          >
            {{ heroSubtitle }}
          </p>
          <div class="flex flex-col sm:flex-row gap-3 justify-center">
            <UButton to="/submit" size="lg" class="justify-center">{{ ui.submit }}</UButton>
            <UButton to="/track" size="lg" variant="outline" class="justify-center">{{ ui.trackLong }}</UButton>
          </div>
        </div>
      </section>

      <!-- Trust statements -->
      <section class="max-w-6xl mx-auto px-4 -mt-8 relative z-[1]">
        <div class="grid sm:grid-cols-3 gap-4">
          <UCard v-for="(s, i) in statementCards" :key="i" :ui="{ body: 'p-6 sm:p-6' }">
            <div class="flex flex-col items-center text-center gap-3">
              <UIcon :name="s.icon" class="text-3xl text-primary" />
              <div class="text-sm font-medium">{{ s.text }}</div>
            </div>
          </UCard>
        </div>
      </section>

      <!-- How it works -->
      <section v-if="p?.how_it_works?.length" class="max-w-6xl mx-auto px-4 py-20">
        <h2 class="text-2xl sm:text-3xl font-semibold text-center mb-12">{{ ui.howItWorks }}</h2>
        <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          <div v-for="(step, i) in p.how_it_works" :key="i" class="flex flex-col items-center text-center">
            <div class="w-12 h-12 rounded-full flex items-center justify-center text-inverted font-bold text-lg mb-4 bg-primary">
              {{ i + 1 }}
            </div>
            <div class="font-semibold mb-2">{{ t(step.title) }}</div>
            <p class="text-sm text-muted">{{ t(step.description) }}</p>
          </div>
        </div>
      </section>

      <!-- Other channels -->
      <section v-if="reachUsItems.length" class="border-y border-default bg-elevated/30">
        <div class="max-w-6xl mx-auto px-4 py-16">
          <h2 class="text-2xl sm:text-3xl font-semibold text-center mb-10">{{ ui.otherChannels }}</h2>
          <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <UCard v-for="(c, i) in reachUsItems" :key="i" :ui="{ body: 'p-5' }">
              <div class="flex flex-col items-center text-center gap-3">
                <UIcon :name="c.icon" class="text-2xl text-primary" />
                <div class="text-xs text-muted uppercase tracking-wide">{{ c.label }}</div>
                <a
                  v-if="'href' in c && c.href"
                  :href="c.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm font-semibold text-primary hover:underline"
                >
                  {{ c.value }}
                </a>
                <div v-else class="text-sm font-semibold">{{ c.value }}</div>
              </div>
            </UCard>
          </div>
        </div>
      </section>

      <!-- About -->
      <section v-if="p?.about && t(p.about.body)" class="max-w-6xl mx-auto px-4 py-20 w-full">
        <h2 class="text-2xl sm:text-3xl font-semibold mb-5 text-center">{{ t(p.about.heading) || 'About' }}</h2>
        <p class="text-muted leading-relaxed whitespace-pre-line max-w-3xl mx-auto text-center">{{ t(p.about.body) }}</p>
        <div v-if="p.branding.partner_logos?.length" class="flex flex-wrap items-center justify-center gap-8 mt-10">
          <a
            v-for="logo in p.branding.partner_logos"
            :key="logo.name"
            :href="logo.link || undefined"
            target="_blank"
            rel="noopener"
          >
            <img :src="logo.image_url" :alt="logo.name" :title="logo.name" class="h-12 object-contain opacity-80 hover:opacity-100 transition-opacity" />
          </a>
        </div>
      </section>

      <!-- FAQ -->
      <section v-if="faqItems.length" class="max-w-3xl mx-auto px-4 pb-20 w-full">
        <h2 class="text-2xl sm:text-3xl font-semibold mb-8 text-center">{{ ui.faq }}</h2>
        <UAccordion :items="faqItems" />
      </section>

      <!-- Closing CTA -->
      <section class="bg-primary">
        <div class="max-w-6xl mx-auto px-4 py-16 text-center">
          <h2 class="text-2xl sm:text-3xl font-bold text-inverted mb-4">
            {{ locale === 'sw' ? 'Uko tayari kuwasilisha?' : 'Ready to raise a concern?' }}
          </h2>
          <p class="text-inverted/80 mb-8 max-w-xl mx-auto">
            {{ locale === 'sw'
              ? 'Wasilisha malalamiko yako au fuatilia kesi iliyopo.'
              : 'Submit a new grievance or check the status of an existing case.' }}
          </p>
          <div class="flex flex-col sm:flex-row gap-3 justify-center">
            <UButton to="/submit" size="lg" color="neutral" variant="solid" class="justify-center">{{ ui.submit }}</UButton>
            <UButton to="/track" size="lg" color="neutral" variant="outline" class="justify-center">{{ ui.trackLong }}</UButton>
          </div>
        </div>
      </section>
    </main>

    <!-- Footer -->
    <footer class="border-t border-default py-8 text-sm text-muted">
      <div class="max-w-6xl mx-auto px-4 grid sm:grid-cols-2 gap-6">
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
        <div class="sm:text-right space-y-2">
          <div class="flex flex-col sm:items-end gap-1">
            <NuxtLink to="/policy" class="text-primary hover:underline text-sm font-medium">
              {{ locale === 'sw' ? 'Sera ya faragha na ulinzi wa data' : 'Privacy & data protection notice' }}
            </NuxtLink>
            <NuxtLink to="/delete" class="text-primary hover:underline text-sm font-medium">
              {{ locale === 'sw' ? 'Maelezo ya kufuta data' : 'Data deletion instructions' }}
            </NuxtLink>
          </div>
          <div v-if="p?.footer?.privacy_note" class="text-xs max-w-sm sm:ml-auto">{{ t(p.footer.privacy_note) }}</div>
          <div class="text-xs">{{ p?.name }} — electronic Grievance Redress Mechanism</div>
        </div>
      </div>
    </footer>
  </div>
</template>
