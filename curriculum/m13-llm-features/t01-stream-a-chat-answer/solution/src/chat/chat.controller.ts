import { Body, Controller, HttpCode, RequestMethod, Sse, SseSignal, type MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ChatRequestSchema, type ChatRequest } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Sse('stream', { method: RequestMethod.POST })
  @HttpCode(200)
  stream(
    @Body({ schema: ChatRequestSchema }) body: ChatRequest,
    @SseSignal() signal: AbortSignal,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const local = new AbortController();
      const abort = () => local.abort();
      signal.addEventListener('abort', abort, { once: true });
      (async () => {
        for await (const event of this.chat.answer(body.message, local.signal)) {
          subscriber.next({ type: event.type, data: event.data });
        }
        subscriber.complete();
      })().catch((error: unknown) => subscriber.error(error));
      // Runs when the client disconnects or the stream completes.
      return () => {
        signal.removeEventListener('abort', abort);
        local.abort();
      };
    });
  }
}
