---
title: Behavioural questions and a story bank
skills: [interview-behavioural]
---

Every loop has behavioural questions, and at a founder-led startup they may be the whole conversation. "Tell me about a time..." is not small talk. The interviewer is collecting evidence of ownership, judgement and how you behave when things go wrong. This lesson shows how to structure answers without sounding rehearsed, how to build a reusable story bank from a frontend career, and how to handle startup-fit questions.

## What is being measured

A behavioural question asks for past behaviour because it predicts future behaviour better than hypotheticals do. "How would you handle a disagreement?" invites a textbook answer. "Tell me about a disagreement" invites a real one, with details that are hard to invent.

At startups the evidence they want is specific:

- **Ownership.** You noticed a problem and fixed it without waiting to be asked.
- **Speed with judgement.** You shipped something useful quickly and knew which corners were safe to cut.
- **Comfort with ambiguity.** You made progress when requirements were unclear.
- **Learning.** You changed how you work after a mistake.
- **Communication.** You disagreed productively and wrote things down.

## STAR, kept short

STAR is a structure, not a script:

- **Situation:** the context in one or two sentences. Team, product, stakes.
- **Task:** what you specifically had to achieve or decide.
- **Action:** what *you* did, in detail. This is most of the answer.
- **Result:** what happened, with a number if you have one, and what you learned.

A good answer is 90 seconds to two minutes, with roughly 10% situation, 10% task, 60% action and 20% result. Most weak answers invert that: two minutes of background and one sentence of action.

### Sounding real, not rehearsed

You write the stories down to remember the facts, not to memorise sentences. Practise from bullet points, never from a script. Other things that help:

- **Say "I", not "we", for your part.** "We migrated the API" hides you. "I wrote the migration plan and moved the first two endpoints" shows you.
- **Use concrete details.** Names of tools, numbers, dates, what someone actually said. Details are what make a story credible.
- **Include a real difficulty.** A story where everything went well proves nothing.
- **Stop after the result.** Let the interviewer ask follow-ups. They will, and the follow-ups are where they score depth.

## A worked answer

Prompt: "Tell me about a production incident or a bug you caused."

> **Situation.** I was one of four engineers at a B2B scheduling product. I owned the booking page, a React app calling our Node API.
>
> **Task.** I shipped a change to how the page loaded availability, and two days later support reported customers seeing double-booked slots.
>
> **Action.** I checked our error tracker first and found nothing, so it was not a crash. I reproduced it by opening two tabs and booking the same slot within a second: both succeeded. My change had removed a client-side disable that had been hiding a missing check in the API. The API read the slot, checked it was free, then inserted, with no constraint. I wrote it up in the team channel within the hour, added a unique constraint on slot and resource in the database with the backend lead, and changed the API to return 409 on a conflict, which the page now handles. I also wrote a test that fires two bookings in parallel.
>
> **Result.** No double bookings since, and we found three other check-then-insert endpoints with the same pattern and fixed them in the next sprint. What I took from it: the client is never the guard. That incident is a big part of why I am moving towards backend work.

Notice the shape: short context, a lot of specific action, a result with a follow-on, and an honest lesson. It also bridges the frontend background towards the role.

## Your 60-second pitch

Almost every screen opens with "Tell me about yourself". It is not small talk. For a frontend developer applying to a backend-heavy role it is the answer that decides how the rest of the call is heard, because the interviewer's unspoken question is "why should I believe this person can do backend work?". Answer it before they ask.

A pitch has four parts and takes about a minute:

1. **Now.** Your role and what you build, in one sentence.
2. **Backend evidence.** Two concrete things you have done on the server side, with a number or an outcome where you have one.
3. **Why the move.** What pulls you towards backend work. Keep it positive and specific.
4. **What you want next.** One sentence that matches the role you are talking about.

A worked example:

> I'm a frontend developer with five years in React, most recently on a booking product used by about 200 clinics. Over the last year more of my work has been on the server: I wrote our Next.js route handlers and the webhook that syncs payments, and I tracked a slow dashboard down to an N+1 query and fixed it with the backend team, which cut the page from four seconds to under one. I found I enjoy that side more, the data model, the failure cases, what happens under load, so I have been building it up deliberately: a NestJS and Postgres service with tests, queues and a deployment pipeline. I'm looking for a role where I own features end to end, API and data included, and your team's size is the reason I applied.

Write yours down, then say it aloud until it stops sounding written. Do not recite your CV in order, and do not apologise for the frontend years: they are why you understand what an API's consumer needs.

### The salary question

Recruiter screens often ask "What are your salary expectations?". Decide your answer before the call. Either give a range you have researched for the role, level and location, with the bottom of the range a number you would accept, or ask for theirs first: "What is the range for this position?" is a normal question and many companies will answer it. Do not name a number you made up on the spot, and do not anchor on your current salary if you are changing role.

## Building a story bank

You need six to eight stories that together cover the common prompts. One good story usually answers two or three questions from different angles. The common prompts at startups:

1. A project you are proud of. What was your part, and what would you change?
2. A challenging project that forced you to learn something new.
3. A time you disagreed with a teammate or your manager.
4. A time you shipped with incomplete requirements.
5. A production incident or a bug you caused, and what you changed afterwards.
6. A time you cut scope or took on tech debt deliberately, and how you paid it back.
7. Why a startup instead of a big company?
8. How do you use AI coding tools, and how do you check their output?

Keep the bank in a simple table and write each story as STAR bullet points:

| Story | Covers prompts | Numbers | Backend angle |
| --- | --- | --- | --- |
| Double-booking incident | 5, 2 | 3 endpoints fixed | constraints, 409, concurrency test |
| Replaced polling with SSE | 1, 6 | 40% fewer requests | real-time, load |
| Shipped onboarding without final designs | 4, 3 | live in 2 weeks | scoped API, feature flag |

### Mining a frontend career

Frontend work is full of backend-relevant stories if you look for them:

- An API contract you negotiated or fixed with the backend team.
- A performance problem you measured and fixed, especially if the cause was on the server (an N+1 behind a slow page, an uncached endpoint).
- An incident where a client change exposed a server bug, like the example above.
- A BFF, a Next.js route handler, a serverless function or a webhook you wrote.
- A migration you led: a framework upgrade, a design system rollout. These show planning and risk management.

## Startup-fit questions

These have no STAR shape, but they still want specifics.

- **"Why a startup?"** Talk about what you want to do, not what you want to avoid. "I want to own features end to end, including the API and the data, and see customers use them within a week" beats "big companies are slow".
- **"What would you do if our main thesis turned out to be wrong?"** They test whether you can handle change. Talk about learning fast from data, and about having done it before if you have.
- **"How do you stay current?"** Name two or three concrete sources and one thing you changed because of them.
- **"How do you use AI tools?"** Be honest and specific. Say what you use them for, and how you check the output: reading every diff, tests, running it.

## Common mistakes

- Long situation, thin action. The action is what they score.
- "We" everywhere, so the interviewer cannot tell what you did.
- Stories with no conflict, no mistake and no number.
- A "weakness" or "mistake" story that is a disguised strength. Interviewers see through it.
- Memorised scripts that sound flat and break on the first follow-up.
- Criticising a former employer or colleague by name.

## Go deeper

- [Tech Interview Handbook: STAR format](https://techinterviewhandbook.org/star-format/): the structure, with examples and pitfalls.
- [techinterview.org: behavioural at startups vs FAANG](https://www.techinterview.org/post/3233474692/behavioral-startup-vs-faang/): how founder-led companies calibrate.
- [Underdog.io: startup interview process](https://underdog.io/blog/startup-interview-process): where the behavioural signal comes from in each round.
