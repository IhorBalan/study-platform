---
title: Errors and exception filters
skills: [nest-errors]
---

Every API fails sometimes. What matters is that it fails in a way a client can program against and an operator can investigate, without telling an attacker how the system is built. In Nest that is the job of exceptions and exception filters.

## The HttpException family

To end a request with an error you throw. Nest ships a class for each common status: `BadRequestException` (400), `UnauthorizedException` (401), `ForbiddenException` (403), `NotFoundException` (404), `ConflictException` (409) and more. All of them extend `HttpException`.

```ts
@Get(':id')
find(@Param('id') id: string) {
  const note = this.notes.find(id);
  if (!note) throw new NotFoundException(`Note ${id} not found`);
  return note;
}
```

With no filter of your own, Nest's built-in one answers:

```json
{ "message": "Note 42 not found", "error": "Not Found", "statusCode": 404 }
```

Anything that is not an `HttpException`, such as a `TypeError` or a failed query, becomes a `500` with a generic message. That default is safe, but the shape is Nest's own.

## Domain errors stay out of HTTP

A service should not know that it is being called over HTTP. Tomorrow the same service may be called by a queue worker or a CLI command, where "409" means nothing. So a service signals business failures with its own error classes:

```ts
export class NotesLimitReachedError extends Error {
  constructor(readonly limit: number) {
    super(`The store already holds the maximum of ${limit} notes`);
    this.name = 'NotesLimitReachedError';
  }
}
```

The translation to a status happens at the edge, in one place: either the controller catches and rethrows, or (less repetitive) the exception filter knows the mapping. Infrastructure failures such as a lost database connection are different. Clients cannot act on them, so they are not mapped at all and fall through to `500`.

## One error format: problem details

RFC 9457 defines a standard JSON error body, served as `application/problem+json`:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "The store already holds the maximum of 100 notes"
}
```

`type` is a URI that identifies the kind of problem; `about:blank` means "nothing beyond the HTTP status". `title` is a short, stable summary, `status` repeats the status code, and `detail` explains this occurrence. You may add your own members, for example `errors` with a list of validation messages. A frontend can then handle every failure of every endpoint with one function.

## A global exception filter

A filter decorated with `@Catch()` and no arguments receives every exception.

```ts
import { STATUS_CODES } from 'node:http';
import {
  Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { NotesLimitReachedError } from '../notes/notes-limit-reached.error.js';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let detail: string | undefined;
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();      // a string, or an object with `message`
      const message = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      if (Array.isArray(message)) {
        errors = message.map(String);            // ValidationPipe: one entry per failed rule
        detail = 'The request body is not valid.';
      } else {
        detail = String(message);
      }
    } else if (exception instanceof NotesLimitReachedError) {
      status = 409;
      detail = exception.message;
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const title = STATUS_CODES[status] ?? 'Error';   // 409 -> "Conflict"
    res.status(status).type('application/problem+json').json({ type: 'about:blank', title, status, detail, errors });
  }
}
```

Register it through the container, so that it applies however the app is created and can inject providers:

```ts
providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }]   // APP_FILTER from @nestjs/core
```

Note the three branches: exceptions that already carry a status, domain errors you map on purpose, and everything else.

`ValidationPipe` puts an array of messages in `message`. Joining them into one string gives a client nothing it can map to form fields, so the filter keeps them as a list in an `errors` extension member. Module 4 refines this into one entry per field with a `pointer` to it.

## Do not leak internals

The last branch sends no `detail`. An unexpected error's message may contain SQL, file paths, host names or credentials from a connection string. All of it helps an attacker and none of it helps a legitimate client. The rule: messages you wrote for clients (`HttpException`s and domain errors) may go out; messages written by libraries or the runtime stay in.

## Logging

What the client must not see, the operator must. Log every unexpected error with its stack, plus the method, the path and a request id if you have one, so a user's report can be matched to a log line. Expected `4xx` responses are the client's mistake: log them at a low level or not at all, or the real errors drown. And never log request bodies or headers wholesale. They carry passwords and tokens.

## Common mistakes

- Returning `{ error: '...' }` with status `200`. Clients, caches and monitoring all read the status code.
- Throwing `HttpException` subclasses deep inside services, which welds business logic to one transport.
- `catch (e) { throw new InternalServerErrorException(e.message) }`. That copies an internal message into the response.
- Catching an error, logging it and continuing as if nothing happened.
- A `@Catch(HttpException)` filter that is believed to be global. Everything else still gets Nest's default body.
- Registering the filter only in `main.ts`, so tests that build the app from `AppModule` see different errors.

## Go deeper

- [NestJS: Exception filters](https://docs.nestjs.com/exception-filters): built-in exceptions, binding levels and `ArgumentsHost`.
- [RFC 9457: Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457): the members, extension rules and media type.
- [NestJS: Logger](https://docs.nestjs.com/techniques/logger): log levels and replacing the default logger.
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status): choosing between 400, 404, 409 and 422.
