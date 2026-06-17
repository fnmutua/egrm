import {
  resolveAiApiKey,
  type AiProviderKind,
  type AiProviderProfile,
} from '@egrm/config-schemas';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  input_token_count?: number;
  output_token_count?: number;
  latency_ms: number;
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

function extractOpenAiContent(body: unknown): { content: string; usage?: { prompt_tokens?: number; completion_tokens?: number } } {
  if (!body || typeof body !== 'object') throw new Error('Empty provider response');
  const choices = (body as { choices?: { message?: { content?: string } }[] }).choices;
  const content = choices?.[0]?.message?.content;
  if (!content) throw new Error('Provider returned no message content');
  const usage = (body as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return { content, usage };
}

function extractAnthropicContent(body: unknown): { content: string; usage?: { input_tokens?: number; output_tokens?: number } } {
  if (!body || typeof body !== 'object') throw new Error('Empty provider response');
  const blocks = (body as { content?: { type?: string; text?: string }[] }).content;
  const text = blocks?.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Provider returned no message content');
  const usage = (body as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  return { content: text, usage };
}

function chatCompletionsUrl(profile: AiProviderProfile): string {
  if (profile.kind === 'azure_openai') {
    const resource =
      profile.azure_resource?.trim() ||
      (() => {
        try {
          return new URL(profile.endpoint).hostname.split('.')[0] ?? '';
        } catch {
          return '';
        }
      })();
    const deployment = profile.default_model;
    const version = profile.azure_api_version?.trim() || '2024-10-01-preview';
    return `https://${resource}.openai.azure.com/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`;
  }
  return `${profile.endpoint.replace(/\/$/, '')}/chat/completions`;
}

function openAiUsesMaxCompletionTokens(model: string): boolean {
  const m = model.toLowerCase();
  return /^o\d/.test(m) || /^gpt-5/.test(m) || m.startsWith('gpt-4.1');
}

function openAiOmitsTemperature(model: string): boolean {
  return openAiUsesMaxCompletionTokens(model);
}

function isMaxTokensParamError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('max_tokens') && msg.includes('max_completion_tokens');
}

async function openAiStyleCompletion(
  profile: AiProviderProfile,
  apiKey: string | undefined,
  messages: ChatMessage[],
  jsonMode: boolean,
): Promise<ChatCompletionResult> {
  const timeoutMs = profile.limits?.timeout_ms ?? 60_000;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (profile.kind === 'azure_openai' && apiKey) {
    headers['api-key'] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const maxOut = profile.limits?.max_output_tokens ?? 4096;

  async function request(useMaxCompletionTokens: boolean): Promise<ChatCompletionResult> {
    const body: Record<string, unknown> = {
      model: profile.default_model,
      messages,
      ...(useMaxCompletionTokens ? { max_completion_tokens: maxOut } : { max_tokens: maxOut }),
    };
    if (!openAiOmitsTemperature(profile.default_model)) {
      body.temperature = profile.limits?.temperature ?? 0.2;
    }
    if (jsonMode && profile.kind !== 'ollama') {
      body.response_format = { type: 'json_object' };
    }

    const started = Date.now();
    const res = await fetchWithTimeout(chatCompletionsUrl(profile), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, timeoutMs);
    const parsed = await parseJsonResponse(res);
    const { content, usage } = extractOpenAiContent(parsed);

    return {
      content,
      model: profile.default_model,
      input_token_count: usage?.prompt_tokens,
      output_token_count: usage?.completion_tokens,
      latency_ms: Date.now() - started,
    };
  }

  const preferCompletionTokens = openAiUsesMaxCompletionTokens(profile.default_model);
  try {
    return await request(preferCompletionTokens);
  } catch (err) {
    if (!preferCompletionTokens && isMaxTokensParamError(err)) {
      return request(true);
    }
    throw err;
  }
}

async function anthropicCompletion(
  profile: AiProviderProfile,
  apiKey: string,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  const timeoutMs = profile.limits?.timeout_ms ?? 60_000;
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const convo = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));

  const started = Date.now();
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: profile.default_model,
      max_tokens: profile.limits?.max_output_tokens ?? 4096,
      temperature: profile.limits?.temperature ?? 0.2,
      system: system || undefined,
      messages: convo,
    }),
  }, timeoutMs);
  const parsed = await parseJsonResponse(res);
  const { content, usage } = extractAnthropicContent(parsed);

  return {
    content,
    model: profile.default_model,
    input_token_count: usage?.input_tokens,
    output_token_count: usage?.output_tokens,
    latency_ms: Date.now() - started,
  };
}

/** Run a chat completion against the configured provider profile. */
export async function chatCompletion(
  profile: AiProviderProfile,
  messages: ChatMessage[],
  options?: { json_mode?: boolean },
): Promise<ChatCompletionResult> {
  const apiKey = resolveAiApiKey(profile);
  const needsKey = profile.kind !== 'ollama';
  if (needsKey && !apiKey) {
    throw new Error('API key not configured for provider profile');
  }

  const jsonMode = options?.json_mode ?? false;
  if (profile.kind === 'anthropic') {
    return anthropicCompletion(profile, apiKey!, messages);
  }
  return openAiStyleCompletion(profile, apiKey, messages, jsonMode);
}

export function providerKindLabel(kind: AiProviderKind): string {
  return kind;
}
