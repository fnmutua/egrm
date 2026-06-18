/** Coerce intake field values from portal selects (Nuxt UI may bind full option objects). */
export function coerceIntakeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
    const inner = (value as { value: unknown }).value;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  }
  return null;
}

export function coerceIntakeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = coerceIntakeString(item) ?? (typeof item === 'string' && item.trim() ? item.trim() : null);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Parse intake date fields — rejects natural language (e.g. "yesterday", "two weeks ago"). */
export function parseIntakeDate(value: unknown): Date | null {
  const s = coerceIntakeString(value);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

export function formatIntakeDate(value: unknown): string | null {
  const d = parseIntakeDate(value);
  return d ? d.toISOString().slice(0, 10) : null;
}
