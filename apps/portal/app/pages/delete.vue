<script setup lang="ts">
import type { PortalLegalSection } from '~/composables/usePortalIdentity';

const { notice, pageTitle, relatedLinkLabel, intro, t } = usePortalLegalCopy('data_deletion', {
  pageTitle: {
    en: 'Data deletion instructions',
    sw: 'Maelezo ya kufuta data',
  },
  footerLink: {
    en: 'Data deletion instructions',
    sw: 'Maelezo ya kufuta data',
  },
  relatedLink: {
    en: 'Privacy notice',
    sw: 'Sera ya faragha',
  },
  intro: {
    en: 'Under the Kenya Data Protection Act, 2019, you have the right to request erasure of your personal data where applicable. This page explains how to request deletion of your information from {programme}, and the limits that may apply.',
    sw: 'Chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019, una haki ya kuomba kufutwa kwa data yako binafsi inapofaa. Ukurasa huu unaeleza jinsi ya kuomba ufutaji wa taarifa zako kutoka kwa {programme}, na mipaka inayoweza kutumika.',
  },
});

const { submit } = useDataErasure();

const formDefaults = {
  title: {
    en: 'Request deletion of your data',
    sw: 'Omba kufutwa kwa data yako',
  },
  hint: {
    en: 'Enter the name, email, and phone number you used when you submitted your grievance. If they match our records, your contact details will be removed immediately. Case details may be kept for audit purposes.',
    sw: 'Weka jina, barua pepe, na nambari ya simu ulizotumia unapowasilisha malalamiko. Ikiwa zinalingana na rekodi zetu, taarifa zako za mawasiliano zitafutwa mara moja. Maelezo ya kesi yanaweza kubaki kwa madhumuni ya ukaguzi.',
  },
  name_label: { en: 'Full name', sw: 'Jina kamili' },
  email_label: { en: 'Email', sw: 'Barua pepe' },
  phone_label: { en: 'Phone number', sw: 'Nambari ya simu' },
  submit_label: { en: 'Delete my data', sw: 'Futa data yangu' },
  submitting_label: { en: 'Verifying…', sw: 'Inathibitisha…' },
  success_message: {
    en: 'Your contact details have been removed from {count} case record(s). You can no longer track those cases using this phone or email.',
    sw: 'Taarifa zako za mawasiliano zimeondolewa kutoka kwa rekodi {count} za kesi. Huwezi tena kufuatilia kwa simu au barua pepe hizi.',
  },
  errors: {
    no_match: {
      en: 'We could not verify these details against our records. Check the information and try again, or contact us below.',
      sw: 'Hatukuweza kuthibitisha maelezo haya dhidi ya rekodi zetu. Angalia taarifa na ujaribu tena, au wasiliana nasi hapa chini.',
    },
    already_erased: {
      en: 'Personal contact details matching this information have already been removed.',
      sw: 'Taarifa za mawasiliano zinazolingana na maelezo haya zimeshatolewa.',
    },
    invalid_name: {
      en: 'Enter the full name used when you submitted your case.',
      sw: 'Weka jina kamili lililotumika unapowasilisha kesi yako.',
    },
    invalid_phone: {
      en: 'Enter a valid phone number.',
      sw: 'Weka nambari halali ya simu.',
    },
    invalid_email: {
      en: 'Enter a valid email address.',
      sw: 'Weka anwani halali ya barua pepe.',
    },
    generic: {
      en: 'Request failed. Please try again later.',
      sw: 'Ombi limeshindwa. Jaribu tena baadaye.',
    },
  },
} as const;

const formConfig = computed(() => notice.value?.form);
const formEnabled = computed(() => formConfig.value?.enabled !== false);

function formText<K extends keyof typeof formDefaults>(field: K): string {
  if (field === 'errors') return '';
  const configured = formConfig.value?.[field as 'title'];
  const value = t(configured as Record<string, string> | undefined);
  if (value) return value;
  return t(formDefaults[field] as Record<string, string>);
}

function errorText(code: keyof typeof formDefaults.errors): string {
  const configured = formConfig.value?.errors?.[code];
  const value = t(configured);
  if (value) return value;
  return t(formDefaults.errors[code]);
}

const name = ref('');
const email = ref('');
const phone = ref('');
const error = ref('');
const success = ref('');
const pending = ref(false);

const sections = computed((): PortalLegalSection[] => {
  const configured = notice.value?.sections;
  if (configured?.length) return configured;
  return fallbackSections();
});

const relatedLinks = computed(() => [{ to: '/policy', label: relatedLinkLabel.value }]);

async function onSubmit() {
  error.value = '';
  success.value = '';
  pending.value = true;
  try {
    const res = await submit({
      name: name.value.trim(),
      phone: phone.value.trim(),
      email: email.value.trim(),
    });
    const template = formText('success_message');
    success.value = template.replace(/\{count\}/g, String(res.cases_affected));
    name.value = '';
    email.value = '';
    phone.value = '';
  } catch (e: unknown) {
    const err = e as { data?: { error?: string; message?: string } };
    const code = err.data?.error ?? '';
    const known = ['no_match', 'already_erased', 'invalid_name', 'invalid_phone', 'invalid_email'] as const;
    if (known.includes(code as (typeof known)[number])) {
      error.value = errorText(code as keyof typeof formDefaults.errors);
    } else {
      error.value = err.data?.message ?? errorText('generic');
    }
  } finally {
    pending.value = false;
  }
}

function fallbackSections(): PortalLegalSection[] {
  return [
    {
      id: 'right',
      title: { en: 'Your right to erasure', sw: 'Haki yako ya kufutwa kwa data' },
      body: {
        en: 'You may ask us to delete personal data we hold about you when it is no longer needed for the purpose it was collected, when you withdraw consent (where consent was the legal basis), or when the data was processed unlawfully. We will respond within 30 days unless the law allows a longer period.',
        sw: 'Unaweza kuomba tufute data binafsi tunayohifadhi kukuhusu inapohitajika tena kwa madhumuni yaliyokusanywa, unapojiondoa ridhaa (pale ridhaa ilikuwa msingi wa kisheria), au data ilichakatwa kinyume cha sheria. Tutajibu ndani ya siku 30 isipokuwa sheria inaruhusu muda mrefu zaidi.',
      },
    },
    {
      id: 'can-delete',
      title: { en: 'What we can delete', sw: 'Tunachoweza kufuta' },
      body: {
        en: 'We can remove your name, phone number, email, and notification preferences from our records. Grievance descriptions and case history may be retained in anonymised form where required for audit or legal obligations.',
        sw: 'Tunaweza kuondoa jina, nambari ya simu, barua pepe, na mapendeleo ya arifa kutoka kwa rekodi zetu. Maelezo ya malalamiko na historia ya kesi yanaweza kuhifadhiwa bila kitambulisho pale inahitajika kwa ukaguzi au wajibu wa kisheria.',
      },
    },
    {
      id: 'cannot-delete',
      title: { en: 'What we may need to keep', sw: 'Tunachoweza kuhitaji kuweka' },
      body: {
        en: 'We cannot delete information that must be retained to investigate or evidence a grievance, meet World Bank or government audit requirements, defend legal claims, or protect the safety of others. System audit logs are kept for security and may not be erased.',
        sw: 'Hatuwezi kufuta taarifa zinazohitajika kuchunguza au kuthibitisha malalamiko, kutimiza mahitaji ya ukaguzi wa Benki ya Dunia au serikali, kulinda madai ya kisheria, au kulinda usalama wa wengine. Kumbukumbu za ukaguzi wa mfumo zinahifadhiwa kwa usalama na huenda zisifutwe.',
      },
    },
    {
      id: 'how-to-request',
      title: { en: 'How to submit a request', sw: 'Jinsi ya kuwasilisha ombi' },
      body: {
        en: 'Use the form above for instant removal when your details match. You can also contact us using the details at the bottom of this page for other requests.',
        sw: 'Tumia fomu hapo juu kwa uondoaji wa papo hapo maelezo yanapolingana. Unaweza pia kuwasiliana nasi kwa maelezo hapo chini ya ukurasa huu kwa maombi mengine.',
      },
    },
  ];
}

useHead({ title: computed(() => pageTitle.value) });
</script>

<template>
  <PortalLegalNoticePage
    :title="pageTitle"
    :intro="intro"
    :sections="sections"
    :version="notice?.version"
    :effective-date="notice?.effective_date"
    :related-links="relatedLinks"
  >
    <template v-if="formEnabled" #prepend>
      <UCard class="mb-10" :ui="{ body: 'p-5 sm:p-6 space-y-4' }">
        <div>
          <h2 class="text-lg font-semibold">{{ formText('title') }}</h2>
          <p class="text-sm text-muted mt-1">{{ formText('hint') }}</p>
        </div>

        <UAlert v-if="success" color="success" variant="subtle" :title="success" />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />

        <form class="space-y-4" @submit.prevent="onSubmit">
          <UFormField :label="formText('name_label')" required>
            <UInput v-model="name" class="w-full" autocomplete="name" :disabled="pending" />
          </UFormField>
          <UFormField :label="formText('email_label')" required>
            <UInput v-model="email" type="email" class="w-full" autocomplete="email" :disabled="pending" />
          </UFormField>
          <UFormField :label="formText('phone_label')" required>
            <UInput v-model="phone" type="tel" class="w-full" autocomplete="tel" :disabled="pending" />
          </UFormField>
          <UButton
            type="submit"
            color="primary"
            :loading="pending"
            :disabled="pending || !name.trim() || !email.trim() || !phone.trim()"
          >
            {{ pending ? formText('submitting_label') : formText('submit_label') }}
          </UButton>
        </form>
      </UCard>
    </template>
  </PortalLegalNoticePage>
</template>
