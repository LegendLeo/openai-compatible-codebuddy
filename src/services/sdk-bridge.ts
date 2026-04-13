import { query as sdkQuery } from '@tencent-ai/agent-sdk';
import type { Message, Options } from '@tencent-ai/agent-sdk';
import { config } from '../config.js';
import { convertMessages, extractTextFromContentBlocks } from './message-converter.js';
import {
  formatChatCompletion,
  formatChatCompletionChunk,
  formatSSEMessage,
  formatSSEDone,
  formatModelList,
  mapUsage,
} from './response-formatter.js';
import type { ChatMessage, ChatCompletionResponse, ModelListResponse } from '../types/index.js';

function buildEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  if (config.codebuddy.apiKey) {
    env.CODEBUDDY_API_KEY = config.codebuddy.apiKey;
  }
  if (config.codebuddy.environment) {
    env.CODEBUDDY_INTERNET_ENVIRONMENT = config.codebuddy.environment;
  }
  return env;
}

function buildOptions(model: string, systemPrompt?: string): Options {
  const opts: Options = {
    model,
    fallbackModel: config.fallbackModel,
    permissionMode: 'bypassPermissions',
    maxTurns: 1,
    env: buildEnv(),
  };
  if (systemPrompt) {
    opts.systemPrompt = systemPrompt;
  }
  return opts;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
}

/**
 * Non-streaming chat completion.
 * Collects all assistant text and returns a complete response.
 */
export async function chatCompletion(
  params: ChatCompletionParams
): Promise<ChatCompletionResponse> {
  const { systemPrompt, prompt } = convertMessages(params.messages);
  const model = params.model || config.defaultModel;
  const options = buildOptions(model, systemPrompt);

  const q = sdkQuery({ prompt, options });
  let fullText = '';
  let lastUsage = { input_tokens: 0, output_tokens: 0 };
  let actualModel = model;

  for await (const message of q) {
    if (message.type === 'assistant') {
      const text = extractTextFromContentBlocks(
        message.message.content as ReadonlyArray<{ type: string; text?: string }>
      );
      fullText += text;
      lastUsage = message.message.usage;
      actualModel = message.message.model;
    } else if (message.type === 'result') {
      if (message.usage) {
        lastUsage = message.usage;
      }
    }
  }

  return formatChatCompletion(fullText, actualModel, lastUsage);
}

/**
 * Streaming chat completion.
 * Returns a ReadableStream of SSE-formatted data.
 */
export function chatCompletionStream(
  params: ChatCompletionParams
): ReadableStream<Uint8Array> {
  const { systemPrompt, prompt } = convertMessages(params.messages);
  const model = params.model || config.defaultModel;
  const options: Options = {
    ...buildOptions(model, systemPrompt),
    includePartialMessages: true,
  };

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const q = sdkQuery({ prompt, options });
        let sentRole = false;
        let actualModel = model;

        for await (const message of q) {
          if (message.type === 'stream_event') {
            const event = message.event;

            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              if (delta.type === 'text_delta') {
                if (!sentRole) {
                  // First chunk: include role
                  const chunk = formatChatCompletionChunk(
                    delta.text, actualModel, null, null, true
                  );
                  controller.enqueue(encoder.encode(formatSSEMessage(chunk)));
                  sentRole = true;
                } else {
                  const chunk = formatChatCompletionChunk(
                    delta.text, actualModel
                  );
                  controller.enqueue(encoder.encode(formatSSEMessage(chunk)));
                }
              }
            } else if (event.type === 'message_start') {
              actualModel = event.message.model;
            } else if (event.type === 'message_delta') {
              // Send final chunk with finish_reason and usage
              const finishReason = event.delta.stop_reason === 'end_turn' ? 'stop' as const : 'stop' as const;
              const usage = event.usage ? {
                input_tokens: event.usage.input_tokens,
                output_tokens: event.usage.output_tokens,
              } : null;
              const chunk = formatChatCompletionChunk(
                null, actualModel, finishReason, usage
              );
              controller.enqueue(encoder.encode(formatSSEMessage(chunk)));
            }
          } else if (message.type === 'result') {
            // If no stream events were sent, send the result text as a single chunk
            if (!sentRole && message.type === 'result' && 'result' in message) {
              const resultMsg = message as { result: string; usage: typeof lastUsage; [key: string]: unknown };
              const chunk = formatChatCompletionChunk(
                resultMsg.result, actualModel, 'stop', resultMsg.usage, true
              );
              controller.enqueue(encoder.encode(formatSSEMessage(chunk)));
            }
          }
        }

        controller.enqueue(encoder.encode(formatSSEDone()));
        controller.close();
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        const errChunk = `data: ${JSON.stringify({ error: { message: errMsg, type: 'server_error' } })}\n\n`;
        controller.enqueue(encoder.encode(errChunk));
        controller.enqueue(encoder.encode(formatSSEDone()));
        controller.close();
      }
    },
  });
}

// Type alias for the result usage
type ResultUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
let lastUsage: ResultUsage;

// ---- Models cache ----
// Cache model list in memory to avoid spinning up a CLI subprocess on every request.
// TTL: 5 minutes (models rarely change during a session).

interface ModelsCache {
  data: ModelListResponse;
  expiresAt: number;
}

let modelsCache: ModelsCache | null = null;
let modelsFetchInFlight: Promise<ModelListResponse> | null = null;

/**
 * Get available models from the SDK.
 * Results are cached in memory for 5 minutes to avoid the expensive
 * subprocess startup on every request.
 */
export async function getModels(): Promise<ModelListResponse> {
  // Return cached result if still valid
  if (modelsCache && Date.now() < modelsCache.expiresAt) {
    return modelsCache.data;
  }

  // Deduplicate concurrent requests — if a fetch is already in progress, wait for it
  if (modelsFetchInFlight) {
    return modelsFetchInFlight;
  }

  modelsFetchInFlight = fetchModelsFromSDK();
  try {
    const result = await modelsFetchInFlight;
    return result;
  } finally {
    modelsFetchInFlight = null;
  }
}

async function fetchModelsFromSDK(): Promise<ModelListResponse> {
  const abortController = new AbortController();

  const q = sdkQuery({
    prompt: 'hi',
    options: {
      model: config.defaultModel,
      permissionMode: 'plan',
      maxTurns: 1,
      env: buildEnv(),
      abortController,
    },
  });

  try {
    const models = await q.supportedModels();

    // Immediately abort the query — we only needed the model list,
    // no need to wait for the actual LLM response.
    abortController.abort();

    const result = formatModelList(models);

    // Cache the result for 5 minutes
    modelsCache = {
      data: result,
      expiresAt: Date.now() + 5 * 60 * 1000,
    };

    return result;
  } catch {
    // Abort in case of error too
    abortController.abort();

    // Fallback: return default model
    return formatModelList([
      { id: config.defaultModel, name: config.defaultModel },
    ]);
  }
}

/**
 * Invalidate the models cache (useful for testing or manual refresh).
 */
export function invalidateModelsCache(): void {
  modelsCache = null;
}
