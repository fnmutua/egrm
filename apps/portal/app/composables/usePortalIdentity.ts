type L10n = Record<string, string>;

export interface PortalLegalSection {
  id: string;
  title: L10n;
  body: L10n;
}

export interface PortalLegalNotice {
  version: string;
  effective_date?: string;
  intro?: L10n;
  sections: PortalLegalSection[];
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

  return { p, locales, locale, t };
}
