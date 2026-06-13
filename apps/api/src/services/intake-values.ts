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
