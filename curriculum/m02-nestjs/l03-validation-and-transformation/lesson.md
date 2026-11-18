---
title: Validation and transformation
skills: [nest-validation]
---

`@Body() input: CreateNote` looks like a guarantee. It is not: the annotation is erased at compile time, and `input` is whatever JSON the client chose to send. Validation is the step that turns that claim into a fact, and in Nest it belongs in a pipe, before the handler runs.

## Validate at the boundary

In React you validate a form for the user's convenience. The server cannot see your form; it sees bytes from anyone who can reach the port, including `curl`, old versions of your app and people looking for holes. So every value that crosses the boundary (body, query string, route parameters, headers) is `unknown` until checked.

Check it once, at the edge, and the code behind the edge can trust its types. A pipe is the natural place: it runs for each handler argument, and it either returns the value (possibly converted) or throws, which becomes a `400` before your handler is called.

Nest offers two well-supported ways to describe the rules.

## Option 1: class-validator DTOs

The long-standing default. You describe the input as a class with decorators, and `ValidationPipe` checks it.

```ts
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateNoteDto {
  @IsString()
  @Length(1, 100)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}
```

```ts
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

@Module({
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
```

The handler is `create(@Body() input: CreateNoteDto)`. The pipe learns the class from the same `design:paramtypes` metadata that powers injection, so the DTO must be a class imported as a value. With an interface the pipe sees `Object` and validates **nothing**, silently. With `import type` the class is lost as well: your rules are never applied.

The three options matter:

- `whitelist` removes properties that have no decorator.
- `forbidNonWhitelisted` rejects the request instead of removing them. A client that misspells a field finds out.
- `transform` returns a real `CreateNoteDto` instance instead of a plain object, and converts primitive route and query arguments to their declared type.

## Option 2: a schema through Standard Schema

Parameter decorators accept a `schema` option that takes any Standard Schema library, such as zod:

```ts
import { z } from 'zod';

export const CreateNoteSchema = z.strictObject({
  title: z.string().min(1).max(100),
  body: z.string().max(2000).optional(),
});
export type CreateNote = z.infer<typeof CreateNoteSchema>;
```

```ts
@Post()
create(@Body({ schema: CreateNoteSchema }) input: CreateNote) {
  return this.notes.create(input);
}
```

The option only **attaches** the schema to the parameter. A pipe has to run it, and Nest ships one:

```ts
{ provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() }   // from @nestjs/common
```

Leave that line out and invalid input passes straight through. Note `strictObject`: a plain `z.object` drops unknown keys without complaining, like `whitelist` without `forbidNonWhitelisted`.

## Which one

| | class-validator | Schema (zod) |
| --- | --- | --- |
| Static type | Written by hand as the class | Inferred from the schema |
| Depends on decorator metadata | Yes | No |
| Result | Class instance (with `transform`) | Plain object |
| Ecosystem | Most Nest examples and plugins, including OpenAPI | Shareable with a frontend; newer in Nest |

Pick one per project. Mixing both means two error formats and two sets of habits.

## Custom pipes

A pipe is a class with one method. Write your own when a rule involves one argument and is reused:

```ts
import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';

@Injectable()
export class ParsePagePipe implements PipeTransform<string | undefined, number> {
  transform(value: string | undefined): number {
    const page = Number(value ?? '1');
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page must be a positive integer');
    }
    return page;
  }
}
```

Use it as `@Query('page', ParsePagePipe) page: number`. Built-in pipes such as `ParseIntPipe` and `ParseUUIDPipe` cover the common conversions.

## Where to register

A pipe can be bound to one parameter, one route (`@UsePipes`), one controller, or globally. For a global pipe prefer the `APP_PIPE` provider over `app.useGlobalPipes()` in `main.ts`: the provider is part of the module, so tests that build the app from `AppModule` get the same validation as production.

## What validation does not do

A valid shape is not permission. `{ "ownerId": "someone-else" }` can be a perfectly valid string. Validation answers "is this well-formed?"; guards and services answer "is this caller allowed?" and "does this make sense right now?".

## Common mistakes

- Trusting the TypeScript type of `@Body()` with no pipe behind it.
- `import type { CreateNoteDto }`, or an interface as the DTO. `ValidationPipe` then never sees your rules.
- Passing `{ schema }` without registering `StandardSchemaValidationPipe`.
- Leaving unknown fields in and spreading the body into a database row. That is mass assignment: the client sets `isAdmin`.
- Forgetting limits. A string without a maximum length is an invitation to send megabytes.

## Go deeper

- [NestJS: Pipes](https://docs.nestjs.com/pipes): binding levels, built-in pipes and schema-based validation.
- [NestJS: Validation](https://docs.nestjs.com/techniques/validation): every `ValidationPipe` option. Check it for the current options of the schema pipe.
- [class-validator](https://github.com/typestack/class-validator): the full list of decorators.
- [Zod](https://zod.dev): schema API, strict objects and coercion.
- [Standard Schema](https://standardschema.dev): the small interface that lets frameworks accept any schema library.
