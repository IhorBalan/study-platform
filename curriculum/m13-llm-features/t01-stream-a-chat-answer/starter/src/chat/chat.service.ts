import { Injectable } from '@nestjs/common';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { ChatEvent } from './chat.dto.js';

@Injectable()
export class ChatService {
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
      includeUsage: true, // ask the server for token counts at the end of the stream
    });
    this.model = provider.chatModel(modelId);
    this.timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 30_000);
  }

  /**
   * Streams the model's answer as ChatEvents and ends with exactly one 'done' or 'error' event.
   * `signal` aborts when the client goes away.
   */
  async *answer(message: string, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    // TODO:
    // - call streamText with this.model, short instructions, the message as a user message,
    //   maxOutputTokens (at most 1024) and maxRetries: 0
    // - cancel the call when `signal` aborts or this.timeoutMs has passed (AbortSignal.any)
    // - turn the parts of result.stream into ChatEvents: text-delta, finish, error, abort
    void message;
    void signal;
    throw new Error('Not implemented');
  }
}
