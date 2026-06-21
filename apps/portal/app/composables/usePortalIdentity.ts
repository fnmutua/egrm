type L10n = Record<string, string>;

export interface PortalLegalSection {
  id: string;
  title: L10n;
  body: L10n;
}

export interface PortalErasureFormConfig {
  enabled?: boolean;
  title?: L10n;
  hint?: L10n;
  name_label?: L10n;
  email_label?: L10n;
  phone_label?: L10n;
  submit_label?: L10n;
  submitting_label?: L10n;
  success_message?: L10n;
  errors?: {
    no_match?: L10n;
    already_erased?: L10n;
    invalid_name?: L10n;
    invalid_phone?: L10n;
    invalid_email?: L10n;
    generic?: L10n;
  };
}

export interface PortalLegalNotice {
  version: string;
  effective_date?: string;
  page_title?: L10n;
  footer_link_label?: L10n;
  related_link_label?: L10n;
  intro?: L10n;
  sections: PortalLegalSection[];
  form?: PortalErasureFormConfig;
}

/** @deprecated use PortalLegalSection */
export type PortalPrivacySection = PortalLegalSection;

export interface PortalIdentityPayload {
  name: string;
  legal_name?: string;
  programme?: string;
  locales: { default: string; enabled: string[] };
  footer?: { address?: string; phone?: string; email?: string; privacy_note?: L10n };
  privacy_policy?: PortalLegalNotice;
  data_deletion?: PortalLegalNotice;
}

export type PortalLegalNoticeKey = 'privacy_policy' | 'data_deletion';

export function usePortalIdentity() {
  const apiBase = usePublicApiBase();
  const config = useRuntimeConfig();

  const { data: identity } = useFetch<{ payload: PortalIdentityPayload }>('/api/v1/config/cd01_identity', {
    baseURL: apiBase.value,
    headers: { 'x-tenant': config.public.tenant },
  });

  const p = computed(() => identity.value?.payload);
  const locales = computed(() => p.value?.locales.enabled ?? ['en']);
  const locale = useCookie<string>('egrm_locale', { default: () => '' });

  watch(
    [p, locales],
    () => {
      if (!locale.value || !locales.value.includes(locale.value)) {
        locale.value = p.value?.locales.default ?? 'en';
      }
    },
    { immediate: true },
  );

  function t(text: L10n | undefined): string {
    if (!text) return '';
    return text[locale.value] || text[p.value?.locales.default ?? 'en'] || Object.values(text)[0] || '';
  }

  function programmeName(): string {
    return p.value?.programme ?? p.value?.legal_name ?? p.value?.name ?? 'this programme';
  }

  return { p, locales, locale, t, programmeName };
}

/** Resolve configurable legal-page copy with localized fallbacks. */
export function usePortalLegalCopy(
  key: PortalLegalNoticeKey,
  defaults: {
    pageTitle: L10n;
    footerLink: L10n;
    relatedLink: L10n;
    intro: L10n;
  },
) {
  const { p, t, programmeName } = usePortalIdentity();
  const notice = computed(() => p.value?.[key]);

  function pick(configured: L10n | undefined, fallback: L10n): string {
    const value = t(configured);
    return value || t(fallback);
  }

  const pageTitle = computed(() => pick(notice.value?.page_title, defaults.pageTitle));
  const footerLinkLabel = computed(() => pick(notice.value?.footer_link_label, defaults.footerLink));
  const relatedLinkLabel = computed(() => pick(notice.value?.related_link_label, defaults.relatedLink));
  const intro = computed(() => {
    const custom = t(notice.value?.intro);
    if (custom) return custom;
    const fallback = t(defaults.intro);
    return fallback.replace(/\{programme\}/g, programmeName());
  });

  return { notice, pageTitle, footerLinkLabel, relatedLinkLabel, intro, t, programmeName };
}
