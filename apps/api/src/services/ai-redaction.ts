import { createHash } from 'node:crypto';
import type { Cd16Ai } from '@egrm/config-schemas';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const REDACTION_TOKEN_RE = /\[([A-Z_]+)\]/g;

/** True when a value is an AI redaction token (e.g. [NAME], [PHONE]) — not real PII. */
export function isRedactionPlaceholder(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const t = val.trim();
  return /^\[[A-Z_]+\]$/.test(t);
}

/** True when free text still contains redaction tokens from an LLM prompt. */
export function containsRedactionPlaceholders(text: string): boolean {
  REDACTION_TOKEN_RE.lastIndex = 0;
  return REDACTION_TOKEN_RE.test(text);
}

/** Strip PII from intake narrative before sending to an AI provider (spec 16 §10). */
export function redactIntakeText(text: string, safety: Cd16Ai['safety']): string {
  let out = text;
  const strip = safety.pii_redaction?.strip_fields ?? [];

  if (strip.includes('email')) out = out.replace(EMAIL_RE, '[EMAIL]');
  if (strip.includes('phone')) out = out.replace(PHONE_RE, '[PHONE]');

  for (const field of strip) {
    if (field === 'email' || field === 'phone') continue;
    const token = `[${field.toUpperCase()}]`;
    const patterns: Record<string, RegExp[]> = {
      name: [/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g],
      national_id: [/\b\d{6,12}\b/g],
      address: [/\b\d{1,5}\s+[A-Za-z0-9\s,.-]{5,60}\b/g],
    };
    for (const re of patterns[field] ?? []) {
      out = out.replace(re, token);
    }
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

export function hashRedactedPrompt(parts: string[]): string {
  return createHash('sha256').update(parts.join('\n---\n')).digest('hex');
}
