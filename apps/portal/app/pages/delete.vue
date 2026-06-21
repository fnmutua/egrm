<script setup lang="ts">
import type { PortalLegalSection } from '~/composables/usePortalIdentity';

const { p, locale, t } = usePortalIdentity();

const ui = computed(() => ({
  title: locale.value === 'sw' ? 'Maelezo ya kufuta data' : 'Data deletion instructions',
  privacy: locale.value === 'sw' ? 'Sera ya faragha' : 'Privacy notice',
}));

const sections = computed((): PortalLegalSection[] => {
  const configured = p.value?.data_deletion?.sections;
  if (configured?.length) return configured;
  return fallbackSections(p.value?.programme ?? p.value?.name ?? 'this grievance redress mechanism');
});

const intro = computed(() => {
  const custom = p.value?.data_deletion?.intro;
  if (custom && t(custom)) return t(custom);
  const programme = p.value?.programme ?? p.value?.legal_name ?? p.value?.name ?? 'this programme';
  return locale.value === 'sw'
    ? `Chini ya Sheria ya Ulinzi wa Data ya Kenya, 2019, una haki ya kuomba kufutwa kwa data yako binafsi inapofaa. Ukurasa huu unaeleza jinsi ya kuomba ufutaji wa taarifa zako kutoka kwa ${programme}, na mipaka inayoweza kutumika.`
    : `Under the Kenya Data Protection Act, 2019, you have the right to request erasure of your personal data where applicable. This page explains how to request deletion of your information from ${programme}, and the limits that may apply.`;
});

const relatedLinks = computed(() => [{ to: '/policy', label: ui.value.privacy }]);

function fallbackSections(programme: string): PortalLegalSection[] {
  const contact = p.value?.footer?.email ?? 'the contact details below';
  const phone = p.value?.footer?.phone ?? '';
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
        en: 'After a case is closed and statutory retention periods have passed, we can delete or anonymise contact details (name, phone, email), notification preferences, and uploaded documents that are not required for audit. We can also remove duplicate or mistaken contact information on request while a case is open.',
        sw: 'Baada ya kesi kufungwa na muda wa kisheria wa uhifadhi kupita, tunaweza kufuta au kutambulisha bila jina maelezo ya mawasiliano (jina, simu, barua pepe), mapendeleo ya arifa, na nyaraka zilizopakiwa ambazo hazihitajiki kwa ukaguzi. Tunaweza pia kuondoa maelezo ya mawasiliano yaliyorudiwa au yaliyokosewa kwa ombi wakati kesi bado haijafungwa.',
      },
    },
    {
      id: 'cannot-delete',
      title: { en: 'What we may need to keep', sw: 'Tunachoweza kuhitaji kuweka' },
      body: {
        en: `We cannot delete information that must be retained to investigate or evidence a grievance, meet World Bank or government audit requirements, defend legal claims, or protect the safety of others. For open cases, we will usually restrict processing or anonymise identifiers where possible rather than delete active case records. System audit logs (who accessed a case) are kept for security and may not be erased.`,
        sw: `Hatuwezi kufuta taarifa zinazohitajika kuchunguza au kuthibitisha malalamiko, kutimiza mahitaji ya ukaguzi wa Benki ya Dunia au serikali, kulinda madai ya kisheria, au kulinda usalama wa wengine. Kwa kesi zinazoendelea, kwa kawaida tutazuia uchakataji au kutambulisha vitambulisho bila jina inapowezekana badala ya kufuta rekodi za kesi hai. Kumbukumbu za ukaguzi wa mfumo (nani aliyefikia kesi) zinahifadhiwa kwa usalama na huenda zisifutwe.`,
      },
    },
    {
      id: 'how-to-request',
      title: { en: 'How to submit a request', sw: 'Jinsi ya kuwasilisha ombi' },
      body: {
        en: `Email ${contact}${phone ? `, call ${phone},` : ','} or visit a programme office. Include your case reference number (for example GRM-2026-0001) if you have one, the personal data you want deleted, and enough detail for us to verify your identity. Anonymous cases can be verified with the reference number and PIN or phone number you used at intake.`,
        sw: `Tuma barua pepe ${contact}${phone ? `, piga ${phone},` : ','} au tembelea ofisi ya mradi. Jumuisha nambari yako ya kumbukumbu ya kesi (kwa mfano GRM-2026-0001) ikiwa unayo, data binafsi unayotaka ifutwe, na maelezo ya kutosha kututhibitisha utambulisho wako. Kesi zisizo na jina zinaweza kuthibitishwa kwa nambari ya kumbukumbu na PIN au simu uliyotumia wakati wa kuwasilisha.`,
      },
    },
    {
      id: 'verification',
      title: { en: 'Identity verification', sw: 'Uthibitishaji wa utambulisho' },
      body: {
        en: 'To protect complainants from fraudulent deletion requests, we must confirm you are the data subject or their authorised representative before erasing personal data. We may ask for a copy of ID, confirmation from the phone or email on file, or in-person verification at a programme office.',
        sw: 'Ili kulinda wawasilishaji dhidi ya maombi ya ulaghai ya kufuta data, lazima tuthibitishe wewe ndiye mhusika wa data au mwakilishi aliyeidhinishwa kabla ya kufuta data binafsi. Tunaweza kuomba nakala ya kitambulisho, uthibitisho kutoka kwa simu au barua pepe iliyorekodiwa, au uthibitisho ana kwa ana katika ofisi ya mradi.',
      },
    },
    {
      id: 'timeline',
      title: { en: 'What happens next', sw: 'Kinachofuata' },
      body: {
        en: 'We acknowledge requests within 7 working days. We will tell you what was deleted, what must be retained and why, or if we need more information. If you disagree with our decision, you may complain to the Office of the Data Protection Commissioner.',
        sw: 'Tunathibitisha kupokea maombi ndani ya siku 7 za kazi. Tutakuambia kilichofutwa, kilichobaki na sababu, au ikiwa tunahitaji taarifa zaidi. Usipokubaliana na uamuzi wetu, unaweza kuwasilisha malalamiko kwa Ofisi ya Kamishna wa Ulinzi wa Data.',
      },
    },
    {
      id: 'whatsapp',
      title: { en: 'WhatsApp and messaging channels', sw: 'WhatsApp na njia za ujumbe' },
      body: {
        en: `Messages sent to our WhatsApp or SMS numbers for case status are processed to reply to you; they are not a channel for formal deletion requests. Please use email or post for written erasure requests relating to ${programme}.`,
        sw: `Ujumbe unaotumwa kwa nambari zetu za WhatsApp au SMS kwa hali ya kesi unachakatwa ili kukujibu; si njia ya maombi rasmi ya kufuta data. Tafadhali tumia barua pepe au posta kwa maombi ya maandishi ya ufutaji yanayohusiana na ${programme}.`,
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
    :version="p?.data_deletion?.version"
    :effective-date="p?.data_deletion?.effective_date"
    :related-links="relatedLinks"
  />
</template>
