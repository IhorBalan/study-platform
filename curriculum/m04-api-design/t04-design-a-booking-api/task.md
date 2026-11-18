Design the public HTTP API for a small product, the way you would write it up for a review before anyone starts coding. Write 700 to 1,200 words. Tables, lists and short JSON or HTTP examples are welcome; no implementation code.

## The product

**Bloc** runs booking for independent climbing and yoga studios. A mobile app and a web app (both built by the same team) are the only clients today; a public API for studios' own websites is planned for next year.

- A **studio** has **instructors** and publishes **classes**: a title, a start time, a duration, one instructor and a capacity.
- A **member** of a studio books a place in a class. A class can be full.
- A member can cancel a booking up to 6 hours before the class starts. After that, cancelling is not allowed.
- Members see their upcoming bookings and their full booking history (some members have years of it).
- Studio staff list the members booked into a class.
- Booking a class can charge a drop-in fee to the member's saved card, so a booking must never be created twice. The mobile app often loses its connection in studio basements.

## What to cover

1. **Resources and URLs.** Every resource, its URL, and how they relate.
2. **Operations.** For each operation: method, URL, success status and body, and the failure statuses that matter. Include booking a full class and cancelling too late.
3. **Errors.** One error format for the whole API, with an example of a business error and of a validation error.
4. **Lists.** For the class schedule, booking history and a class's member list: pagination style, filters and sorting, and why.
5. **Retries.** How a client retries a booking safely.
6. **Evolution.** Six months after launch, classes may have more than one instructor: the single `instructor` object must become a list. Old app versions stay installed on phones for a year. How do you ship this change, and when would you introduce a new API version instead?

## What is assessed

Whether the URLs, methods and status codes follow HTTP semantics, whether errors and lists are designed for real clients, whether retries are safe, and whether the evolution plan keeps old clients working. There are no automated checks.
