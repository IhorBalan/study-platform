import { Body, Controller, NotImplementedException, Post } from '@nestjs/common';
import { ChatRequestSchema, type ChatRequest } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // TODO: turn this into a Server-Sent Events route.
  // - @Sse('stream', { method: RequestMethod.POST }) makes Nest frame the events for you
  // - a POST answers 201 unless you say otherwise; the brief asks for 200
  // - @SseSignal() gives you an AbortSignal that fires when the stream ends or the client leaves
  // - return an Observable<MessageEvent> that emits { type, data } for each ChatEvent
  @Post('stream')
  stream(@Body({ schema: ChatRequestSchema }) body: ChatRequest): never {
    void this.chat;
    void body;
    throw new NotImplementedException();
  }
}
