Write a short design document for the home feed of a small social product, as you would before building it at work. Use the structure from lesson 7 (context, goals, non-goals, numbers, design, alternatives, failure modes, rollout, open questions). Aim for 900 to 1,500 words, with a box diagram in ASCII or Mermaid, short SQL for the tables, and HTTP for the endpoints.

## The product

> **Trailmark** is an app where hikers post trips (route, photos, a short story) and follow each other. It has 300,000 registered users and about 40,000 daily active users, mostly in the evening and at weekends. Users follow 80 people on average. A few hundred accounts (guides, outdoor brands, park services) have between 20,000 and 150,000 followers.
>
> About 15,000 trips are posted a day. People open the home feed about 6 times a day each and scroll 2 pages of 20 posts on average. Photos are already stored in S3 and served through a CDN; the feed only needs post metadata and photo URLs.
>
> The team is four engineers with a NestJS monolith on PostgreSQL 18, Valkey and BullMQ, deployed on a PaaS.

Product requirements for the feed:

- The home feed shows posts from people you follow, **newest first**. No ranking algorithm in this version.
- The first page loads in under **300 ms p95** on the server.
- A new post appears in followers' feeds **within one minute**.
- When you **unfollow or block** someone, their posts leave your feed on the next refresh. When an author **deletes** a post, it disappears from every feed.
- A user who follows someone new sees that person's recent posts in their feed straight away.

## What to cover

1. **Requirements.** Restate goals, list non-goals, and write two questions you would ask the product owner, with the answer you assume.
2. **Numbers.** Feed reads per second at peak, posts per second, how many feed entries a fan-out would write per day, the worst single fan-out, and storage per year for whatever you store. Say what the numbers decide.
3. **Data model.** Tables with keys and the indexes each query needs, including follows in both directions.
4. **Feed strategy.** Compare fan-out on write (precomputed feeds), fan-out on read (query at request time) and a hybrid, using your numbers. Choose one. Say exactly what happens for an account with 150,000 followers.
5. **API.** Read the feed with cursor pagination, create and delete a post, follow and unfollow. Methods, paths, main status codes.
6. **Edge cases and consistency.** Deletes, unfollows, blocks, a new follow, and how stale each may be.
7. **Failure modes.** A fan-out worker crashing mid-way, a backlog after a viral post, Valkey restarting, and how you would rebuild one user's feed.
8. **Trade-offs and what you left out,** with the signal that would make you revisit each.

## What is assessed

Whether the numbers drive the choice of feed strategy, whether the data model and API serve the stated queries, whether the high-follower case and the delete, unfollow and block rules are handled concretely, whether failures have specific answers, and whether the design stays buildable by four engineers on their current stack. There are no automated checks.
