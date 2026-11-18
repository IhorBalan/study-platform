---
title: Modules and dependency injection
skills: [nest-di]
---

A NestJS app is a set of classes that need each other: a controller needs a service, the service needs a database client, the client needs configuration. Dependency injection (DI) means no class builds its own collaborators. Each one declares what it needs, and a container builds the objects in the right order and hands them over.

## Why a container

Without DI, `new NotesController(new NotesService(new Db(config)))` appears somewhere, and every test repeats that chain or patches imports. With DI, a class states its needs in its constructor and never learns where they came from. Swapping the real database for a fake is one line of set-up.

You know this shape from React. A component calls `useContext(ThemeContext)` and receives whatever the nearest provider supplied. In Nest the constructor parameter is the `useContext` call, a **provider** is the context provider, and a **token** is the context object used to look the value up. The difference is that Nest resolves the whole graph once at start-up, not on every render.

## Providers and tokens

A provider is a recipe for producing a value, registered under a token. The usual provider is a class, and the class doubles as its own token:

```ts
import { Controller, Injectable } from '@nestjs/common';

@Injectable()
export class NotesService {
  private readonly notes = new Map<string, string>();
  count(): number {
    return this.notes.size;
  }
}

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}
}
```

Nothing calls `new NotesController(...)`. Nest reads the constructor, finds the provider registered under the token `NotesService`, creates it first and passes it in.

## How Nest knows the parameter types

Types are erased at run time, so how does Nest see `NotesService` in that constructor? The answer is two compiler options that NestJS 12 still relies on: `experimentalDecorators` and `emitDecoratorMetadata`. With both on, TypeScript emits a metadata entry for every decorated class, roughly:

```ts
Reflect.defineMetadata('design:paramtypes', [NotesService], NotesController);
```

At start-up Nest reads `design:paramtypes` and uses each entry as a token. Three consequences follow:

- The class needs a decorator (`@Injectable()`, `@Controller()`), or no metadata is emitted for it.
- The parameter type must be a class that exists at run time. An interface is recorded as `Object` and a class brought in with `import type` as `Function`. Either way the real class is lost, and Nest reports that it cannot resolve the dependency.
- `reflect-metadata` must be loaded before any decorated class is defined. That is why `main.ts` imports it first.

## Modules

A module groups the providers and controllers of one feature and decides what the rest of the app may see.

```ts
import { Module } from '@nestjs/common';

@Module({
  imports: [DatabaseModule],        // modules whose exports this one uses
  controllers: [NotesController],
  providers: [NotesService],        // private to this module by default
  exports: [NotesService],          // now visible to modules that import NotesModule
})
export class NotesModule {}
```

Providers are private unless exported, so another feature cannot reach into this one's internals by accident. `@Global()` makes a module's exports visible everywhere without an import. Keep it for true infrastructure such as configuration.

Sometimes two providers need each other: `OrdersService` injects `PaymentsService`, which injects `OrdersService`. Nest cannot build either first and fails at start-up. `forwardRef` postpones the lookup until both classes exist. It goes on both sides, as `@Inject(forwardRef(() => PaymentsService))` in each constructor, and as `forwardRef(() => PaymentsModule)` in `imports` when the cycle crosses modules. Treat it as a patch. A cycle means two features know too much about each other, and the usual fix is to move the part they share into a third provider that both depend on, or to let one side publish an event the other reacts to.

## Custom providers

When the thing to inject is not a class, or needs set-up, spell the recipe out:

```ts
export const CLOCK = Symbol('CLOCK');

const providers = [
  { provide: CLOCK, useValue: { now: () => new Date() } },            // a ready-made value
  { provide: DB, useFactory: (env: Env) => connect(env.DATABASE_URL), // built from other providers
    inject: [ENV] },
  { provide: PaymentGateway, useClass: FakePaymentGateway },          // a different class under the same token
];
```

A token that is a symbol or string carries no type information, so the consumer names it explicitly: `constructor(@Inject(CLOCK) private readonly clock: Clock) {}`. A factory may be `async`; Nest waits for it before the app starts.

## Scopes

By default every provider is a **singleton**: one instance per application, created at start-up and shared by all requests. Keep it that way. Singletons are cheap, and safe as long as they hold no per-request state. Request data belongs in method arguments, not in fields.

`Scope.REQUEST` builds a new instance for each request, and `Scope.TRANSIENT` a new one for each consumer. Request scope spreads: everything that depends on a request-scoped provider becomes request-scoped too, including controllers, so Nest rebuilds that part of the graph on every request. Reach for it rarely.

## Lifecycle hooks and shutdown

A provider often owns something that has to be opened and closed: a database pool, a queue worker, a timer. Nest calls **lifecycle hooks** on every provider, controller and module that implements them. A hook is a method with a fixed name, and each has an interface of the same name with a capital letter.

On start-up, in this order:

1. `onModuleInit()`: the provider's own dependencies are ready. Open connections here.
2. `onApplicationBootstrap()`: every module is initialized. The app starts listening after this.

On shutdown, in this order:

1. `onModuleDestroy()`: shutdown has begun.
2. `beforeApplicationShutdown(signal)`: runs before Nest closes the HTTP server. Stop taking new work here.
3. `onApplicationShutdown(signal)`: the server is closed and requests have finished. Close pools and clients here.

A hook may return a promise, and Nest waits for it before it moves on.

```ts
@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({ connectionString: env.DATABASE_URL });
  }

  async onModuleInit() {
    await this.pool.query('select 1'); // fail at start-up, not on the first request
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
```

The shutdown hooks do **not** run on a signal unless you ask for them. They run when your code calls `app.close()`, and on `SIGTERM` or `SIGINT` only after `app.enableShutdownHooks()` in `main.ts`:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(3000);
```

Without that line a container that receives `SIGTERM` is killed with its pool open and its jobs half done. This is the Nest form of the graceful shutdown you wrote by hand in module 0, and the modules on queues, AWS and Kubernetes rely on it. Hooks are not called on request-scoped providers, whose lifetime Nest does not manage.

## Common mistakes

- Listing a service in `providers` of two modules. Each module gets its own instance, so "shared" state is not shared. Provide it once, export it, import the module.
- Forgetting `exports`. The error names the consuming module; the fix is in the providing module.
- Using `import type` for a class that is injected, or leaving `.js` off a relative import in an ESM project.
- Two files that import each other. One of the classes is `undefined` when the metadata is written. Restructure before reaching for `forwardRef`.
- Storing the current user or request in a field of a singleton service. Concurrent requests overwrite each other.
- Implementing `onApplicationShutdown` and never calling `app.enableShutdownHooks()`, so the hook only ever runs in tests.

## Go deeper

- [NestJS: Modules](https://docs.nestjs.com/modules): feature, shared, global and dynamic modules.
- [NestJS: Providers](https://docs.nestjs.com/providers): the standard provider and optional or property-based injection.
- [NestJS: Custom providers](https://docs.nestjs.com/fundamentals/custom-providers): every `useValue`, `useClass`, `useFactory` and `useExisting` form.
- [NestJS: Injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes): request and transient scope and what they cost.
- [TypeScript handbook: Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html): the legacy decorator model and metadata emission.
- [NestJS: Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events): every hook, their order and how shutdown hooks are enabled.
