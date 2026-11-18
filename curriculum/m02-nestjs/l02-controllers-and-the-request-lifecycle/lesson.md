---
title: Controllers and the request lifecycle
skills: [nest-request-lifecycle]
---

A controller maps HTTP requests to methods. Around each method Nest runs a fixed sequence of stages, and most "why did my code not run?" questions are answered by knowing that sequence. This lesson covers both.

## Controllers

```ts
import {
  Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, Post, Query,
} from '@nestjs/common';
import { NotesService } from './notes.service.js';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('tag') tag?: string) {
    return this.notes.list(tag);                 // 200, serialised as JSON
  }

  @Post()
  create(@Body() input: { title: string }) {
    return this.notes.create(input);             // 201: the default for @Post()
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string): void {
    if (!this.notes.remove(id)) throw new NotFoundException(`Note ${id} not found`);
  }
}
```

The essentials:

- `@Controller('notes')` sets a path prefix. `@Get()`, `@Post()`, `@Put()`, `@Patch()` and `@Delete()` bind a method and an optional sub-path.
- `@Param`, `@Query` and `@Body` pull parts of the request into arguments. Route and query parameters are **strings** unless a pipe converts them.
- The return value becomes the response body. Objects and arrays are sent as JSON, and a returned Promise is awaited.
- The status is `200`, or `201` for `@Post()`. Change it with `@HttpCode()`. Set fixed headers with `@Header()`.
- To signal an error, throw. Do not build the error response by hand.

You can inject the raw Express response with `@Res()`, but then Nest stops sending the response for you and interceptors lose the return value. If you only need to set a dynamic header or cookie, use `@Res({ passthrough: true })` and still return the body.

## The lifecycle

For a request that matches a route, Nest runs these stages in order:

**middleware → guards → interceptors (before) → pipes → handler → interceptors (after)**

Then the response is sent. If any stage throws, the rest is skipped and **exception filters** build the response instead.

| Stage | Question it answers | Typical use |
| --- | --- | --- |
| Middleware | What should happen to every raw request? | Request ids, security headers, body parsing |
| Guard | May this request reach this handler? | Authentication, roles |
| Interceptor | What wraps the handler call? | Timing, logging, response mapping, caching |
| Pipe | Is each argument valid, and in which type? | Validation, `"42"` to `42` |
| Handler | What does the request do? | Call a service |
| Exception filter | How does an error become a response? | One error format for the API |

Why so many kinds? They know different things. Middleware is plain Express: it sees `req` and `res` and has no idea which handler will run. A guard receives an `ExecutionContext`, so it can read metadata on the target handler such as `@Roles('admin')`. A pipe sees one argument at a time. An interceptor wraps the whole call:

```ts
import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = performance.now();                        // "before" part
    return next
      .handle()                                               // pipes and the handler run inside
      .pipe(tap(() => console.log(`${Math.round(performance.now() - started)} ms`))); // "after" part
  }
}
```

The React parallel is a higher-order component: code before, the wrapped thing, code after. `next.handle()` returns an RxJS `Observable`; all you need for now is that operators in `.pipe(...)` run once the handler has produced its result.

Within each stage, globally bound pieces run first, then controller-level, then route-level. For the "after" part of interceptors and for filters the order is reversed, the most specific one first.

## When a stage throws

Everything after the failing stage is skipped, and the exception goes to the filters.

- A guard that returns `false` makes Nest throw `ForbiddenException`. Interceptors, pipes and the handler never start.
- A pipe throws inside `next.handle()`. The handler does not run. The interceptor's stream ends with an error, so a plain `tap(() => ...)` is skipped; only `catchError`, `finalize` or `tap({ error })` see it.
- If the handler throws, the same happens one step later.

So a timing interceptor like the one above logs successes only, and it never sees a request that a guard rejected.

Filters handle exceptions thrown from guards, interceptors, pipes, handlers and Nest-managed middleware. If you bind no filter, Nest's built-in one turns an `HttpException` into its status with a JSON body, and anything else into a generic `500`.

## Common mistakes

- Doing authorisation in middleware. It cannot know the handler or its metadata. Use a guard.
- Expecting `@Param('id') id: number` to deliver a number. The annotation changes nothing at run time; add `ParseIntPipe`.
- Logging requests in an interceptor and wondering where the `401`s went.
- Using `@Res()` without `passthrough` and returning a value. The request hangs because nobody sends the response.
- Putting business rules in the controller. Keep it a thin translation layer between HTTP and a service.

## Go deeper

- [NestJS: Controllers](https://docs.nestjs.com/controllers): every routing and parameter decorator.
- [NestJS: Request lifecycle](https://docs.nestjs.com/faq/request-lifecycle): the full ordering, including global, controller and route levels.
- [NestJS: Guards](https://docs.nestjs.com/guards): `ExecutionContext` and reading handler metadata.
- [NestJS: Interceptors](https://docs.nestjs.com/interceptors): response mapping, error mapping and timeouts with RxJS.
- [MDN: HTTP response status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status): which code fits which outcome.
