import { z } from 'zod';
import type { Cd06IntakeForms, Cd03Taxonomy, Cd16Ai } from '@egrm/config-schemas';
import { db, schema } from '../db/client.js';
import { chatCompletion } from './ai-completion.js';
import { hashRedactedPrompt, isRedactionPlaceholder, redactIntakeText, containsRedactionPlaceholders } from './ai-redaction.js';
import { parseJsonFromModel } from './ai-shared.js';
import { coerceIntakeStringArray, coerceIntakeString, formatIntakeDate, parseIntakeDate } from './intake-values.js';
import { resolveIntakeUnitQuery, resolveIntakeUnitFromContent, type IntakeUnitSearchResult, type IntakeUnitResolveResult } from './intake-units.js';

export type TranscriptEntry = { role: 'user' | 'assistant'; text: string; at: string };

export interface ChatbotSlotsState {
  proposed: Record<string, unknown>;
  confirmed: Record<string, unknown>;
  anonymous: boolean | null;
  consent: boolean;
  field_queue: string[];
  status_reference?: string;
}

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

export function parseSlots(raw: Record<string, unknown>): ChatbotSlotsState {
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

export function slotsToJson(slots: ChatbotSlotsState): Record<string, unknown> {
  return { ...slots };
}

export function resolveChatbotProfile(
  cd16: Cd16Ai,
): { key: string; profile: Cd16Ai['provider_profiles'][string] } | null {
  const key =
    cd16.chatbot.profile ??
    Object.entries(cd16.provider_profiles).find(([, p]) => p.enabled)?.[0];
  if (!key) return null;
  const profile = cd16.provider_profiles[key];
  if (!profile?.enabled) return null;
  return { key, profile };
}

export function fieldLabel(form: Cd06IntakeForms, key: string, locale: string): string {
  const field = form.fields.find((f) => f.key === key);
  const label = field?.label;
  if (!label) return key.replaceAll('_', ' ');
  return label[locale] ?? label.en ?? Object.values(label)[0] ?? key;
}

export function buildFieldQueue(
  form: Cd06IntakeForms,
  channelMinimum: string[],
  anonymous: boolean,
): string[] {
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

export function fieldIsEmpty(key: string, val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (typeof val === 'string' && isRedactionPlaceholder(val)) return true;
  if (key === 'categories') return coerceIntakeStringArray(val).length === 0;
  return false;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('254')) return `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('7')) return `0${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length >= 9 && digits.length <= 15) return digits;
  return null;
}

/** Extract phone from raw text before PII redaction (redaction strips phones from LLM prompts). */
export function extractPhoneFromText(text: string): string | null {
  const labeled = text.match(/(?:phone|simu|mobile|tel)\s*[:：\-–—]?\s*([+\d\s().-]{9,18})/i);
  if (labeled?.[1]) {
    const normalized = normalizePhone(labeled[1]);
    if (normalized) return normalized;
  }
  const patterns = [
    /\b(?:\+254|254)[\s-]?7[\d\s().-]{7,10}\d\b/g,
    /\b07[\d\s().-]{7,10}\d\b/g,
    /\b0\d{9}\b/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      const normalized = normalizePhone(match[0]);
      if (normalized) return normalized;
    }
  }
  return null;
}

/** Extract complainant name from natural phrasing (runs on raw text, not redacted). */
export function extractNameFromText(text: string): string | null {
  const patterns = [
    /(?:my name is|i am|i'm|call me|jina langu ni|jina ni)\s+([A-Za-z][A-Za-z\s'.-]{1,50}?)(?=\s*,|\s+phone|\s+simu|\s+from|\s+in|\s+at|\s+near|\.|$)/i,
    /(?:full\s+name|name|jina)\s*[:：\-–—]\s*([^,\n]+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]?.trim()) continue;
    const name = m[1]
      .trim()
      .replace(/\s+(phone|simu|from|in|at|near)$/i, '')
      .trim();
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 5 && name.length >= 4) return name;
  }
  return null;
}

/** Best settlement / location hint from free text. */
export function extractLocationHintFromText(text: string): string | null {
  const labeled = text.match(
    /(?:settle+e?m+e?nt|location|makazi|eneo|ward|county)\s*[:：\-–—]\s*([^,\n]+)/i,
  );
  if (labeled?.[1]?.trim()) return labeled[1].trim();

  const fromPlace = text.match(
    /\b(?:from|in|at|near|around|within)\s+([^,\n.]{3,80}?(?:settlement|county|ward|estate|village|slum|makazi)[^,\n.]*)/i,
  );
  if (fromPlace?.[1]?.trim()) return fromPlace[1].trim();

  const phrases = extractPlacePhrases(text);
  const settlementLike = phrases.find((p) =>
    /settlement|county|ward|estate|village|slum|makazi/i.test(p),
  );
  if (settlementLike) return settlementLike;

  return phrases.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function detectConsent(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (/^(yes|y|ok|okay|sure|ndio|nakubali|ninakubali)$/.test(t)) return true;
  if (/consen/i.test(t)) return true;
  if (/\bi\s+(?:do\s+)?(?:consent|agree)/i.test(t)) return true;
  if (/\bi\s+give\s+consent/i.test(t)) return true;
  return false;
}

/** User lines that collect intake fields — not the grievance narrative itself. */
export function isIntakeMetadataReply(text: string): boolean {
  const t = text.trim();
  if (!t) return true;

  const hasContact =
    Boolean(extractNameFromText(t)) ||
    Boolean(extractPhoneFromText(t)) ||
    Boolean(extractLocationHintFromText(t));
  const hasGrievance =
    t.length >= 80 ||
    /\b(?:trench|contractor|footpath|barrier|injur|children|elderly|weeks|reported|sewage|overflow|water|road|corrupt|harass|compensat|griev|malalam|problem|issue|damage|project|kisip)\b/i.test(
      t,
    );
  if (hasContact && hasGrievance) return false;

  if (
    t.length >= 50 &&
    /\b(?:sewage|overflow|water|road|corrupt|harass|compensat|griev|malalam|problem|issue|damage|project|kisip)\b/i.test(t)
  ) {
    return false;
  }

  if (detectConsent(t)) return true;
  if (/^(yes|no|y|n|ndio|hapana|ok|okay)$/i.test(t)) return true;
  if (/^\d{1,2}$/.test(t)) return true;

  if (/(?:settle+e?m+e?nt|location|phone|simu|name|jina|email|full\s+name)\s*[:：]/i.test(t)) {
    return true;
  }
  if (/^settlement\s*\/?\s*location\b/i.test(t)) return true;

  const phone = extractPhoneFromText(t);
  if (phone && t.replace(/\s/g, '').length <= 16) return true;

  if (
    /^(?:thanks|got it|almost done|great|please review|i couldn'?t find|i found a few|i still need)/i.test(t)
  ) {
    return true;
  }

  return false;
}

/** Build grievance description from chat — exclude field-collection replies and bot echoes. */
export function buildGrievanceDescription(
  narrative: string,
  proposed: Record<string, unknown>,
  existing?: string,
): string {
  const fromAi = coerceIntakeString(proposed.description);
  if (
    fromAi &&
    fromAi.length >= 15 &&
    !containsRedactionPlaceholders(fromAi) &&
    !isIntakeMetadataReply(fromAi)
  ) {
    return fromAi;
  }

  const lines = narrative
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const substantive = lines.filter((l) => !isIntakeMetadataReply(l));

  if (substantive.length > 0) {
    return substantive.join('\n\n');
  }

  const longest = lines.reduce((best, line) => (line.length > best.length ? line : best), '');
  if (longest && !isIntakeMetadataReply(longest)) return longest;

  if (existing?.trim()) return existing.trim();
  return fromAi ?? '';
}

/** Parse labeled fields from chat messages (works on raw text, not redacted). */
export function extractLocalFieldsFromText(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!text.trim()) return out;

  const locationHint = extractLocationHintFromText(text);
  if (locationHint) out.unit_hint = locationHint;

  const phone = extractPhoneFromText(text);
  if (phone) out.phone = phone;

  const name = extractNameFromText(text);
  if (name) out.name = name;

  const emailMatch = text.match(
    /(?:email|barua pepe)\s*[:：\-–—]?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
  );
  if (emailMatch?.[1]) out.email = emailMatch[1].trim();

  return out;
}

export function extractLocalFieldsFromNarrative(narrative: string, latestText?: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const chunk of narrative.split('\n')) {
    for (const [k, v] of Object.entries(extractLocalFieldsFromText(chunk))) {
      if (v && !merged[k]) merged[k] = v;
    }
  }
  if (latestText?.trim()) {
    for (const [k, v] of Object.entries(extractLocalFieldsFromText(latestText))) {
      if (v) merged[k] = v;
    }
  }
  return merged;
}

export function mergeProposedWithLocal(
  proposed: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...proposed };
  const piiKeys = ['name', 'phone', 'email'] as const;

  for (const key of piiKeys) {
    if (isRedactionPlaceholder(merged[key])) delete merged[key];
  }

  for (const [k, v] of Object.entries(local)) {
    if (v !== undefined && v !== null && v !== '' && !isRedactionPlaceholder(v) && !merged[k]) {
      merged[k] = v;
    }
  }

  for (const key of piiKeys) {
    const localVal = local[key];
    if (localVal !== undefined && localVal !== null && localVal !== '' && !isRedactionPlaceholder(localVal)) {
      merged[key] = localVal;
    }
  }

  return merged;
}

function applyLocalContactFields(
  slots: ChatbotSlotsState,
  narrative: string,
  latestText?: string,
): void {
  const local = extractLocalFieldsFromNarrative(narrative, latestText);
  for (const key of ['name', 'phone', 'email'] as const) {
    const localVal = local[key];
    if (localVal && !isRedactionPlaceholder(localVal)) {
      slots.confirmed[key] = String(localVal).trim();
    } else if (isRedactionPlaceholder(slots.confirmed[key])) {
      delete slots.confirmed[key];
    }
  }
}

export function pendingFields(slots: ChatbotSlotsState): string[] {
  if (slots.field_queue.length) {
    return slots.field_queue.filter((k) => fieldIsEmpty(k, slots.confirmed[k]));
  }
  return [];
}

export function formatUnitOptionsList(units: IntakeUnitSearchResult[]): string {
  return units.map((u, i) => `${i + 1}. ${u.breadcrumb}`).join('\n');
}

export function tryPickUnitByNumber(
  slots: ChatbotSlotsState,
  text: string,
): string | null {
  const trimmed = text.trim();
  const numPick = Number.parseInt(trimmed, 10);
  if (Number.isNaN(numPick) || numPick < 1 || String(numPick) !== trimmed) return null;
  const ids = slots.proposed.unit_pick_options;
  if (!Array.isArray(ids)) return null;
  const id = ids[numPick - 1];
  return typeof id === 'string' ? id : null;
}

export function extractPlacePhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const m of text.matchAll(
    /\b(?:in|at|from|near|around|within)\s+([A-Za-z][A-Za-z\s'-]{2,40})/gi,
  )) {
    const p = m[1]?.trim().replace(/\s+(and|with|my|the|a)$/i, '').trim();
    if (p && p.length >= 3) phrases.push(p);
  }
  return phrases;
}

export function gatherLocationHints(
  latestText: string,
  proposed: Record<string, unknown>,
  slots: ChatbotSlotsState,
  narrative?: string,
): string[] {
  const hints: string[] = [];

  if (narrative?.trim()) {
    hints.push(narrative.trim());
    for (const line of narrative.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length >= 3) hints.push(trimmed);
      for (const phrase of extractPlacePhrases(trimmed)) hints.push(phrase);
    }
  }

  hints.push(
    latestText.trim(),
    typeof proposed.unit_hint === 'string' ? proposed.unit_hint.trim() : '',
    typeof slots.proposed.unit_hint === 'string' ? String(slots.proposed.unit_hint).trim() : '',
  );

  const local = extractLocalFieldsFromText(latestText);
  if (typeof local.unit_hint === 'string' && local.unit_hint.trim()) {
    hints.unshift(local.unit_hint.trim());
  }

  for (const phrase of extractPlacePhrases(latestText)) hints.push(phrase);

  return [...new Set(hints.filter((h) => h.length >= 2))];
}

export function promptForMissingField(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  key: string,
  locale: string,
): string {
  if (key === 'unit_id') {
    const labels = slots.proposed.unit_pick_labels;
    if (Array.isArray(labels) && labels.length) {
      const list = labels.map((label, i) => `${i + 1}. ${label}`).join('\n');
      const query = slots.proposed.unit_hint ?? 'that name';
      return locale === 'sw'
        ? `Sikuweza kupata "${query}" kwa uhakika. Je, unamaanisha mojawapo ya hizi?\n${list}\nJibu kwa nambari au jaribu jina lingine.`
        : `I couldn't match "${query}" exactly. Did you mean one of these?\n${list}\nReply with the number, or try the settlement name again.`;
    }
    return locale === 'sw'
      ? `Ni eneo/settlement gani? Andika jina kutafuta.\n(${fieldLabel(form, key, locale)})`
      : `Which settlement or location does this relate to? Type the name to search.\n(${fieldLabel(form, key, locale)})`;
  }
  if (key === 'categories') {
    const cats = taxonomy.categories
      .filter((c) => c.active !== false)
      .slice(0, 12)
      .map((c, i) => `${i + 1}. ${c.label[locale] ?? c.label.en ?? c.code} (${c.code})`)
      .join('\n');
    return locale === 'sw'
      ? `Tafadhali chagua aina (jibu kwa nambari au msimbo):\n${cats}`
      : `Please choose a category (reply with number or code):\n${cats}`;
  }
  const label = fieldLabel(form, key, locale);
  if (key === 'description' || key === 'summary' || key === 'expected_outcome') {
    return locale === 'sw' ? `Tafadhali toa ${label.toLowerCase()}:` : `Please provide ${label.toLowerCase()}:`;
  }
  return locale === 'sw' ? `Tafadhali toa ${label.toLowerCase()} yako:` : `Please provide your ${label.toLowerCase()}:`;
}

export function conversationalMissingReply(
  form: Cd06IntakeForms,
  slots: ChatbotSlotsState,
  locale: string,
  unitContext?: IntakeUnitResolveResult,
): string {
  const missing = pendingFields(slots);
  if (missing.length === 0) {
    return locale === 'sw'
      ? 'Asante — tafadhali kagua muhtasari na bofya Wasilisha.'
      : 'Thanks — please review the summary and tap Submit.';
  }

  if (missing.length === 1 && missing[0] === 'unit_id' && unitContext) {
    if (unitContext.status === 'not_found') {
      const list = formatUnitOptionsList(unitContext.suggestions);
      const query = unitContext.query || 'that name';
      return locale === 'sw'
        ? `Sikuweza kupata "${query}" kwenye orodha yetu. Je, unamaanisha mojawapo ya hizi?\n${list}\nJibu kwa nambari au jaribu jina lingine.`
        : `I couldn't find "${query}" in our settlements list. Did you mean one of these?\n${list}\nReply with the number, or try the settlement name again.`;
    }
    if (unitContext.status === 'ambiguous') {
      const list = formatUnitOptionsList(unitContext.options);
      return locale === 'sw'
        ? `Nimepata maeneo kadhaa yanayofanana — yapi?\n${list}\nJibu kwa nambari.`
        : `I found a few places that could match — which one is yours?\n${list}\nJust reply with the number.`;
    }
  }

  const labels = missing.map((k) => fieldLabel(form, k, locale).toLowerCase());
  if (labels.length === 1) {
    return locale === 'sw'
      ? `Asante — bado nahitaji ${labels[0]} yako tu.`
      : `Got it — I just need your ${labels[0]} to continue.`;
  }
  return locale === 'sw'
    ? `Asante kwa taarifa hizo. Bado nahitaji ${labels.join(' na ')}.`
    : `Thanks for that. I still need your ${labels.join(' and ')}.`;
}

export async function resolveUnitFromHints(
  tenantId: string,
  hints: string[],
  narrative?: string,
): Promise<IntakeUnitResolveResult | null> {
  const fullNarrative = [narrative, ...hints].filter(Boolean).join('\n');
  return resolveIntakeUnitFromContent(tenantId, fullNarrative, hints);
}

export function applyUnitResolution(
  slots: ChatbotSlotsState,
  result: IntakeUnitResolveResult,
): IntakeUnitResolveResult {
  if (result.status === 'resolved') {
    slots.confirmed.unit_id = result.unit.id;
    delete slots.proposed.unit_hint;
    delete slots.proposed.unit_pick_options;
    return result;
  }
  if (result.status === 'ambiguous') {
    slots.proposed.unit_pick_options = result.options.map((u) => u.id);
    slots.proposed.unit_pick_labels = result.options.map((u) => u.breadcrumb);
    slots.proposed.unit_hint = result.query;
    return result;
  }
  slots.proposed.unit_pick_options = result.suggestions.map((u) => u.id);
  slots.proposed.unit_pick_labels = result.suggestions.map((u) => u.breadcrumb);
  slots.proposed.unit_hint = result.query;
  return result;
}

export async function resolveUnitForTurn(
  tenantId: string,
  slots: ChatbotSlotsState,
  latestText: string,
  proposed: Record<string, unknown>,
  narrative?: string,
): Promise<IntakeUnitResolveResult | null> {
  if (!fieldIsEmpty('unit_id', slots.confirmed.unit_id)) return null;

  const pickedId = tryPickUnitByNumber(slots, latestText);
  if (pickedId) {
    slots.confirmed.unit_id = pickedId;
    delete slots.proposed.unit_pick_options;
    delete slots.proposed.unit_hint;
    return null;
  }

  const hints = gatherLocationHints(latestText, proposed, slots, narrative);
  const fullNarrative = [narrative, latestText].filter(Boolean).join('\n');
  const result = await resolveIntakeUnitFromContent(tenantId, fullNarrative, hints);
  if (result) applyUnitResolution(slots, result);
  return result;
}

function summarizeFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const first = trimmed.split(/[.!?\n]/).find((part) => part.trim().length > 0)?.trim() ?? trimmed;
  return first.length > 200 ? `${first.slice(0, 197)}...` : first;
}

export async function resolveFieldValue(
  tenantId: string,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  key: string,
  text: string,
  locale: string,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const field = form.fields.find((f) => f.key === key);
  if (key === 'unit_id') {
    const result = await resolveIntakeUnitQuery(tenantId, text.trim());
    if (result.status === 'resolved') {
      return { ok: true, value: result.unit.id };
    }
    if (result.status === 'ambiguous') {
      const list = formatUnitOptionsList(result.options);
      return {
        ok: false,
        message: `I found several locations. Please reply with the number:\n${list}`,
      };
    }
    const list = formatUnitOptionsList(result.suggestions);
    return {
      ok: false,
      message: list
        ? `I could not find that location. Did you mean one of these?\n${list}`
        : 'I could not find that location. Please try a different spelling.',
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

export async function applyNarrativeAndExtraction(
  tenantId: string,
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  narrative: string,
  proposed: Record<string, unknown>,
  locale: string,
  latestText?: string,
): Promise<void> {
  const trimmed = narrative.trim();
  const local = extractLocalFieldsFromNarrative(trimmed, latestText);
  const mergedProposed = mergeProposedWithLocal(proposed, local);
  slots.proposed = { ...slots.proposed, narrative: trimmed, ...mergedProposed };

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
    const val = mergedProposed[key];
    if (key === 'description' || fieldIsEmpty(key, val) || !fieldIsEmpty(key, slots.confirmed[key])) continue;
    if ((key === 'name' || key === 'phone' || key === 'email') && isRedactionPlaceholder(val)) continue;
    if (key === 'date_occurred') {
      const formatted = formatIntakeDate(val);
      if (formatted) slots.confirmed[key] = formatted;
      continue;
    }
    slots.confirmed[key] = key === 'categories' ? coerceIntakeStringArray(val) : String(val).trim();
  }

  applyLocalContactFields(slots, trimmed, latestText);

  if (latestText && fieldIsEmpty('phone', slots.confirmed.phone)) {
    const directPhone = extractPhoneFromText(latestText);
    if (directPhone) slots.confirmed.phone = directPhone;
  }

  const grievanceDesc = buildGrievanceDescription(
    trimmed,
    mergedProposed,
    coerceIntakeString(slots.confirmed.description) ?? undefined,
  );
  if (grievanceDesc) {
    slots.confirmed.description = grievanceDesc;
  }

  if (fieldIsEmpty('summary', slots.confirmed.summary)) {
    const fromAi = coerceIntakeString(mergedProposed.summary);
    const desc = coerceIntakeString(slots.confirmed.description) ?? grievanceDesc;
    const summarySource =
      fromAi && !containsRedactionPlaceholders(fromAi) ? fromAi : summarizeFromText(desc);
    slots.confirmed.summary = summarySource;
  }

  if (fieldIsEmpty('unit_id', slots.confirmed.unit_id) && mergedProposed.unit_hint) {
    const resolved = await resolveFieldValue(
      tenantId,
      form,
      taxonomy,
      'unit_id',
      String(mergedProposed.unit_hint),
      locale,
    );
    if (resolved.ok) {
      slots.confirmed.unit_id = resolved.value;
    } else {
      slots.proposed.unit_hint = mergedProposed.unit_hint;
    }
  }

  if (fieldIsEmpty('unit_id', slots.confirmed.unit_id)) {
    await resolveUnitForTurn(tenantId, slots, latestText ?? trimmed, mergedProposed, trimmed);
  }

  if (slots.anonymous === true) {
    for (const key of ['name', 'phone', 'email'] as const) {
      delete slots.confirmed[key];
    }
  }
}

export function readBackText(
  form: Cd06IntakeForms,
  taxonomy: Cd03Taxonomy,
  slots: ChatbotSlotsState,
  locale: string,
): string {
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

export async function extractFromNarrative(
  tenantId: string,
  sessionId: string,
  cd16: Cd16Ai,
  narrative: string,
  taxonomy: Cd03Taxonomy,
  anonymous: boolean,
  latestText?: string,
): Promise<{ proposed: Record<string, unknown>; sensitivity: boolean }> {
  const localProposed = extractLocalFieldsFromNarrative(narrative, latestText);
  const profileRef = resolveChatbotProfile(cd16);
  if (!profileRef) return { proposed: localProposed, sensitivity: false };

  const redacted = redactIntakeText(narrative, cd16.safety);
  const categoryLines = taxonomy.categories
    .filter((c) => c.active !== false)
    .map((c) => `- ${c.code}: ${c.label.en ?? c.code}`)
    .join('\n');
  const contactHint = anonymous
    ? 'Do not extract name, phone, or email for anonymous submissions.'
    : 'Do NOT include name, phone, or email in JSON — contact details are redacted in the Text and captured separately.';
  const prompt = [
    'You triage and extract grievance intake fields from a complainant narrative or conversation.',
    'Use the full text — the user may spread details across several messages.',
    'Return ONLY JSON with these keys (omit keys not present):',
    '{',
    '  "summary": "short title, max 120 chars",',
    '  "description": "complainant grievance only — not contact details, consent, or field prompts",',
    '  "categories": ["code"],',
    '  "unit_hint": "any settlement, village, ward, or place name mentioned anywhere in the text",',
    '  "date_occurred": "YYYY-MM-DD only when an exact calendar date is stated; omit for relative phrases like yesterday or two weeks ago",',
    '  "expected_outcome": "desired resolution if stated",',
    '  "sensitivity_signal": false',
    '}',
    '',
    'Set sensitivity_signal true ONLY when someone is in immediate physical danger right now (e.g. active attack, suicide in progress).',
    'Grievances about harassment, corruption, sewage, land, violence that already happened, or safety concerns are normal intake — keep sensitivity_signal false and continue filing.',
    contactHint,
    '',
    `Allowed category codes:\n${categoryLines}`,
    '',
    'Text:',
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
    if (parsed.date_occurred) {
      const formatted = formatIntakeDate(parsed.date_occurred.trim());
      if (formatted) proposed.date_occurred = formatted;
    }
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

    return { proposed: mergeProposedWithLocal(proposed, localProposed), sensitivity: parsed.sensitivity_signal === true };
  } catch {
    return { proposed: localProposed, sensitivity: false };
  }
}
