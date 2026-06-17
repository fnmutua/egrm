import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Cd01Identity, Cd03Taxonomy, Cd06IntakeForms, Cd08Channels, Cd16Ai } from '@egrm/config-schemas';
import { normalizeCd06IntakeForms } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { getActiveConfig } from './config.js';
import { chatCompletion } from './ai-completion.js';
import { hashRedactedPrompt, redactIntakeText } from './ai-redaction.js';
import { createCase } from './intake.js';
import { coerceIntakeStringArray, coerceIntakeString } from './intake-values.js';
import { searchIntakeUnits } from './intake-units.js';
import { verifyCaseByReference } from './correspondence.js';
import { loadChatbotConfig, parseJsonFromModel } from './ai-shared.js';

type TranscriptEntry = { role: 'user' | 'assistant'; text: string; at: string };

export interface ChatbotSlotsState {
  proposed: Record<string, unknown>;
  confirmed: Record<string, unknown>;
  anonymous: boolean | null;
  consent: boolean;
  field_queue: string[];
  status_reference?: string;
}

type SessionRow = typeof schema.chatbotSession.$inferSelect;

const INTENT_LABELS: Record<string, Record<string, string>> = {
  file_case: { en: 'File a grievance', sw: 'Wasilisha malalamiko' },
  check_status: { en: 'Check case status', sw: 'Angalia hali ya kesi' },
  kb_faq: { en: 'Ask a question', sw: 'Uliza swali' },
  handoff: { en: 'Talk to a person', sw: 'Zungumza na mtu' },
};

const extractSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional(),
  unit_hint: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  date_occurred: z.string().optional(),
  expected_outcome: z.string().optional(),
  sensitivity_signal: z.boolean().optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

function parseSlots(raw: Record<string, unknown>): ChatbotSlotsState {
  const proposed = (raw.proposed as Record<string, unknown>) ?? {};
  const confirmed = (raw.confirmed as Record<string, unknown>) ?? {};
  return {
    proposed,
    confirmed,
    anonymous: typeof raw.anonymous === 'boolean' ? raw.anonymous : null,
    consent: raw.consent === true,
    field_queue: Array.isArray(raw.field_queue) ? (raw.field_queue as string[]) : [],
    status_reference: typeof raw.status_reference === 'string' ? raw.status_reference : undefined,
  };
}

function slotsToJson(slots: ChatbotSlotsState): Record<string, unknown> {
  return { ...slots };
}

function resolveChatbotProfile(cd16: Cd16Ai): { key: string; profile: Cd16Ai['provider_profiles'][string] } | null {
  const key =
    cd16.chatbot.profile ??
    Object.entries(cd16.provider_profiles).find(([, p]) => p.enabled)?.[0];
  if (!key) return null;
  const profile = cd16.provider_profiles[key];
  if (!profile?.enabled) return null;
  return { key, profile };
}

function disclosureText(cd16: Cd16Ai, locale: string): string {
  const d = cd16.chatbot.automated_agent_disclosure;
  return d[locale] ?? d.en ?? Object.values(d)[0] ?? '';
}

function intentMenu(cd16: Cd16Ai, locale: string): string {
  const lines = cd16.chatbot.allowed_intents.map((intent, i) => {
    const label = INTENT_LABELS[intent]?.[locale] ?? INTENT_LABELS[intent]?.en ?? intent;
    return `${i + 1}. ${label}`;
  });
  return `How can I help you today?\n\n${lines.join('\n')}\n\nReply with a number or describe what you need.`;
}

function parseIntent(text: string, allowed: string[]): string | null {
  const t = text.toLowerCase().trim();
  const byNumber: Record<string, string> = {
    '1': 'file_case',
    '2': 'check_status',
    '3': 'kb_faq',
    '4': 'handoff',
  };
  if (byNumber[t] && allowed.includes(byNumber[t]!)) return byNumber[t]!;
  if (allowed.includes('file_case') && /file|grievance|complaint|submit|report|malalamiko/.test(t)) return 'file_case';
  if (allowed.includes('check_status') && /status|track|reference|fuatilia|hali/.test(t)) return 'check_status';
  if (allowed.includes('kb_faq') && /faq|question|help|how|uliza|swali/.test(t)) return 'kb_faq';
  if (allowed.includes('handoff') && /human|person|officer|handoff|talk|agent|afisa/.test(t)) return 'handoff';
  return null;
}

function isYes(text: string): boolean {
  return /^(yes|y|ndio|ndiyo|true|1)$/i.test(text.trim());
}

function isNo(text: string): boolean {
  return /^(no|n|hapana|false|0)$/i.test(text.trim());
}

function fieldLabel(form: Cd06IntakeForms, key: string, locale: string): string {
  const field = form.fields.find((f) => f.key === key);
  const label = field?.label;
  if (!label) return key.replaceAll('_', ' ');
  return label[locale] ?? label.en ?? Object.values(label)[0] ?? key;
}

function buildFieldQueue(form: Cd06IntakeForms, channelMinimum: string[], anonymous: boolean): string[] {
  const keys = new Set<string>(channelMinimum);
  for (const field of form.fields) {
    if (!field.enabled || !field.required) continue;
    if (field.section === 'complainant' && anonymous) continue;
    keys.add(field.key);
  }
  const order = [
    'unit_id',
    'categories',
    'summary',
    'description',
    'name',
    'phone',
    'email',
    'date_occurred',
    'expected_outcome',
  ];
  const queue: string[] = [];
  for (const k of order) {
    if (keys.has(k)) queue.push(k);
  }
  for (const k of keys) {
    if (!queue.includes(k)) queue.push(k);
  }
  return queue;
}

function fieldIsEmpty(key: string, val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (key === 'categories') return coerceIntakeStringArray(val).length === 0;
  return false;
}

function pendingFields(slots: ChatbotSlotsState): string[] {
  if (slots.field_queue.length) {
    return slots.field_queue.filter((k) => fieldIsEmpty(k, slots.confirmed[k]));
  }
  return [];
}

function summarizeFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const first = trimmed.split(/[.!?\n]/).find((part) => part.trim().length > 0)?.trim() ?? trimmed;
  return first.length > 200 ? `${first.slice(0, 197)}...` : first;
}

function formatCapturedValue(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  key: string,
  val: unknown,
  locale: string,
): string {
  const label = fieldLabel(form, key, locale);
  if (key === 'categories') {
    const codes = coerceIntakeStringArray(val);
    const names = codes.map((code) => {
      const c = taxonomy.categories.find((x) => x.code === code);
      return c?.label[locale] ?? c?.label.en ?? code;
    });
    return `${label}: ${names.join(', ')}`;
  }
  if (key === 'description') {
    return locale === 'sw' ? 'maelezo ya malalamiko' : 'grievance details';
  }
  if (key === 'unit_id') {
    return locale === 'sw' ? 'eneo' : 'location';
  }
  const text = coerceIntakeString(val) ?? String(val);
  if (text.length > 60) return `${label}: ${text.slice(0, 57)}...`;
  return `${label}: ${text}`;
}

async function applyNarrativeAndExtraction(
  tenantId: string,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  narrative: string,
  proposed: Record<string, unknown>,
  locale: string,
): Promise<void> {
  const trimmed = narrative.trim();
  slots.proposed = { ...slots.proposed, narrative: trimmed, ...proposed };

  const intakeKeys = [
    'summary',
    'description',
    'categories',
    'name',
    'phone',
    'email',
    'date_occurred',
    'expected_outcome',
  ] as const;
  for (const key of intakeKeys) {
    const val = proposed[key];
    if (key === 'description' || fieldIsEmpty(key, val) || !fieldIsEmpty(key, slots.confirmed[key])) continue;
    slots.confirmed[key] = key === 'categories' ? coerceIntakeStringArray(val) : String(val).trim();
  }

  if (trimmed) {
    slots.confirmed.description = trimmed;
  }
  if (fieldIsEmpty('summary', slots.confirmed.summary)) {
    const fromAi = coerceIntakeString(proposed.summary);
    const desc = coerceIntakeString(slots.confirmed.description) ?? trimmed;
    slots.confirmed.summary = fromAi ?? summarizeFromText(desc);
  }

  if (fieldIsEmpty('unit_id', slots.confirmed.unit_id) && proposed.unit_hint) {
    const resolved = await resolveFieldValue(
      tenantId,
      form,
      taxonomy,
      'unit_id',
      String(proposed.unit_hint),
      locale,
    );
    if (resolved.ok) {
      slots.confirmed.unit_id = resolved.value;
    } else {
      slots.proposed.unit_hint = proposed.unit_hint;
    }
  }

  if (slots.anonymous === true) {
    for (const key of ['name', 'phone', 'email'] as const) {
      delete slots.confirmed[key];
    }
  }
}

function buildIntakeCollectionReply(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  locale: string,
): string {
  const missing = pendingFields(slots);
  const first = missing[0]!;
  const captured: string[] = [];
  for (const key of slots.field_queue) {
    if (fieldIsEmpty(key, slots.confirmed[key])) continue;
    captured.push(formatCapturedValue(form, taxonomy, key, slots.confirmed[key], locale));
  }

  const needLabels = missing.map((key) => fieldLabel(form, key, locale));
  const ack =
    locale === 'sw'
      ? 'Asante — nimeelewa malalamiko yako.'
      : "Thanks — I've read your grievance and filled in what I could.";
  let message = ack;
  if (captured.length) {
    message +=
      locale === 'sw'
        ? `\n\nNimeandika: ${captured.join('; ')}.`
        : `\n\nI noted: ${captured.join('; ')}.`;
  }
  message +=
    locale === 'sw'
      ? `\n\nBado ninahitaji: ${needLabels.join(', ')}.`
      : `\n\nI still need: ${needLabels.join(', ')}.`;
  message += `\n\n${promptForField(form, taxonomy, first, locale)}`;
  return message;
}

function beginFieldCollection(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  channelMinimum: string[],
  locale: string,
): { phase: string; readback: boolean; reply: string } {
  const anonymous = slots.anonymous === true;
  slots.field_queue = buildFieldQueue(form, channelMinimum, anonymous);
  const missing = pendingFields(slots);
  if (missing.length === 0) {
    return {
      phase: 'file_readback',
      readback: true,
      reply: readBackText(form, taxonomy, slots, locale),
    };
  }
  return {
    phase: 'file_collect',
    readback: false,
    reply: buildIntakeCollectionReply(form, taxonomy, slots, locale),
  };
}

function promptForField(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  key: string,
  locale: string,
): string {
  const label = fieldLabel(form, key, locale);
  if (key === 'unit_id') {
    return `Which settlement or location does this relate to? Type the name to search.\n(${label})`;
  }
  if (key === 'categories') {
    const cats = taxonomy.categories
      .filter((c) => c.active !== false)
      .slice(0, 12)
      .map((c, i) => `${i + 1}. ${c.label[locale] ?? c.label.en ?? c.code} (${c.code})`)
      .join('\n');
    return `Please choose a category (reply with number or code):\n${cats}`;
  }
  if (key === 'description' || key === 'summary' || key === 'expected_outcome') {
    return `Please provide ${label.toLowerCase()}:`;
  }
  return `Please provide your ${label.toLowerCase()}:`;
}

async function resolveFieldValue(
  tenantId: string,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  key: string,
  text: string,
  locale: string,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const field = form.fields.find((f) => f.key === key);
  if (key === 'unit_id') {
    const units = await searchIntakeUnits(tenantId, { q: text.trim(), limit: 5 });
    if (units.length === 0) {
      return { ok: false, message: 'I could not find that location. Please try a different spelling.' };
    }
    if (units.length === 1) {
      return { ok: true, value: units[0]!.id };
    }
    const list = units.map((u, i) => `${i + 1}. ${u.breadcrumb}`).join('\n');
    return {
      ok: false,
      message: `I found several locations. Please reply with the number:\n${list}`,
    };
  }
  if (key === 'categories' || field?.type === 'multiselect') {
    const t = text.trim();
    const byNum = Number.parseInt(t, 10);
    const active = taxonomy.categories.filter((c) => c.active !== false);
    if (!Number.isNaN(byNum) && byNum >= 1 && byNum <= active.length) {
      return { ok: true, value: [active[byNum - 1]!.code] };
    }
    const match = active.find((c) => c.code.toLowerCase() === t.toLowerCase());
    if (match) return { ok: true, value: [match.code] };
    return { ok: false, message: 'Please choose a valid category number or code from the list.' };
  }
  if (!text.trim()) {
    return { ok: false, message: 'Please enter a value.' };
  }
  return { ok: true, value: text.trim() };
}

function readBackText(form: Cd06IntakeForms, taxonomy: Cd03Taxonomy, slots: ChatbotSlotsState, locale: string): string {
  const lines: string[] = ['Please review your grievance before submitting:\n'];
  for (const key of slots.field_queue) {
    const val = slots.confirmed[key];
    if (val === undefined || val === '') continue;
    const label = fieldLabel(form, key, locale);
    if (key === 'categories') {
      const codes = coerceIntakeStringArray(val);
      const names = codes.map((code) => {
        const c = taxonomy.categories.find((x) => x.code === code);
        return c?.label[locale] ?? c?.label.en ?? code;
      });
      lines.push(`• ${label}: ${names.join(', ')}`);
    } else if (key === 'unit_id') {
      lines.push(`• ${label}: (selected location)`);
    } else {
      lines.push(`• ${label}: ${String(val)}`);
    }
  }
  if (slots.anonymous) lines.push('• Submitted anonymously');
  lines.push('\nIf this looks correct, use the Submit button below. To change something, tell me which field to update.');
  return lines.join('\n');
}

async function hotlineMessage(tenantId: string, locale: string): Promise<string> {
  const [cd08, identity] = await Promise.all([
    getActiveConfig<Cd08Channels>(tenantId, 'cd08_channels'),
    getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity'),
  ]);
  const hotline = cd08?.public_channels?.find((c) => c.type === 'hotline' && c.enabled && c.show_on_portal);
  const name = identity?.name ?? 'GRM';
  if (hotline?.value) {
    return locale === 'sw'
      ? `Tafadhali wasiliana na ${name} kwa simu ${hotline.value}. Afisa atakusaidia.`
      : `Please contact ${name} by phone at ${hotline.value}. An officer will assist you.`;
  }
  return locale === 'sw'
    ? 'Tafadhali wasiliana na ofisi ya GRM iliyo karibu nawe.'
    : 'Please contact your nearest GRM office for assistance.';
}

async function answerFaq(tenantId: string, cd16: Cd16Ai, query: string, locale: string): Promise<string> {
  const identity = await getActiveConfig<Cd01Identity>(tenantId, 'cd01_identity');
  const faq = identity?.faq ?? [];
  const q = query.toLowerCase();
  for (const item of faq) {
    const question = item.question[locale] ?? item.question.en ?? '';
    if (question && q.includes(question.toLowerCase().slice(0, 20))) {
      return item.answer[locale] ?? item.answer.en ?? '';
    }
  }
  const profileRef = resolveChatbotProfile(cd16);
  if (profileRef && cd16.capabilities.kb_answer_assist?.enabled) {
    try {
      const prompt = [
        'Answer the complainant FAQ briefly using only general GRM process knowledge.',
        'If unsure, say you do not know and suggest talking to an officer.',
        'Return JSON: { "answer": "..." }',
        `Question: ${query}`,
      ].join('\n');
      const result = await chatCompletion(
        profileRef.profile,
        [
          { role: 'system', content: 'Respond with JSON only.' },
          { role: 'user', content: prompt },
        ],
        { json_mode: true },
      );
      const parsed = z.object({ answer: z.string() }).parse(parseJsonFromModel(result.content));
      await db.insert(schema.aiInteraction).values({
        tenantId,
        capability: 'kb_answer_assist',
        providerProfileId: profileRef.key,
        model: profileRef.profile.default_model,
        inputHash: hashRedactedPrompt([query]),
        suggestion: { answer: parsed.answer, source: 'chatbot' },
        status: 'completed',
        decision: 'accepted',
        latencyMs: result.latency_ms,
      });
      return parsed.answer;
    } catch {
      // fall through
    }
  }
  return locale === 'sw'
    ? 'Samahani, sina jibu la uhakika kwa swali hilo. Unaweza kuwasiliana na afisa.'
    : "I'm not sure about that. You can talk to an officer for help.";
}

async function extractFromNarrative(
  tenantId: string,
  sessionId: string,
  cd16: Cd16Ai,
  narrative: string,
  taxonomy: Cd03Taxonomy,
  anonymous: boolean,
): Promise<{ proposed: Record<string, unknown>; sensitivity: boolean }> {
  const profileRef = resolveChatbotProfile(cd16);
  if (!profileRef) return { proposed: {}, sensitivity: false };

  const redacted = redactIntakeText(narrative, cd16.safety);
  const categoryLines = taxonomy.categories
    .filter((c) => c.active !== false)
    .map((c) => `- ${c.code}: ${c.label.en ?? c.code}`)
    .join('\n');
  const contactHint = anonymous
    ? 'Do not extract name, phone, or email for anonymous submissions.'
    : 'Extract name, phone, or email only when clearly stated in the narrative.';
  const prompt = [
    'You triage and extract grievance intake fields from a complainant narrative.',
    'Return ONLY JSON with these keys (omit keys not present in the text):',
    '{',
    '  "summary": "short title, max 120 chars",',
    '  "description": "structured restatement if helpful; otherwise omit",',
    '  "categories": ["code"],',
    '  "unit_hint": "settlement, village, or location name if mentioned",',
    '  "name": "complainant name if stated",',
    '  "phone": "phone if stated",',
    '  "email": "email if stated",',
    '  "date_occurred": "ISO date or natural date if stated",',
    '  "expected_outcome": "desired resolution if stated",',
    '  "sensitivity_signal": false',
    '}',
    '',
    'Set sensitivity_signal true only for imminent harm, violence, or serious safety threats.',
    contactHint,
    '',
    `Allowed category codes:\n${categoryLines}`,
    '',
    'Narrative:',
    redacted,
  ].join('\n');

  try {
    const result = await chatCompletion(
      profileRef.profile,
      [
        { role: 'system', content: 'Extract and triage intake fields. JSON only.' },
        { role: 'user', content: prompt },
      ],
      { json_mode: true },
    );
    const parsed = extractSchema.parse(parseJsonFromModel(result.content));
    const proposed: Record<string, unknown> = {};
    if (parsed.summary) proposed.summary = parsed.summary.trim();
    if (parsed.description) proposed.description = parsed.description.trim();
    if (parsed.categories?.length) {
      const allowed = new Set(taxonomy.categories.map((c) => c.code));
      proposed.categories = parsed.categories.filter((c) => allowed.has(c));
    }
    if (parsed.unit_hint) proposed.unit_hint = parsed.unit_hint.trim();
    if (parsed.name) proposed.name = parsed.name.trim();
    if (parsed.phone) proposed.phone = parsed.phone.trim();
    if (parsed.email) proposed.email = parsed.email.trim();
    if (parsed.date_occurred) proposed.date_occurred = parsed.date_occurred.trim();
    if (parsed.expected_outcome) proposed.expected_outcome = parsed.expected_outcome.trim();

    await db.insert(schema.aiInteraction).values({
      tenantId,
      chatbotSessionId: sessionId,
      capability: 'chatbot_extract',
      providerProfileId: profileRef.key,
      model: profileRef.profile.default_model,
      inputHash: hashRedactedPrompt([redacted]),
      suggestion: { proposed, sensitivity_signal: parsed.sensitivity_signal ?? false },
      status: 'completed',
      decision: 'pending',
      latencyMs: result.latency_ms,
    });

    return { proposed, sensitivity: parsed.sensitivity_signal === true };
  } catch {
    return { proposed: {}, sensitivity: false };
  }
}

async function loadSession(tenantId: string, sessionId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select()
    .from(schema.chatbotSession)
    .where(and(eq(schema.chatbotSession.tenantId, tenantId), eq(schema.chatbotSession.id, sessionId)))
    .limit(1);
  return row ?? null;
}

async function saveSession(
  session: SessionRow,
  patch: Partial<{
    intent: string | null;
    phase: string;
    slots: ChatbotSlotsState;
    transcript: TranscriptEntry[];
    caseId: string | null;
    handoffReason: string | null;
    sensitivityFlagged: boolean;
    endedAt: Date | null;
    locale: string;
  }>,
): Promise<SessionRow> {
  const [updated] = await db
    .update(schema.chatbotSession)
    .set({
      intent: patch.intent !== undefined ? patch.intent : session.intent,
      phase: patch.phase ?? session.phase,
      slots: patch.slots ? slotsToJson(patch.slots) : session.slots,
      transcript: patch.transcript ?? session.transcript,
      caseId: patch.caseId !== undefined ? patch.caseId : session.caseId,
      handoffReason: patch.handoffReason !== undefined ? patch.handoffReason : session.handoffReason,
      sensitivityFlagged: patch.sensitivityFlagged ?? session.sensitivityFlagged,
      endedAt: patch.endedAt !== undefined ? patch.endedAt : session.endedAt,
      locale: patch.locale ?? session.locale,
    })
    .where(eq(schema.chatbotSession.id, session.id))
    .returning();
  return updated!;
}

function appendTranscript(transcript: TranscriptEntry[], role: 'user' | 'assistant', text: string): TranscriptEntry[] {
  return [...transcript, { role, text, at: nowIso() }];
}

export async function getChatbotMeta(tenantId: string): Promise<
  | { enabled: false; reason: string }
  | { enabled: true; persona: string; locales: string[]; disclosure_text: string }
> {
  const cfg = await loadChatbotConfig(tenantId);
  if (!cfg.ready || !cfg.cd16) {
    return { enabled: false, reason: cfg.reason ?? 'chatbot_disabled' };
  }
  return {
    enabled: true,
    persona: cfg.cd16.chatbot.persona.name,
    locales: cfg.cd16.chatbot.locales,
    disclosure_text: disclosureText(cfg.cd16, cfg.cd16.chatbot.locales[0] ?? 'en'),
  };
}

export async function createChatbotSession(
  tenantId: string,
  locale?: string,
): Promise<
  | { ok: false; code: number; error: string }
  | {
      ok: true;
      session_id: string;
      disclosure_text: string;
      persona: string;
      intents: { id: string; label: string }[];
      replies: string[];
    }
> {
  const cfg = await loadChatbotConfig(tenantId);
  if (!cfg.ready || !cfg.cd16) {
    return { ok: false, code: 503, error: cfg.reason ?? 'chatbot_disabled' };
  }

  const loc = locale && cfg.cd16.chatbot.locales.includes(locale) ? locale : cfg.cd16.chatbot.locales[0] ?? 'en';
  const disclosure = disclosureText(cfg.cd16, loc);
  const welcome = intentMenu(cfg.cd16, loc);
  const transcript: TranscriptEntry[] = [
    { role: 'assistant', text: disclosure, at: nowIso() },
    { role: 'assistant', text: welcome, at: nowIso() },
  ];

  const [row] = await db
    .insert(schema.chatbotSession)
    .values({
      tenantId,
      channel: 'web_widget',
      locale: loc,
      phase: 'choose_intent',
      slots: slotsToJson({
        proposed: {},
        confirmed: {},
        anonymous: null,
        consent: false,
        field_queue: [],
      }),
      transcript,
    })
    .returning();

  const intents = cfg.cd16.chatbot.allowed_intents.map((id) => ({
    id,
    label: INTENT_LABELS[id]?.[loc] ?? INTENT_LABELS[id]?.en ?? id,
  }));

  return {
    ok: true,
    session_id: row!.id,
    disclosure_text: disclosure,
    persona: cfg.cd16.chatbot.persona.name,
    intents,
    replies: [disclosure, welcome],
  };
}

export async function handleChatbotMessage(
  tenantId: string,
  sessionId: string,
  text: string,
  locale?: string,
): Promise<
  | { ok: false; code: number; error: string }
  | {
      ok: true;
      replies: string[];
      slots?: ChatbotSlotsState;
      handoff?: boolean;
      done?: boolean;
      readback?: boolean;
    }
> {
  const cfg = await loadChatbotConfig(tenantId);
  if (!cfg.ready || !cfg.cd16) {
    return { ok: false, code: 503, error: cfg.reason ?? 'chatbot_disabled' };
  }

  let session = await loadSession(tenantId, sessionId);
  if (!session || session.endedAt) {
    return { ok: false, code: 404, error: 'session_not_found' };
  }

  const loc = locale && cfg.cd16.chatbot.locales.includes(locale) ? locale : session.locale;
  let transcript = appendTranscript(session.transcript as TranscriptEntry[], 'user', text);
  let slots = parseSlots(session.slots as Record<string, unknown>);
  const replies: string[] = [];

  const [formRaw, taxonomy] = await Promise.all([
    getActiveConfig<Cd06IntakeForms>(tenantId, 'cd06_intake_forms'),
    getActiveConfig<Cd03Taxonomy>(tenantId, 'cd03_taxonomy'),
  ]);
  const form = formRaw ? normalizeCd06IntakeForms(formRaw) : null;
  if (!form || !taxonomy) {
    return { ok: false, code: 503, error: 'tenant_not_configured' };
  }

  const cd16 = cfg.cd16;
  let phase = session.phase;
  let intent = session.intent;
  let handoff = false;
  let done = false;
  let readback = false;
  let sensitivityFlagged = session.sensitivityFlagged;

  if (phase === 'choose_intent') {
    const picked = parseIntent(text, cd16.chatbot.allowed_intents);
    if (!picked) {
      replies.push("I didn't catch that. " + intentMenu(cd16, loc));
    } else {
      intent = picked;
      if (picked === 'file_case') {
        phase = form.anonymous_allowed ? 'file_anonymous' : 'file_narrative';
        replies.push(
          form.anonymous_allowed
            ? loc === 'sw'
              ? 'Je, ungependa kuwasilisha bila kutambulika? (ndio/hapana)'
              : 'Would you like to submit anonymously? (yes/no)'
            : loc === 'sw'
              ? 'Eleza malalamiko yako kwa maneno yako mwenyewe.'
              : 'Please describe your grievance in your own words.',
        );
      } else if (picked === 'check_status') {
        phase = 'status_reference';
        replies.push(
          loc === 'sw'
            ? 'Tafadhali weka nambari ya rejeleo la kesi yako (mfano GRM-2026-0001).'
            : 'Please enter your case reference (e.g. GRM-2026-0001).',
        );
      } else if (picked === 'kb_faq') {
        phase = 'faq';
        const answer = await answerFaq(tenantId, cd16, text, loc);
        replies.push(answer);
        replies.push(intentMenu(cd16, loc));
        phase = 'choose_intent';
        intent = null;
      } else if (picked === 'handoff') {
        phase = 'handoff';
        handoff = true;
        replies.push(await hotlineMessage(tenantId, loc));
        done = true;
      }
    }
  } else if (phase === 'file_anonymous') {
    if (isYes(text)) {
      slots.anonymous = true;
      phase = 'file_narrative';
      replies.push(
        loc === 'sw' ? 'Eleza malalamiko yako kwa maneno yako mwenyewe.' : 'Please describe your grievance in your own words.',
      );
    } else if (isNo(text)) {
      slots.anonymous = false;
      phase = 'file_narrative';
      replies.push(
        loc === 'sw' ? 'Eleza malalamiko yako kwa maneno yako mwenyewe.' : 'Please describe your grievance in your own words.',
      );
    } else {
      replies.push(loc === 'sw' ? 'Tafadhali jibu ndio au hapana.' : 'Please answer yes or no.');
    }
  } else if (phase === 'file_narrative') {
    const anonymous = slots.anonymous === true;
    const { proposed, sensitivity } = await extractFromNarrative(
      tenantId,
      sessionId,
      cd16,
      text,
      taxonomy,
      anonymous,
    );
    if (sensitivity) {
      sensitivityFlagged = true;
      phase = 'handoff';
      handoff = true;
      replies.push(
        loc === 'sw'
          ? 'Asante kwa kushiriki. Kwa usalama wako, tafadhali zungumza na afisa moja kwa moja.'
          : 'Thank you for sharing. For your safety, please speak with an officer directly.',
      );
      replies.push(await hotlineMessage(tenantId, loc));
      done = true;
    } else {
      await applyNarrativeAndExtraction(tenantId, form, taxonomy, slots, text, proposed, loc);
      if (!slots.consent && !anonymous && form.consent_text) {
        phase = 'file_consent';
        const consentMsg = form.consent_text[loc] ?? form.consent_text.en ?? Object.values(form.consent_text)[0];
        replies.push(consentMsg ?? (loc === 'sw' ? 'Je, unakubali masharti ya usindikaji? (ndio/hapana)' : 'Do you consent to processing? (yes/no)'));
      } else {
        const nextStep = beginFieldCollection(form, taxonomy, slots, cd16.chatbot.channel_minimum.fields, loc);
        phase = nextStep.phase;
        readback = nextStep.readback;
        replies.push(nextStep.reply);
      }
    }
  } else if (phase === 'file_consent') {
    if (isYes(text)) {
      slots.consent = true;
      const nextStep = beginFieldCollection(form, taxonomy, slots, cd16.chatbot.channel_minimum.fields, loc);
      phase = nextStep.phase;
      readback = nextStep.readback;
      replies.push(nextStep.reply);
    } else if (isNo(text)) {
      replies.push(
        loc === 'sw'
          ? 'Bila idhini hatuwezi kuendelea. Unaweza kuwasiliana na afisa.'
          : 'Without consent we cannot continue. You may contact an officer.',
      );
      phase = 'handoff';
      handoff = true;
      done = true;
    } else {
      replies.push(loc === 'sw' ? 'Tafadhali jibu ndio au hapana.' : 'Please answer yes or no.');
    }
  } else if (phase === 'file_collect') {
    const current = pendingFields(slots)[0];
    if (!current) {
      phase = 'file_readback';
      readback = true;
      replies.push(readBackText(form, taxonomy, slots, loc));
    } else {
      const numPick = Number.parseInt(text.trim(), 10);
      if (current === 'unit_id' && !Number.isNaN(numPick) && numPick >= 1) {
        const units = await searchIntakeUnits(tenantId, { limit: 5 });
        const unit = units[numPick - 1];
        if (unit) {
          slots.confirmed.unit_id = unit.id;
        } else {
          const resolved = await resolveFieldValue(tenantId, form, taxonomy, current, text, loc);
          if (!resolved.ok) {
            replies.push(resolved.message);
          } else {
            slots.confirmed[current] = resolved.value;
          }
        }
      } else {
        const resolved = await resolveFieldValue(tenantId, form, taxonomy, current, text, loc);
        if (!resolved.ok) {
          replies.push(resolved.message);
        } else {
          slots.confirmed[current] = resolved.value;
        }
      }
      if (pendingFields(slots).length === 0) {
        phase = 'file_readback';
        readback = true;
        replies.push(readBackText(form, taxonomy, slots, loc));
      } else if (replies.length === 0 || !replies[replies.length - 1]!.startsWith('I found')) {
        const next = pendingFields(slots)[0];
        if (next && phase === 'file_collect') {
          replies.push(promptForField(form, taxonomy, next, loc));
        }
      }
    }
  } else if (phase === 'file_readback') {
    replies.push(
      loc === 'sw'
        ? 'Tafadhali tumia kitufe cha Wasilisha hapa chini, au niambie ni sehemu gani ungependa kubadilisha.'
        : 'Use the Submit button below when ready, or tell me which field to change.',
    );
    readback = true;
  } else if (phase === 'status_reference') {
    slots.status_reference = text.trim();
    phase = 'status_verifier';
    replies.push(
      loc === 'sw'
        ? 'Tafadhali weka nambari ya simu, barua pepe, au PIN uliyopokea wakati wa kuwasilisha.'
        : 'Please enter the phone, email, or PIN you used when submitting.',
    );
  } else if (phase === 'status_verifier') {
    const ref = slots.status_reference ?? '';
    const verified = await verifyCaseByReference(tenantId, ref, text.trim());
    if (!verified) {
      replies.push(
        loc === 'sw'
          ? 'Haiwezekani kuthibitisha kesi hiyo. Angalia rejeleo na uthibitisho.'
          : 'Could not verify that case. Check your reference and verifier.',
      );
    } else {
      phase = 'status_done';
      done = true;
      replies.push(
        loc === 'sw'
          ? `Kesi ${verified.case.reference} iko katika hali: ${verified.case.status}.`
          : `Case ${verified.case.reference} is currently: ${verified.case.status}.`,
      );
      replies.push(intentMenu(cd16, loc));
      phase = 'choose_intent';
      intent = null;
      slots = parseSlots({});
    }
  } else if (phase === 'faq') {
    const answer = await answerFaq(tenantId, cd16, text, loc);
    replies.push(answer);
    replies.push(intentMenu(cd16, loc));
    phase = 'choose_intent';
    intent = null;
  } else {
    replies.push(intentMenu(cd16, loc));
    phase = 'choose_intent';
  }

  for (const r of replies) {
    transcript = appendTranscript(transcript, 'assistant', r);
  }

  session = await saveSession(session, {
    intent,
    phase,
    slots,
    transcript,
    handoffReason: handoff ? 'user_requested' : session.handoffReason,
    sensitivityFlagged,
    endedAt: done && handoff ? new Date() : null,
    locale: loc,
  });

  return {
    ok: true,
    replies,
    slots,
    handoff: handoff || undefined,
    done: done || undefined,
    readback: readback || undefined,
  };
}

export async function confirmChatbotSession(
  tenantId: string,
  sessionId: string,
  body: { slots?: Record<string, unknown>; submit: boolean; anonymous?: boolean; consent?: boolean },
): Promise<
  | { ok: false; code: number; error: string; message?: string; details?: unknown }
  | { ok: true; case_id?: string; reference?: string; tracking_pin?: string; requires_completion?: boolean }
> {
  const cfg = await loadChatbotConfig(tenantId);
  if (!cfg.ready || !cfg.cd16) {
    return { ok: false, code: 503, error: cfg.reason ?? 'chatbot_disabled' };
  }

  let session = await loadSession(tenantId, sessionId);
  if (!session || session.endedAt) {
    return { ok: false, code: 404, error: 'session_not_found' };
  }

  let slots = parseSlots(session.slots as Record<string, unknown>);
  if (body.anonymous !== undefined) slots.anonymous = body.anonymous;
  if (body.consent !== undefined) slots.consent = body.consent;
  if (body.slots) {
    slots.confirmed = { ...slots.confirmed, ...body.slots };
  }

  if (!body.submit) {
    await saveSession(session, { slots });
    return { ok: true };
  }

  if (session.intent !== 'file_case') {
    return {
      ok: false,
      code: 422,
      error: 'not_ready_to_submit',
      message: 'Start a grievance in the chat before submitting.',
    };
  }

  if (session.phase !== 'file_readback') {
    return {
      ok: false,
      code: 422,
      error: 'not_ready_to_submit',
      message: 'Complete all questions and review the summary before submitting.',
    };
  }

  const values: Record<string, unknown> = { ...slots.confirmed };
  const anonymous = slots.anonymous === true;

  if (!anonymous && !slots.consent) {
    const name = coerceIntakeString(values.name);
    const phone = coerceIntakeString(values.phone);
    const email = coerceIntakeString(values.email);
    if (name || phone || email) {
      return {
        ok: false,
        code: 422,
        error: 'consent_required',
        message: 'Please confirm consent in the chat before submitting.',
      };
    }
  }
  const result = await createCase({
    tenantId,
    channel: 'chatbot',
    anonymous,
    consent: slots.consent,
    values,
  });

  if (!result.ok) {
    const missing = (result.details as { fields?: string[] } | undefined)?.fields;
    const message =
      result.error === 'missing_required_fields' && missing?.length
        ? `Missing required fields: ${missing.join(', ')}`
        : result.error === 'notification_channels_required'
          ? 'A contact phone or email is required to receive updates.'
          : result.error === 'consent_required'
            ? 'Consent is required before we can process your details.'
            : result.error === 'unknown_unit'
              ? 'The selected location is invalid — please pick your settlement again.'
              : result.message;
    return {
      ok: false,
      code: result.code,
      error: result.error,
      message,
      details: result.details,
    };
  }

  let transcript = session.transcript as TranscriptEntry[];
  const ack =
    session.locale === 'sw'
      ? `Malalamiko yako yamepokelewa. Rejeleo: ${result.reference}. Hifadhi nambari hii kwa kufuatilia.`
      : `Your grievance has been registered. Reference: ${result.reference}. Keep this number to track progress.`;
  if (result.trackingPin) {
    transcript = appendTranscript(
      transcript,
      'assistant',
      session.locale === 'sw'
        ? `PIN yako ya kufuatilia (onyeshwa mara moja tu): ${result.trackingPin}`
        : `Your tracking PIN (shown once): ${result.trackingPin}`,
    );
  }
  transcript = appendTranscript(transcript, 'assistant', ack);

  await saveSession(session, {
    slots,
    transcript,
    caseId: result.caseId,
    phase: 'file_done',
    endedAt: new Date(),
  });

  await db.insert(schema.caseEvent).values({
    tenantId,
    caseId: result.caseId,
    kind: 'note_internal',
    actorType: 'system',
    visibility: 'internal',
    data: {
      body: 'Chatbot intake transcript attached to session',
      chatbot_session_id: sessionId,
    },
  });

  return {
    ok: true,
    case_id: result.caseId,
    reference: result.reference,
    tracking_pin: result.trackingPin,
    requires_completion: false,
  };
}
