import { META_WHATSAPP_API_VERSION } from '@egrm/config-schemas';

export interface MetaWhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  bodyPreview?: string;
  bodyParamCount: number;
}

export interface DiscoveredWaba {
  id: string;
  name?: string;
  phone_number_ids: string[];
  source: string;
}

export interface FetchMetaWhatsAppTemplatesResult {
  templates: MetaWhatsAppTemplate[];
  resolvedWabaId: string;
  discovered_wabas?: DiscoveredWaba[];
}

type GraphErrorBody = {
  error?: {
    message?: string;
    code?: number;
    type?: string;
    error_subcode?: number;
    error_user_msg?: string;
    error_user_title?: string;
  };
};

function formatGraphError(data: GraphErrorBody, httpStatus: number): string {
  const e = data.error;
  const parts = [e?.message, e?.error_user_msg, e?.error_user_title].filter(Boolean);
  if (e?.error_subcode != null) parts.push(`subcode ${e.error_subcode}`);
  if (e?.code != null) parts.push(`code ${e.code}`);
  return parts.length ? parts.join(' — ') : `Meta API HTTP ${httpStatus}`;
}

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly discoveredWabas?: DiscoveredWaba[],
  ) {
    super(message);
    this.name = 'MetaApiError';
  }
}

function normalizeBearerToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'Bearer') return '';
  return trimmed.replace(/^Bearer\s+/i, '');
}

async function graphGet<T>(url: string, auth: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers: auth });
  const data = (await res.json()) as T & GraphErrorBody;
  if (!res.ok) {
    throw new MetaApiError(formatGraphError(data, res.status), data.error?.code);
  }
  return data;
}

async function graphGetSafe<T>(url: string, auth: Record<string, string>): Promise<T | null> {
  try {
    return await graphGet<T>(url, auth);
  } catch {
    return null;
  }
}

async function phoneIdsForWaba(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<string[]> {
  const phones = await graphGetSafe<{ data?: Array<{ id: string }> }>(
    `${base}/${wabaId}/phone_numbers?fields=id&limit=50`,
    auth,
  );
  return (phones?.data ?? []).map((p) => p.id);
}

async function wabasUnderBusinessId(
  base: string,
  auth: Record<string, string>,
  businessId: string,
): Promise<DiscoveredWaba[]> {
  const out: DiscoveredWaba[] = [];
  for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts'] as const) {
    let url: string | null = `${base}/${businessId}/${edge}?fields=id,name&limit=50`;
    while (url) {
      const page: {
        data?: Array<{ id: string; name?: string }>;
        paging?: { next?: string };
      } | null = await graphGetSafe(url, auth);
      if (!page) break;
      for (const waba of page.data ?? []) {
        const phone_number_ids = await phoneIdsForWaba(base, auth, waba.id);
        out.push({
          id: waba.id,
          name: waba.name,
          phone_number_ids,
          source: edge,
        });
      }
      url = page.paging?.next ?? null;
    }
  }
  return out;
}

/** List WhatsApp Business accounts visible to this token (for config UI). */
export async function discoverMetaWhatsAppAccounts(bearerToken: string): Promise<DiscoveredWaba[]> {
  const token = normalizeBearerToken(bearerToken);
  if (!token) throw new Error('Bearer token required');

  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };
  const byId = new Map<string, DiscoveredWaba>();

  const businesses = await graphGetSafe<{ data?: Array<{ id: string; name?: string }> }>(
    `${base}/me/businesses?fields=id,name&limit=50`,
    auth,
  );

  for (const biz of businesses?.data ?? []) {
    const wabas = await wabasUnderBusinessId(base, auth, biz.id);
    for (const waba of wabas) {
      byId.set(waba.id, {
        ...waba,
        name: waba.name ?? biz.name,
      });
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function canListTemplates(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<boolean> {
  const probe = await graphGetSafe<{ data?: unknown[] }>(
    `${base}/${wabaId}/message_templates?limit=1&fields=name`,
    auth,
  );
  return probe != null;
}

type TemplatePage = {
  data?: Array<{
    name: string;
    status: string;
    language: string;
    category?: string;
    components?: Array<{ type: string; text?: string }>;
  }>;
  paging?: { next?: string };
};

async function listTemplates(
  base: string,
  auth: Record<string, string>,
  wabaId: string,
): Promise<MetaWhatsAppTemplate[]> {
  const templates: MetaWhatsAppTemplate[] = [];
  let url: string | null =
    `${base}/${wabaId}/message_templates?limit=100&fields=name,status,language,category,components`;

  while (url) {
    const page: TemplatePage = await graphGet<TemplatePage>(url, auth);

    for (const row of page.data ?? []) {
      const bodyText = row.components?.find((c) => c.type === 'BODY')?.text ?? '';
      const paramCount = (bodyText.match(/\{\{\d+\}\}/g) ?? []).length;
      templates.push({
        name: row.name,
        language: row.language,
        status: row.status,
        category: row.category,
        bodyPreview: bodyText,
        bodyParamCount: paramCount,
      });
    }

    url = page.paging?.next ?? null;
  }

  return templates.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language));
}

function pickWaba(
  candidates: DiscoveredWaba[],
  phoneNumberId?: string,
): DiscoveredWaba | undefined {
  if (candidates.length === 0) return undefined;
  if (phoneNumberId) {
    const match = candidates.find((w) => w.phone_number_ids.includes(phoneNumberId));
    if (match) return match;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function formatDiscoveryHint(wabas: DiscoveredWaba[]): string {
  if (wabas.length === 0) {
    return 'No WhatsApp Business accounts found for this token. Regenerate the token with whatsapp_business_management permission in Meta → System users → Generate token.';
  }
  const lines = wabas.map((w) => {
    const phones = w.phone_number_ids.length ? ` phones: ${w.phone_number_ids.join(', ')}` : '';
    const label = w.name ? `${w.name} — ` : '';
    return `${label}${w.id}${phones}`;
  });
  return `Accessible WhatsApp Business Account IDs:\n${lines.join('\n')}`;
}

function tokenFromAuth(auth: Record<string, string>): string {
  return (auth.Authorization ?? '').replace(/^Bearer\s+/i, '');
}

async function resolveWabaId(
  base: string,
  auth: Record<string, string>,
  phoneNumberId: string | undefined,
  explicitWabaId?: string,
  discovered?: DiscoveredWaba[],
): Promise<string> {
  const wabaHint = explicitWabaId?.trim();
  const phoneId = phoneNumberId?.trim();

  if (wabaHint) {
    if (await canListTemplates(base, auth, wabaHint)) return wabaHint;

    // User may have pasted a Business Portfolio ID instead of WABA ID.
    const underBiz = await wabasUnderBusinessId(base, auth, wabaHint);
    const picked = pickWaba(underBiz, phoneId);
    if (picked && (await canListTemplates(base, auth, picked.id))) return picked.id;

    const all = discovered ?? (await discoverMetaWhatsAppAccounts(tokenFromAuth(auth)));
    const fromDiscovery = pickWaba(all, phoneId);
    if (fromDiscovery && (await canListTemplates(base, auth, fromDiscovery.id))) {
      return fromDiscovery.id;
    }

    if (underBiz.length > 1) {
      throw new MetaApiError(
        `ID "${wabaHint}" looks like a Business Portfolio ID with ${underBiz.length} WhatsApp accounts — pick the WABA ID:\n${formatDiscoveryHint(underBiz)}`,
        undefined,
        underBiz,
      );
    }

    throw new MetaApiError(
      `Cannot list templates for ID "${wabaHint}". Use the WhatsApp Business Account ID (not Business Portfolio ID or Phone number ID).\n\n${formatDiscoveryHint(all)}`,
      undefined,
      all,
    );
  }

  if (phoneId) {
    const all = discovered ?? (await discoverMetaWhatsAppAccounts(tokenFromAuth(auth)));
    const picked = pickWaba(all, phoneId);
    if (picked) return picked.id;
  }

  throw new MetaApiError(
    `Could not resolve WhatsApp Business Account ID.${phoneId ? ` No account owns phone number ID ${phoneId}.` : ''}\n\n${formatDiscoveryHint(discovered ?? [])}`,
    undefined,
    discovered,
  );
}

/** List Meta message templates for a WhatsApp Business account. */
export async function fetchMetaWhatsAppTemplates(
  phoneNumberId: string | undefined,
  bearerToken: string,
  opts?: { wabaId?: string },
): Promise<FetchMetaWhatsAppTemplatesResult> {
  const token = normalizeBearerToken(bearerToken);
  if (!token) throw new Error('Bearer token required');

  const phoneId = phoneNumberId?.trim();
  if (phoneId && (phoneId.startsWith('+') || !/^\d+$/.test(phoneId))) {
    throw new Error('phone_number_id must be the numeric Meta API ID (not the +254 display number)');
  }

  const wabaId = opts?.wabaId?.trim();
  if (!wabaId && !phoneId) {
    throw new Error('waba_id or phone_number_id required');
  }

  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };

  const discovered = await discoverMetaWhatsAppAccounts(token);
  const resolvedWabaId = await resolveWabaId(base, auth, phoneId, wabaId, discovered);
  const templates = await listTemplates(base, auth, resolvedWabaId);

  return { templates, resolvedWabaId, discovered_wabas: discovered };
}

const META_LANGUAGE_MAP: Record<string, string> = {
  en: 'en_US',
  sw: 'sw',
};

/** Meta rejects bare locale codes like `en`; map CD-09 variant keys to supported WhatsApp locales. */
export function normalizeMetaLanguage(lang: string): string {
  const t = lang.trim();
  if (!t) return 'en_US';
  if (META_LANGUAGE_MAP[t]) return META_LANGUAGE_MAP[t];
  if (/^[a-z]{2}_[A-Z]{2}$/.test(t)) return t;
  return 'en_US';
}

/** Unique CD-09 placeholder keys in order of first appearance (e.g. party.name → {{1}}). */
export function extractCd09ParamKeysInOrder(body: string): string[] {
  const re = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;
  const keys: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const k = m[1]!;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

/** Convert CD-09 body placeholders ({{party.name}}) to Meta {{1}}, {{2}}, … using param key order. */
export function cd09BodyToMetaBody(body: string, paramKeys: string[]): string {
  let out = body;
  paramKeys.forEach((key, i) => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g');
    out = out.replace(re, `{{${i + 1}}}`);
  });
  return out;
}

/** Prefer configured keys; fall back to extraction when placeholders would remain unmapped. */
export function resolveParamKeysForMeta(body: string, configuredKeys: string[]): string[] {
  const configured = configuredKeys.map((k) => k.trim()).filter(Boolean);
  const extracted = extractCd09ParamKeysInOrder(body);
  if (extracted.length === 0) return configured;
  if (configured.length === 0) return extracted;
  const trial = cd09BodyToMetaBody(body, configured);
  if (/\{\{[a-z][a-z0-9_.]*\}\}/i.test(trial)) return extracted;
  return configured;
}

const META_PARAM_EXAMPLES: Record<string, string> = {
  'party.name': 'Jane Doe',
  'case.reference': 'GR-2026-001',
  'tenant.name': 'KISIP',
  'tenant.short_name': 'KISIP',
  'tracking.url': 'https://portal.example.com/track/abc',
  'case.status_label': 'Under review',
  'case.update_summary': 'Your grievance is being reviewed.',
  'case.unit_name': 'Nairobi County',
};

function metaParamExamples(paramKeys: string[]): string[] {
  return paramKeys.map((k, i) => META_PARAM_EXAMPLES[k] ?? `sample${i + 1}`);
}

function validateMetaTemplateBody(metaBody: string): void {
  const leftover = metaBody.match(/\{\{[a-z][a-z0-9_.]*\}\}/gi);
  if (leftover?.length) {
    throw new Error(`Body still has unmapped placeholders: ${leftover.slice(0, 3).join(', ')}`);
  }
  const nums = [...metaBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  if (nums.length === 0) {
    throw new Error('Body has no {{1}}…{{n}} variables');
  }
  const max = Math.max(...nums);
  for (let i = 1; i <= max; i++) {
    if (!nums.includes(i)) {
      throw new Error(`Variable numbering must be sequential; missing {{${i}}}`);
    }
  }
}

export function prepareMetaTemplateBody(
  body: string,
  paramKeys: string[],
): { metaBody: string; paramKeys: string[] } {
  const keys = resolveParamKeysForMeta(body, paramKeys);
  if (keys.length === 0) throw new Error('No body parameter keys');
  let metaBody = cd09BodyToMetaBody(body.trim(), keys);
  if (/\{\{\d+\}\}\s*$/.test(metaBody.trim())) {
    metaBody = `${metaBody.trim()} Thank you.`;
  }
  validateMetaTemplateBody(metaBody);
  return { metaBody, paramKeys: keys };
}

export interface PushMetaTemplateInput {
  name: string;
  language: string;
  body: string;
  paramKeys: string[];
  category?: string;
}

export interface PushMetaTemplateResult {
  name: string;
  language: string;
  meta_body: string;
  status: string;
  id?: string;
  skipped?: boolean;
  reason?: string;
}

async function graphPost<T>(url: string, auth: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & GraphErrorBody;
  if (!res.ok) {
    throw new MetaApiError(formatGraphError(data, res.status), data.error?.code);
  }
  return data;
}

/** Submit one template to Meta for approval (status usually PENDING until Meta reviews). */
export async function submitMetaWhatsAppTemplate(
  wabaId: string,
  bearerToken: string,
  input: PushMetaTemplateInput,
  opts?: { existing?: MetaWhatsAppTemplate[] },
): Promise<PushMetaTemplateResult> {
  const token = normalizeBearerToken(bearerToken);
  if (!token) throw new Error('Bearer token required');

  const waba = wabaId.trim();
  if (!waba) throw new Error('waba_id required');

  const name = input.name.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`Template name "${name}" must be lowercase letters, numbers, and underscores only`);
  }

  const language = normalizeMetaLanguage(input.language);
  const { metaBody, paramKeys } = prepareMetaTemplateBody(input.body, input.paramKeys);
  if (!metaBody.trim()) throw new Error('WhatsApp body is empty');

  const existing = opts?.existing ?? [];
  const match = existing.find((t) => t.name === name && t.language === language);
  if (match) {
    return {
      name,
      language,
      meta_body: metaBody,
      status: match.status,
      skipped: true,
      reason: `Already on Meta (${match.status})`,
    };
  }

  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };

  const created = await graphPost<{ id?: string; status?: string; category?: string }>(
    `${base}/${waba}/message_templates`,
    auth,
    {
      name,
      language,
      category: (input.category ?? 'UTILITY').toUpperCase(),
      components: [
        {
          type: 'BODY',
          text: metaBody,
          example: { body_text: [metaParamExamples(paramKeys)] },
        },
      ],
    },
  );

  return {
    name,
    language,
    meta_body: metaBody,
    status: created.status ?? 'PENDING',
    id: created.id,
  };
}

/** Push multiple CD-09 WhatsApp variants to Meta (deduped by name + language). */
export async function pushCd09TemplatesToMeta(
  wabaId: string,
  bearerToken: string,
  items: PushMetaTemplateInput[],
): Promise<PushMetaTemplateResult[]> {
  const token = normalizeBearerToken(bearerToken);
  const base = `https://graph.facebook.com/${META_WHATSAPP_API_VERSION}`;
  const auth = { Authorization: `Bearer ${token}` };
  const existing = await listTemplates(base, auth, wabaId.trim());

  const seen = new Set<string>();
  const results: PushMetaTemplateResult[] = [];

  for (const item of items) {
    const language = normalizeMetaLanguage(item.language);
    const key = `${item.name.trim().toLowerCase()}::${language}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const normalizedItem = { ...item, language };

    try {
      const result = await submitMetaWhatsAppTemplate(wabaId, token, normalizedItem, { existing });
      results.push(result);
      if (!result.skipped && result.status) {
        const resolvedKeys = resolveParamKeysForMeta(item.body, item.paramKeys);
        existing.push({
          name: result.name,
          language: result.language,
          status: result.status,
          bodyPreview: result.meta_body,
          bodyParamCount: resolvedKeys.length,
        });
      }
    } catch (err) {
      let meta_body = '';
      try {
        meta_body = prepareMetaTemplateBody(item.body, item.paramKeys).metaBody;
      } catch {
        meta_body = cd09BodyToMetaBody(item.body, item.paramKeys);
      }
      results.push({
        name: item.name,
        language,
        meta_body,
        status: 'FAILED',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
