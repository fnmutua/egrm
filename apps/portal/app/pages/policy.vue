<script setup lang="ts">
import type { PortalLegalSection } from '~/composables/usePortalIdentity';

const { p, locale, t } = usePortalIdentity();

const ui = computed(() => ({
  title: locale.value === 'sw' ? 'Sera ya faragha na ulinzi wa data' : 'Privacy & data protection notice',
  dataDeletion:
    locale.value === 'sw' ? 'Maelezo ya kufuta data' : 'Data deletion instructions',
}));

const sections = computed((): PortalLegalSection[] => {
  const configured = p.value?.privacy_policy?.sections;
  if (configured?.length) return configured;
  return fallbackSections(p.value?.programme ?? p.value?.name ?? 'this grievance redress mechanism');
});

const intro = computed(() => {
  const custom = p.value?.privacy_policy?.intro;
  if (custom && t(custom)) return t(custom);
  const programme = p.value?.programme ?? p.value?.legal_name ?? p.value?.name ?? 'this programme';
  return locale.value === 'sw'
    ? `Taarifa hii inaeleza jinsi ${programme} inavyokusanya, kutumia, kuhifadhi, na kulinda taarifa zako unapowasilisha au kufuatilia malalamiko kupitia mfumo wa kielektroniki wa GRM.`
    : `This notice explains how ${programme} collects, uses, stores, and protects your information when you submit or track a grievance through this electronic Grievance Redress Mechanism (GRM).`;
});

const relatedLinks = computed(() => [
  { to: '/delete', label: ui.value.dataDeletion },
]);

function fallbackSections(programme: string): PortalLegalSection[] {
  return [
    {
      id: 'scope',
      title: { en: 'Scope', sw: 'Upeo' },
      body: {
        en: `This notice applies to personal data you provide when using the public portal, hotline, SMS, WhatsApp, email, walk-in assisted intake, or other channels connected to ${programme}. It does not replace separate policies of partner agencies where a referral is made.`,
        sw: `Taarifa hii inatumika kwa data binafsi unayotoa unapotumia tovuti ya umma, simu ya bure, SMS, WhatsApp, barua pepe, ofisi, au njia nyingine zilizounganishwa na ${programme}. Haiibadili sera za kando za mashirika mengine pale tunaporejea malalamiko.`,
      },
    },
    {
      id: 'collect',
      title: { en: 'Information we collect', sw: 'Taarifa tunazokusanya' },
      body: {
        en: 'Depending on how you contact us, we may collect: your name, phone number, email address, location or settlement, description of the grievance, supporting documents, preferred language, and notification preferences. Anonymous submissions do not require your name; we issue a reference number and may ask for a phone number or PIN to verify follow-up.',
        sw: 'Kulingana na jinsi unavyowasiliana nasi, tunaweza kukusanya: jina, nambari ya simu, barua pepe, eneo au makazi, maelezo ya malalamiko, nyaraka za usaidizi, lugha unayopendelea, na njia za taarifa. Uwasilishaji bila kujulikana hauhitaji jina; tunakupa nambari ya kumbukumbu na tunaweza kuomba simu au PIN kuthibitisha ufuatiliaji.',
      },
    },
    {
      id: 'use',
      title: { en: 'How we use your information', sw: 'Jinsi tunavyotumia taarifa zako' },
      body: {
        en: 'We use your information solely to register, investigate, and resolve grievances; communicate with you about your case; meet legal and safeguard obligations; and produce anonymised statistics. We do not sell your data.',
        sw: 'Tunatumia taarifa zako tu kusajili, kuchunguza, na kutatua malalamiko; kuwasiliana nawe kuhusu kesi yako; kutimiza wajibu wa kisheria na ulinzi; na kutoa takwimu zisizotambulisha mtu. Hatuuzi data yako.',
      },
    },
    {
      id: 'access',
      title: { en: 'Who can access your information', sw: 'Nani anaweza kufikia taarifa zako' },
      body: {
        en: 'Only authorised GRM staff with a legitimate case-related need can view your details. Access is logged. Sensitive grievances (for example GBV/SEA) are restricted to specially trained officers under stricter confidentiality rules.',
        sw: 'Wafanyakazi wa GRM walioruhusiwa tu wenye haja halali ya kesi wanaweza kuona taarifa zako. Ufikiaji unarekodiwa. Malalamiko nyeti (kwa mfano GBV/SEA) yanawekewa vizuizi kwa maafisa waliofunzwa kwa sheria kali zaidi za usiri.',
      },
    },
    {
      id: 'notifications',
      title: { en: 'Notifications', sw: 'Taarifa na arifa' },
      body: {
        en: 'If you opt in, we may send case updates by SMS, email, or WhatsApp. You can choose channels at intake. Status messages contain only the information needed to inform you; sensitive cases may use privacy-safe wording.',
        sw: 'Ukikubali, tunaweza kutuma taarifa za kesi kupitia SMS, barua pepe, au WhatsApp. Unaweza kuchagua njia wakati wa kuwasilisha. Ujumbe una taarifa muhimu tu; kesi nyeti zinaweza kutumia maneno salama zaidi kwa faragha.',
      },
    },
    {
      id: 'retention',
      title: { en: 'Retention', sw: 'Uhifadhi wa data' },
      body: {
        en: 'Case records are kept for as long as needed to resolve the grievance, handle appeals, and meet audit and legal requirements, then archived or anonymised according to programme retention rules.',
        sw: 'Rekodi za kesi zinahifadhiwa kwa muda unaohitajika kutatua malalamiko, kushughulikia rufaa, na kutimiza mahitaji ya ukaguzi na kisheria, kisha kuhifadhiwa au kutambulishwa bila jina kulingana na sheria za uhifadhi wa mradi.',
      },
    },
    {
      id: 'rights',
      title: { en: 'Your rights', sw: 'Haki zako' },
      body: {
        en: 'Under the Kenya Data Protection Act, 2019, you may request access, correction, or deletion of your personal data where applicable. See our data deletion page for how to request erasure. You may also lodge a complaint with the Office of the Data Protection Commissioner.',
        sw: 'Chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019, unaweza kuomba kufikia, kusahihisha, au kufuta data yako binafsi inapofaa. Tazama ukurasa wetu wa kufuta data kwa jinsi ya kuomba ufutaji. Unaweza pia kuwasilisha malalamiko kwa Ofisi ya Kamishna wa Ulinzi wa Data.',
      },
    },
    {
      id: 'security',
      title: { en: 'Security', sw: 'Usalama' },
      body: {
        en: 'Personal identifiers are encrypted. The system records who accessed a case and when. We apply technical and organisational measures appropriate to the sensitivity of the information.',
        sw: 'Vitambulisho binafsi vimesimbwa. Mfumo unarekodi nani aliyefikia kesi na lini. Tunatumia hatua za kiufundi na za shirika zinazofaa kwa usikivu wa taarifa.',
      },
    },
  ];
}

useHead({ title: computed(() => ui.value.title) });
</script>

<template>
  <PortalLegalNoticePage
    :title="ui.title"
    :intro="intro"
    :sections="sections"
    :version="p?.privacy_policy?.version"
    :effective-date="p?.privacy_policy?.effective_date"
    :related-links="relatedLinks"
  />
</template>
