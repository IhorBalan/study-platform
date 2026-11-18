Write a short design document for the messaging core of a team chat product. Use the structure from lesson 7. Aim for 900 to 1,500 words, with a box diagram in ASCII or Mermaid, short SQL for the tables and a sketch of the messages that travel over the socket.

## The product

> **Huddle** is team chat for small companies: channels, direct messages, mentions. It has 2,500 customer companies and 50,000 users. On a working day, up to 25,000 users are connected at the same moment, from browsers and mobile apps. They send about 2 million messages a day, almost all during working hours. A channel has 2 to 300 members; a company's `#general` can have 500.
>
> The team is five engineers. The stack is a NestJS app on PostgreSQL 18 and Valkey, running as several instances behind a load balancer on a container platform. A notification service already exists and sends push and email when you call it with a user and a payload.

Product requirements for this design:

- A message sent in a channel appears for connected members **within a second** in most cases.
- Every member sees a channel's messages **in the same order**, and a message is **never shown twice** or lost, even when the sender's connection drops while sending.
- **Unread counts** per channel are shown in the sidebar and are correct after switching devices.
- Users scroll back through **all history**. Edits and deletes are reflected for everyone.
- **Typing indicators and presence** (online, away) are shown.
- A user who is **not connected** and is mentioned gets a push notification.
- A deploy restarts every instance during working hours, a few times a day.

## What to cover

1. **Requirements.** Goals, non-goals (say what you are not building, such as search, threads, file sharing or end-to-end encryption), and two questions with assumed answers.
2. **Numbers.** Messages per second at peak, socket connections per instance, deliveries per second after fan-out to channel members, and storage per year. Say what they decide.
3. **Data model.** Channels, memberships, messages, and how unread counts are stored. Keys, constraints and the indexes that history and unread counts need.
4. **Sending and delivery.** The path of one message from the sender's socket to every connected member on any instance, in numbered steps. Where it is persisted, where it is published, and in which order.
5. **Ordering and duplicates.** How order is defined, how a client's retry after a dropped connection does not create a second message, and how a reconnecting client catches up on what it missed.
6. **Ephemeral state.** Typing and presence: where they live, how long, and why.
7. **Failure modes.** An instance dying with 4,000 connected users, every client reconnecting after a deploy, Valkey restarting, Postgres being slow, and a mention for an offline user.
8. **Trade-offs and what you left out,** with a revisit signal for each.

## What is assessed

Whether the design persists before it publishes and lets clients resynchronise, whether ordering and duplicate prevention are concrete, whether unread counts work across devices without counting rows on every request, whether ephemeral state is kept out of Postgres, whether reconnect storms and instance failures are handled, and whether it stays buildable by five engineers. There are no automated checks.
