Explain in your own words what happens to a request inside this NestJS app. Write 300 to 500 words, as prose or numbered lists. No code is required.

## The app

`POST /orders` is handled by `OrdersController.create()`. These pieces are in place:

- **`RequestIdMiddleware`**, applied to all routes. It sets an `X-Request-Id` response header and calls `next()`.
- **`ApiKeyGuard`**, global. It throws `UnauthorizedException` when the `X-Api-Key` header is missing or wrong.
- **`TimingInterceptor`**, global. It notes the time, calls `next.handle()` and, when the stream emits a value, logs `POST /orders took 12 ms`. It does nothing else.
- **A validation pipe**, global. It checks the body against the `CreateOrder` schema and throws `BadRequestException` when it does not match.
- **`ProblemDetailsFilter`**, global, decorated with `@Catch()`. It turns `HttpException`s into problem documents with their own status, and everything else into a `500` with a generic body.

## What to cover

1. **A valid request with a correct API key.** List every stage in order, including what runs after the handler returns. Does the filter run?
2. **The same request without the `X-Api-Key` header.** Which stages run, which never start, what the client receives and whether the timing line is logged.
3. **A correct API key with a body that fails validation.** Does the handler run? What does `TimingInterceptor` observe? What does the client receive?
4. **A valid request where the handler throws `TypeError: Cannot read properties of undefined`.** What does the client receive, and is the `X-Request-Id` header on that response?
5. **One sentence per building block** on what it is for: middleware, guard, interceptor, pipe, exception filter.
6. **A fix.** Rejected and failed requests never appear in the timing log. Propose one concrete change that makes them appear, and name one thing it costs or still cannot see.

## What is assessed

Whether the order is right, whether each failure case names the stages that run and those that do not, and whether your fix would work. There are no automated checks.
