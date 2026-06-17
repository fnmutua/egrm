/**
 * Conversational chatbot mode — natural dialogue with per-turn LLM extraction
 * instead of rigid step-by-step slot filling.
 */
import { z } from 'zod';
import type { Cd06IntakeForms, Cd16Ai, Cd03Taxonomy } from '@egrm/config-schemas';
import { chatCompletion } from './ai-completion.js';
import { hashRedactedPrompt, redactIntakeText } from './ai-redaction.js';
import { parseJsonFromModel } from './ai-shared.js';
import { verifyCaseByReference } from './correspondence.js';
import { db, schema } from '../db/client.js';
import type { ChatbotSlotsState, TranscriptEntry } from './chatbot-intake.js';
import {
  applyNarrativeAndExtraction,
  buildFieldQueue,
  conversationalMissingReply,
  detectConsent,
  extractFromNarrative,
  fieldIsEmpty,
  fieldLabel,
  pendingFields,
  readBackText,
  resolveUnitForTurn,
} from './chatbot-intake.js';

const conversationalTurnSchema = z.object({
  reply: z.string().min(1),
  intent: z.enum(['file_case', 'check_status', 'kb_faq', 'handoff', 'none']).optional(),
  anonymous: z.boolean().nullable().optional(),
  consent: z.boolean().nullable().optional(),
  status_reference: z.string().optional(),
  status_verifier: z.string().optional(),
  sensitivity_signal: z.boolean().optional(),
});

export function conversationalWelcome(cd16: Cd16Ai, locale: string): string {
  const name = cd16.chatbot.persona.name;
  if (locale === 'sw') {
    return (
      `Habari, mimi ni ${name}. Unaweza kuelezea malalamiko yako kwa maneno yako, ` +
      `kuuliza swali kuhusu mchakato, kuangalia hali ya kesi kwa nambari ya rejeleo, ` +
      `au kuomba kuongea na afisa. Nini naweza kukusaidia leo?`
    );
  }
  return (
    `Hi, I'm ${name}. Tell me what's going on in your own words — you can file a grievance, ` +
    `ask about the process, check a case with your reference number, or ask to speak with an officer. ` +
    `How can I help today?`
  );
}

function transcriptDialogue(transcript: TranscriptEntry[], maxTurns = 12): string {
  return transcript
    .slice(-maxTurns)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`)
    .join('\n');
}

function capturedSummary(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  locale: string,
): string {
  const lines: string[] = [];
  for (const key of slots.field_queue.length ? slots.field_queue : Object.keys(slots.confirmed)) {
    const val = slots.confirmed[key];
    if (fieldIsEmpty(key, val)) continue;
    if (key === 'categories') {
      const codes = Array.isArray(val) ? val : [];
      const names = codes.map((code) => {
        const c = taxonomy.categories.find((x) => x.code === code);
        return c?.label[locale] ?? c?.label.en ?? String(code);
      });
      lines.push(`${fieldLabel(form, key, locale)}: ${names.join(', ')}`);
    } else if (key === 'unit_id') {
      lines.push(`${fieldLabel(form, key, locale)}: selected`);
    } else {
      lines.push(`${fieldLabel(form, key, locale)}: ${String(val)}`);
    }
  }
  if (slots.anonymous === true) lines.push('Anonymous: yes');
  if (slots.consent) lines.push('Consent: yes');
  return lines.length ? lines.join('\n') : '(nothing captured yet)';
}

function missingFieldLabels(form: Cd06IntakeForms, slots: ChatbotSlotsState, locale: string): string[] {
  const queue =
    slots.field_queue.length > 0
      ? slots.field_queue
      : buildFieldQueue(form, ['unit_id', 'summary', 'categories'], slots.anonymous === true);
  return queue.filter((k) => fieldIsEmpty(k, slots.confirmed[k])).map((k) => fieldLabel(form, k, locale));
}

async function finalizeIntakeTurn(
  tenantId: string,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  narrative: string,
  proposed: Record<string, unknown>,
  latestText: string,
  locale: string,
  cd16: Cd16Ai,
  leadReply?: string,
): Promise<{ replies: string[]; phase: string; readback: boolean }> {
  if (detectConsent(latestText)) slots.consent = true;

  await applyNarrativeAndExtraction(tenantId, form, taxonomy, slots, narrative, proposed, locale, latestText);
  const unitContext = await resolveUnitForTurn(tenantId, slots, latestText, proposed, narrative);

  if (!slots.field_queue.length) {
    slots.field_queue = buildFieldQueue(
      form,
      cd16.chatbot.channel_minimum.fields,
      slots.anonymous === true,
    );
  }

  const stillMissing = pendingFields(slots);
  const needsConsent =
    !slots.anonymous &&
    !slots.consent &&
    form.consent_text &&
    (slots.confirmed.name || slots.confirmed.phone || slots.confirmed.email);

  const replies: string[] = [];

  if (stillMissing.length === 0 && needsConsent) {
    if (leadReply) replies.push(leadReply);
    replies.push(
      locale === 'sw'
        ? 'Karibu umalize — tafadhali thibitisha idhini yako kwa kujibu "ndio" au "ninakubali".'
        : 'Almost done — please confirm consent by replying "yes" or "I consent".',
    );
    return { replies, phase: 'converse', readback: false };
  }

  if (stillMissing.length === 0 && !needsConsent) {
    if (leadReply) replies.push(leadReply);
    else {
      replies.push(
        locale === 'sw'
          ? 'Asante — tafadhali kagua muhtasari na bofya Wasilisha.'
          : 'Great — please review the summary below and tap Submit when it looks right.',
      );
    }
    replies.push(readBackText(form, taxonomy, slots, locale));
    return { replies, phase: 'file_readback', readback: true };
  }

  const missingReply = conversationalMissingReply(form, slots, locale, unitContext ?? undefined);
  const unitOnlyMissing =
    stillMissing.length === 1 && stillMissing[0] === 'unit_id' && unitContext != null;

  if (unitOnlyMissing) {
    replies.push(missingReply);
  } else if (leadReply) {
    replies.push(leadReply);
    replies.push(missingReply);
  } else {
    replies.push(missingReply);
  }

  return { replies, phase: 'converse', readback: false };
}

async function runConversationalTurn(
  tenantId: string,
  sessionId: string,
  cd16: Cd16Ai,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  transcript: TranscriptEntry[],
  locale: string,
  profileKey: string,
  profile: Cd16Ai['provider_profiles'][string],
): Promise<z.infer<typeof conversationalTurnSchema>> {
  const anonymous = slots.anonymous === true;
  if (!slots.field_queue.length && slots.anonymous !== null) {
    slots.field_queue = buildFieldQueue(
      form,
      cd16.chatbot.channel_minimum.fields,
      anonymous,
    );
  }

  const missing = missingFieldLabels(form, slots, locale);
  const categories = taxonomy.categories
    .filter((c) => c.active !== false)
    .slice(0, 16)
    .map((c) => `${c.code}: ${c.label[locale] ?? c.label.en ?? c.code}`)
    .join('\n');

  const dialogue = transcriptDialogue(transcript);
  const redacted = redactIntakeText(dialogue, cd16.safety);

  const system = [
    `You are ${cd16.chatbot.persona.name}, a grievance intake assistant.`,
    'Be warm, concise, and conversational. Never show numbered menus or ask one rigid form field at a time.',
    'Extract structured data from the conversation and reply naturally.',
    'Ask for ALL still-missing items in one friendly message when possible.',
    'Do not repeat information the user already provided.',
    'Always take grievances in through this chat — do not tell users to call or visit an office unless they explicitly ask to speak with a person.',
    'Set sensitivity_signal true ONLY for immediate physical danger right now (active attack, suicide in progress). Past incidents and grievances are normal intake — sensitivity_signal false.',
    'Return ONLY valid JSON matching the schema below.',
  ].join('\n');

  const userPrompt = [
    'Schema:',
    '{',
    '  "reply": "your next message to the user",',
    '  "intent": "file_case|check_status|kb_faq|handoff|none",',
    '  "anonymous": true|false|null,',
    '  "consent": true|false|null,',
    '  "status_reference": "case ref if checking status",',
    '  "status_verifier": "phone/email/PIN if checking status",',
    '  "sensitivity_signal": false',
    '}',
    '',
    `Locale: ${locale}`,
    `Anonymous submissions allowed: ${form.anonymous_allowed}`,
    `Consent required for identified submissions: ${Boolean(form.consent_text)}`,
    '',
    'Already captured:',
    capturedSummary(form, taxonomy, slots, locale),
    '',
    missing.length ? `Still needed:\n- ${missing.join('\n- ')}` : 'All required intake fields are captured.',
    '',
    `Category codes:\n${categories}`,
    '',
    'Conversation:',
    redacted,
  ].join('\n');

  const result = await chatCompletion(
    profile,
    [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    { json_mode: true },
  );

  const parsed = conversationalTurnSchema.parse(parseJsonFromModel(result.content));

  await db.insert(schema.aiInteraction).values({
    tenantId,
    chatbotSessionId: sessionId,
    capability: 'chatbot_reply',
    providerProfileId: profileKey,
    model: profile.default_model,
    inputHash: hashRedactedPrompt([redacted]),
    suggestion: { reply: parsed.reply, intent: parsed.intent },
    status: 'completed',
    decision: 'accepted',
    latencyMs: result.latency_ms,
  });

  return parsed;
}

export interface ConversationalTurnResult {
  replies: string[];
  intent: string | null;
  phase: string;
  slots: ChatbotSlotsState;
  handoff: boolean;
  done: boolean;
  readback: boolean;
  sensitivityFlagged: boolean;
}

export async function handleConversationalTurn(
  tenantId: string,
  sessionId: string,
  cd16: Cd16Ai,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  transcript: TranscriptEntry[],
  text: string,
  locale: string,
  currentIntent: string | null,
  currentPhase: string,
  profileKey: string,
  profile: Cd16Ai['provider_profiles'][string],
  deps: {
    answerFaq: (query: string) => Promise<string>;
    hotlineMessage: () => Promise<string>;
  },
): Promise<ConversationalTurnResult> {
  const replies: string[] = [];
  let intent = currentIntent;
  let phase = currentPhase;
  let handoff = false;
  let done = false;
  let readback = false;
  let sensitivityFlagged = false;

  // Fast path: user already at readback and wants to edit a field
  if (phase === 'file_readback') {
    replies.push(
      locale === 'sw'
        ? 'Tumia kitufe cha Wasilisha hapa chini, au niambie ungependa kubadilisha nini.'
        : 'Use the Submit button below when ready, or tell me what you would like to change.',
    );
    return { replies, intent, phase, slots, handoff, done, readback: true, sensitivityFlagged };
  }

  let turn: z.infer<typeof conversationalTurnSchema>;
  try {
    turn = await runConversationalTurn(
      tenantId,
      sessionId,
      cd16,
      form,
      taxonomy,
      slots,
      transcript,
      locale,
      profileKey,
      profile,
    );
  } catch {
    const narrative = transcript.filter((t) => t.role === 'user').map((t) => t.text).join('\n');
    const anonymous = slots.anonymous === true;
    const { proposed, sensitivity } = await extractFromNarrative(
      tenantId,
      sessionId,
      cd16,
      narrative || text,
      taxonomy,
      anonymous,
      text,
    );
    if (sensitivity && cd16.chatbot.handoff_on_sensitive) {
      handoff = true;
      done = true;
      phase = 'handoff';
      replies.push(
        locale === 'sw'
          ? 'Kwa usalama wako, tafadhali zungumza na afisa moja kwa moja.'
          : 'For your safety, please speak with an officer directly.',
      );
      replies.push(await deps.hotlineMessage());
      return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged: true };
    }
    if (sensitivity) sensitivityFlagged = true;

    const finalized = await finalizeIntakeTurn(
      tenantId,
      form,
      taxonomy,
      slots,
      narrative || text,
      proposed,
      text,
      locale,
      cd16,
    );
    phase = finalized.phase;
    readback = finalized.readback;
    replies.push(...finalized.replies);
    return { replies, intent: intent ?? 'file_case', phase, slots, handoff, done, readback, sensitivityFlagged };
  }

  if (turn.intent && turn.intent !== 'none') {
    if (!intent || intent === turn.intent) intent = turn.intent;
  }

  if (turn.sensitivity_signal) {
    sensitivityFlagged = true;
    if (cd16.chatbot.handoff_on_sensitive) {
      handoff = true;
      done = true;
      phase = 'handoff';
      replies.push(turn.reply);
      replies.push(await deps.hotlineMessage());
      return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged };
    }
  }

  if (turn.intent === 'handoff' || intent === 'handoff') {
    handoff = true;
    done = true;
    phase = 'handoff';
    intent = 'handoff';
    replies.push(turn.reply);
    replies.push(await deps.hotlineMessage());
    return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged };
  }

  if (turn.intent === 'kb_faq' || intent === 'kb_faq') {
    intent = 'kb_faq';
    const answer = await deps.answerFaq(text);
    replies.push(answer || turn.reply);
    return { replies, intent: null, phase: 'converse', slots, handoff, done, readback, sensitivityFlagged };
  }

  if (turn.intent === 'check_status' || intent === 'check_status') {
    intent = 'check_status';
    const ref = turn.status_reference?.trim() ?? text.match(/GRM[-\s]?\d{4}[-\s]?\d+/i)?.[0]?.replace(/\s/g, '-');
    const verifier = turn.status_verifier?.trim();
    if (ref && verifier) {
      const verified = await verifyCaseByReference(tenantId, ref, verifier);
      if (verified) {
        replies.push(
          locale === 'sw'
            ? `Kesi ${verified.case.reference} iko katika hali: ${verified.case.status}.`
            : `Case ${verified.case.reference} is currently: ${verified.case.status}.`,
        );
      } else {
        replies.push(
          locale === 'sw'
            ? 'Haiwezekani kuthibitisha kesi hiyo. Angalia rejeleo na uthibitisho.'
            : 'Could not verify that case. Check your reference and verifier.',
        );
      }
      return { replies, intent: null, phase: 'converse', slots: parseEmptySlots(), handoff, done, readback, sensitivityFlagged };
    }
    phase = 'converse';
    replies.push(turn.reply);
    return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged };
  }

  // file_case (default path)
  intent = intent ?? 'file_case';
  if (turn.anonymous !== undefined && turn.anonymous !== null) slots.anonymous = turn.anonymous;
  if (turn.consent === true) slots.consent = true;
  if (detectConsent(text)) slots.consent = true;

  const narrative = transcript.filter((t) => t.role === 'user').map((t) => t.text).join('\n');
  const { proposed, sensitivity } = await extractFromNarrative(
    tenantId,
    sessionId,
    cd16,
    narrative,
    taxonomy,
    slots.anonymous === true,
    text,
  );

  if (sensitivity) {
    sensitivityFlagged = true;
    if (cd16.chatbot.handoff_on_sensitive) {
      handoff = true;
      done = true;
      phase = 'handoff';
      replies.push(turn.reply);
      replies.push(await deps.hotlineMessage());
      return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged };
    }
  }

  const finalized = await finalizeIntakeTurn(
    tenantId,
    form,
    taxonomy,
    slots,
    narrative,
    proposed,
    text,
    locale,
    cd16,
    turn.reply,
  );

  phase = finalized.phase;
  readback = finalized.readback;
  replies.push(...finalized.replies);
  return { replies, intent, phase, slots, handoff, done, readback, sensitivityFlagged };
}

function parseEmptySlots(): ChatbotSlotsState {
  return {
    proposed: {},
    confirmed: {},
    anonymous: null,
    consent: false,
    field_queue: [],
  };
}
