import crypto from 'node:crypto';
import type {
  ChatCompletionResponse,
  ChatCompletionChunk,
  CompletionUsage,
  ModelObject,
  ModelListResponse,
  OpenAIError,
} from '../types/index.js';

function generateId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function nowTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

interface SDKUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function mapUsage(sdkUsage: SDKUsage): CompletionUsage {
  return {
    prompt_tokens: sdkUsage.input_tokens,
    completion_tokens: sdkUsage.output_tokens,
    total_tokens: sdkUsage.input_tokens + sdkUsage.output_tokens,
    prompt_tokens_details: sdkUsage.cache_read_input_tokens
      ? { cached_tokens: sdkUsage.cache_read_input_tokens }
      : undefined,
  };
}

export function formatChatCompletion(
  content: string,
  model: string,
  usage: SDKUsage,
  finishReason: 'stop' | 'length' = 'stop'
): ChatCompletionResponse {
  return {
    id: generateId(),
    object: 'chat.completion',
    created: nowTimestamp(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: mapUsage(usage),
    system_fingerprint: null,
  };
}

export function formatChatCompletionChunk(
  content: string | null,
  model: string,
  finishReason: 'stop' | 'length' | null = null,
  usage?: SDKUsage | null,
  includeRole = false
): ChatCompletionChunk {
  return {
    id: generateId(),
    object: 'chat.completion.chunk',
    created: nowTimestamp(),
    model,
    choices: [
      {
        index: 0,
        delta: {
          ...(includeRole ? { role: 'assistant' as const } : {}),
          ...(content !== null ? { content } : {}),
        },
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
    usage: usage ? mapUsage(usage) : null,
    system_fingerprint: null,
  };
}

export function formatSSEMessage(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export function formatSSEDone(): string {
  return 'data: [DONE]\n\n';
}

export function formatModelObject(
  id: string,
  ownedBy = 'codebuddy'
): ModelObject {
  return {
    id,
    object: 'model',
    created: nowTimestamp(),
    owned_by: ownedBy,
  };
}

export function formatModelList(
  models: Array<Record<string, unknown>>
): ModelListResponse {
  return {
    object: 'list',
    data: models.map(m => {
      // SDK may return { id, name } or { value, displayName, description }
      // depending on the version. Handle both.
      const modelId = (m.id ?? m.value ?? 'unknown') as string;
      return formatModelObject(modelId);
    }),
  };
}

export function formatError(
  message: string,
  type: string = 'invalid_request_error',
  code: string | null = null,
  param: string | null = null
): OpenAIError {
  return {
    error: { message, type, param, code },
  };
}
