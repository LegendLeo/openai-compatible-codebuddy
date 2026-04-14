import type { ChatMessage, ContentPart } from '../types/index.js';

export interface ConvertedPrompt {
  systemPrompt: string | undefined;
  /** Plain-text prompt (used when no images are present). */
  prompt: string;
  /**
   * When the last user message contains images we build Anthropic-style
   * content blocks so the underlying CLI can forward them to the model.
   * If set, the caller should prefer sending this via `UserMessage` format
   * instead of the plain `prompt` string.
   */
  contentBlocks?: AnthropicContentBlock[];
}

// ---------- Anthropic content-block types (for image support) ----------

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;   // e.g. "image/png", "image/jpeg"
    data: string;          // raw base64 string (no data-uri prefix)
  };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

// ---------- helpers ----------

/** Check whether an OpenAI content array contains at least one image part. */
function hasImageParts(content: string | ContentPart[]): boolean {
  if (typeof content === 'string') return false;
  return content.some(p => p.type === 'image_url');
}

/**
 * Parse a data-URI and return { mediaType, base64Data }.
 * Expects format: data:<mediaType>;base64,<data>
 */
function parseDataUri(dataUri: string): { mediaType: string; base64Data: string } | null {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return { mediaType: match[1], base64Data: match[2] };
}

/**
 * Fetch an image URL and return its base64-encoded data and media type.
 */
async function fetchImageAsBase64(url: string): Promise<{ mediaType: string; base64Data: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || 'image/png';
    // Extract just the MIME type (e.g. "image/jpeg; charset=..." → "image/jpeg")
    const mediaType = contentType.split(';')[0].trim();

    const arrayBuffer = await response.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    return { mediaType, base64Data };
  } catch {
    return null;
  }
}

/**
 * Convert an OpenAI `content` field (string | ContentPart[]) into
 * Anthropic-style content blocks that the CLI can forward to the model.
 *
 * Supports:
 *  - `image_url.url` starting with `data:image/...;base64,...`  → inline base64 image block
 *  - `image_url.url` being a regular https URL → fetched and converted to base64
 */
async function contentPartsToBlocks(parts: ContentPart[]): Promise<AnthropicContentBlock[]> {
  const blocks: AnthropicContentBlock[] = [];

  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
    } else if (part.type === 'image_url') {
      const url = part.image_url.url;

      if (url.startsWith('data:')) {
        // data-URI  →  base64 image block
        const parsed = parseDataUri(url);
        if (parsed) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: parsed.mediaType,
              data: parsed.base64Data,
            },
          });
        } else {
          blocks.push({ type: 'text', text: '[User attached an image (unrecognised data URI)]' });
        }
      } else {
        // Regular URL → fetch and convert to base64
        const fetched = await fetchImageAsBase64(url);
        if (fetched) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: fetched.mediaType,
              data: fetched.base64Data,
            },
          });
        } else {
          // Fetch failed – fall back to text description
          blocks.push({ type: 'text', text: `[User attached an image: ${url} (failed to fetch)]` });
        }
      }
    }
  }

  return blocks;
}

/**
 * Normalise ChatMessage.content to a plain string.
 * Used for text-only messages and for conversation history serialization.
 */
function contentToString(content: string | ContentPart[]): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return String(content);
  }

  const texts: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      texts.push(part.text);
    } else if (part.type === 'image_url') {
      texts.push('[image]');
    }
  }
  return texts.join('\n');
}

/**
 * Convert OpenAI-style messages array to CodeBuddy SDK prompt + systemPrompt.
 *
 * - system messages → merged into systemPrompt
 * - user/assistant messages → serialized into a single prompt string
 * - If the last user message contains images, `contentBlocks` will be populated
 *   so the caller can send them as Anthropic-format content blocks.
 */
export async function convertMessages(messages: ChatMessage[]): Promise<ConvertedPrompt> {
  const systemMessages: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    const text = contentToString(msg.content);
    if (msg.role === 'system') {
      systemMessages.push(text);
    } else if (msg.role === 'user') {
      conversationParts.push(text);
    } else if (msg.role === 'assistant') {
      conversationParts.push(`[Assistant]: ${text}`);
    }
  }

  const systemPrompt = systemMessages.length > 0
    ? systemMessages.join('\n\n')
    : undefined;

  // If there's only one user message and no assistant messages, use it directly
  const hasAssistant = messages.some(m => m.role === 'assistant');
  let prompt: string;

  if (!hasAssistant && conversationParts.length === 1) {
    prompt = conversationParts[0];
  } else {
    // Multi-turn: serialize with role markers for context
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') continue;
      const text = contentToString(msg.content);
      if (msg.role === 'user') {
        parts.push(`[User]: ${text}`);
      } else if (msg.role === 'assistant') {
        parts.push(`[Assistant]: ${text}`);
      }
    }
    prompt = parts.join('\n\n');
  }

  // --- Image support ---
  // Check if the last user message contains images.
  // If so, build Anthropic content blocks for direct forwarding.
  let contentBlocks: AnthropicContentBlock[] | undefined;

  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg && hasImageParts(lastUserMsg.content)) {
    const parts = lastUserMsg.content as ContentPart[];

    // If there's conversation history before the last user message, prepend it
    // as a text block so the model has full context.
    const historyMessages = messages.slice(0, messages.lastIndexOf(lastUserMsg));
    const historyParts: string[] = [];
    for (const msg of historyMessages) {
      if (msg.role === 'system') continue;
      const text = contentToString(msg.content);
      if (msg.role === 'user') {
        historyParts.push(`[User]: ${text}`);
      } else if (msg.role === 'assistant') {
        historyParts.push(`[Assistant]: ${text}`);
      }
    }

    contentBlocks = [];
    if (historyParts.length > 0) {
      contentBlocks.push({
        type: 'text',
        text: `Previous conversation:\n${historyParts.join('\n\n')}`,
      });
    }

    // Convert the last user message's content parts to Anthropic blocks
    contentBlocks.push(...(await contentPartsToBlocks(parts)));
  }

  return { systemPrompt, prompt, contentBlocks };
}

/**
 * Extract text content from SDK AssistantMessage content blocks.
 */
export function extractTextFromContentBlocks(
  content: ReadonlyArray<{ type: string; text?: string }>
): string {
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      block.type === 'text' && typeof block.text === 'string'
    )
    .map(block => block.text)
    .join('');
}
