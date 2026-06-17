import {
  resolveAiApiKey,
  type AiProviderKind,
  type AiProviderProfile,
} from '@egrm/config-schemas';

export interface AiModelLists {
  chat_models: string[];
  embedding_models: string[];
}

export interface AiProviderProbeResult extends AiModelLists {
  ok: true;
  latency_ms: number;
  provider_kind: AiProviderKind;
}

function isEmbeddingModelId(id: string): boolean {
  const n = id.toLowerCase();
  return (
    n.includes('embed') ||
    n.includes('embedding') ||
    n.startsWith('text-embedding') ||
    n.includes('nomic-embed')
  );
}

function splitModelIds(ids: string[]): AiModelLists {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
  const embedding_models = unique.filter(isEmbeddingModelId);
  const chat_models = unique.filter((id) => !isEmbeddingModelId(id));
  return { chat_models, embedding_models };
}

function endpointOrigin(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Provider request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function parseJsonResponse(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 280).replace(/\s+/g, ' ').trim();
    throw new Error(res.status === 401 ? 'Invalid API key (401)' : `Provider error ${res.status}: ${snippet}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Provider returned non-JSON response');
  }
}

function extractOpenAiStyleIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const id = (row as { id?: unknown }).id;
      return typeof id === 'string' ? id : '';
    })
    .filter(Boolean);
}

async function listOllamaModels(profile: AiProviderProfile, timeoutMs: number): Promise<string[]> {
  const origin = endpointOrigin(profile.endpoint);
  const urls = [`${origin}/api/tags`, `${profile.endpoint.replace(/\/$/, '')}/models`];

  for (const url of urls) {
    try {
      const res = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
      const body = await parseJsonResponse(res);
      if (url.endsWith('/api/tags') && body && typeof body === 'object') {
        const models = (body as { models?: { name?: string }[] }).models;
        if (Array.isArray(models)) {
          const names = models.map((m) => m?.name).filter((n): n is string => Boolean(n));
          if (names.length) return names;
        }
      }
      const ids = extractOpenAiStyleIds(body);
      if (ids.length) return ids;
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not list Ollama models. Is Ollama running?');
}

async function listAnthropicModels(apiKey: string, timeoutMs: number): Promise<string[]> {
  const res = await fetchWithTimeout(
    'https://api.anthropic.com/v1/models',
    {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    },
    timeoutMs,
  );
  const body = await parseJsonResponse(res);
  return extractOpenAiStyleIds(body);
}

async function listOpenAiCompatibleModels(
  profile: AiProviderProfile,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<string[]> {
  let url = `${profile.endpoint.replace(/\/$/, '')}/models`;

  if (profile.kind === 'azure_openai') {
    const resource =
      profile.azure_resource?.trim() ||
      (() => {
        try {
          const host = new URL(profile.endpoint).hostname;
          return host.split('.')[0] ?? '';
        } catch {
          return '';
        }
      })();
    if (!resource) throw new Error('Azure resource name is required');
    const version = profile.azure_api_version?.trim() || '2024-10-01-preview';
    url = `https://${resource}.openai.azure.com/openai/models?api-version=${encodeURIComponent(version)}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (profile.kind === 'azure_openai' && apiKey) {
    headers['api-key'] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetchWithTimeout(url, { method: 'GET', headers }, timeoutMs);
  const body = await parseJsonResponse(res);
  const ids = extractOpenAiStyleIds(body);
  if (!ids.length) throw new Error('No models returned from provider');
  return ids;
}

/** Ping provider and return available chat / embedding model ids. */
export async function probeAiProviderProfile(profile: AiProviderProfile): Promise<AiProviderProbeResult> {
  const timeoutMs = profile.limits?.timeout_ms ?? 60_000;
  const apiKey = resolveAiApiKey(profile);
  const needsKey = profile.kind !== 'ollama';

  if (needsKey && !apiKey) {
    throw new Error(
      'API key not configured. Set api_key_ref (e.g. env:OPENAI_API_KEY) or a dev override.',
    );
  }

  const started = Date.now();
  let ids: string[];

  if (profile.kind === 'anthropic') {
    ids = await listAnthropicModels(apiKey!, timeoutMs);
  } else if (profile.kind === 'ollama') {
    ids = await listOllamaModels(profile, timeoutMs);
  } else {
    ids = await listOpenAiCompatibleModels(profile, apiKey, timeoutMs);
  }

  const { chat_models, embedding_models } = splitModelIds(ids);

  if (!chat_models.length && !embedding_models.length) {
    throw new Error('Provider responded but returned no recognizable models');
  }

  return {
    ok: true,
    latency_ms: Date.now() - started,
    provider_kind: profile.kind,
    chat_models,
    embedding_models,
  };
}
