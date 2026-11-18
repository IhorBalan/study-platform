import { Injectable, Logger } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { APICallError, streamText, type LanguageModel } from 'ai';
import type { ChatEvent } from './chat.dto.js';

const INSTRUCTIONS =
  'You are the help assistant of a project management app. Answer briefly. ' +
  'If you do not know, say so.';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly model: LanguageModel;
  private readonly timeoutMs: number;

  constructor() {
    const baseURL = process.env.LLM_BASE_URL;
    const modelId = process.env.LLM_MODEL;
    if (!baseURL || !modelId) throw new Error('LLM_BASE_URL and LLM_MODEL must be set');
    const provider = createOpenAICompatible({
      name: 'llm',
      baseURL,
      apiKey: process.env.LLM_API_KEY,
      includeUsage: true,
    });
    this.model = provider.chatModel(modelId);
    this.timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  }

  /**
   * Streams the model's answer as ChatEvents. Ends with exactly one 'done' or 'error'.
   * `signal` aborts when the client goes away; the upstream request is cancelled with it.
   */
  async *answer(message: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const result = streamText({
      model: this.model,
      instructions: INSTRUCTIONS,
      messages: [{ role: 'user', content: message }],
      maxOutputTokens: 512,
      maxRetries: 0, // a person is waiting: fail fast and let the client decide
      abortSignal: AbortSignal.any([signal, timeout]),
      onError: () => {}, // errors arrive as stream parts below
    });

    for await (const part of result.stream) {
      switch (part.type) {
        case 'text-delta':
          if (part.text) yield { type: 'delta', data: { text: part.text } };
          break;
        case 'finish':
          yield {
            type: 'done',
            data: {
              finishReason: part.finishReason,
              usage: {
                inputTokens: part.totalUsage.inputTokens ?? null,
                outputTokens: part.totalUsage.outputTokens ?? null,
              },
            },
          };
          return;
        case 'abort':
          // A client that left needs no event; a timeout does.
          if (timeout.aborted && !signal.aborted) yield { type: 'error', data: { code: 'timeout' } };
          return;
        case 'error':
          yield { type: 'error', data: { code: this.classify(part.error) } };
          return;
      }
    }
  }

  private classify(error: unknown): 'rate_limited' | 'upstream_error' {
    // Log the details for us; the client gets a code only.
    this.logger.warn(`LLM call failed: ${error instanceof Error ? error.message : String(error)}`);
    if (APICallError.isInstance(error) && error.statusCode === 429) return 'rate_limited';
    return 'upstream_error';
  }
}
