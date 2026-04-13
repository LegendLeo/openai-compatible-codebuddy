import type { ChatMessage } from '../types/index.js';

export interface ConvertedPrompt {
  systemPrompt: string | undefined;
  prompt: string;
}

/**
 * Convert OpenAI-style messages array to CodeBuddy SDK prompt + systemPrompt.
 *
 * - system messages → merged into systemPrompt
 * - user/assistant messages → serialized into a single prompt string
 */
export function convertMessages(messages: ChatMessage[]): ConvertedPrompt {
  const systemMessages: string[] = [];
  const conversationParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemMessages.push(msg.content);
    } else if (msg.role === 'user') {
      conversationParts.push(msg.content);
    } else if (msg.role === 'assistant') {
      conversationParts.push(`[Assistant]: ${msg.content}`);
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
      if (msg.role === 'user') {
        parts.push(`[User]: ${msg.content}`);
      } else if (msg.role === 'assistant') {
        parts.push(`[Assistant]: ${msg.content}`);
      }
    }
    prompt = parts.join('\n\n');
  }

  return { systemPrompt, prompt };
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
