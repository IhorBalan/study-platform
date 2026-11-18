---
title: How the startup interview loop works
skills: [interview-loop]
---

Interviews at startups and small companies are shorter, more practical and less scripted than the big-tech loops most prep material is written for. If you know which rounds to expect and what each one is really scoring, you can spend your preparation time where it pays. This lesson maps the loop and gives you a preparation plan that fits a frontend developer moving towards backend work.

## The shape of a loop

A typical seed to Series C company runs three to five rounds over one to three weeks. Big tech usually runs five to seven rounds over several weeks. A common sequence:

1. **Recruiter or founder screen**, about 30 minutes. Motivation, background, logistics, salary range. At a ten-person company this is often a founder, and it is already a fit interview.
2. **Hiring manager call**, about 45 minutes. Your past projects in depth, how you work, what you want next.
3. **One technical round**, 60 to 90 minutes. Live coding, pair programming, or the review call for a take-home.
4. **A final loop** of three to five sessions, often on one day: system design, a code review or debugging session, a deep dive on something you claim to know, and a conversation with founders or the team.

Small companies vary more than large ones. Some skip take-homes to respect your time. Some replace system design with "design the feature we are building next quarter". Ask the recruiter for the format of every round. It is a normal question, and the answer tells you what to practise.

## The formats, and what each one judges

| Format | Typical length | What earns points |
| --- | --- | --- |
| Practical live coding or pairing | 60 to 90 min | Clarifying questions, small steps, tests, sensible types. Not puzzles. |
| Take-home | 4 to 8 h, then a call | Structure, tests, a README that states assumptions, scope discipline, defending trade-offs |
| Code review of a pull request | 30 to 60 min | Finding the bugs that matter first, security, N+1 queries, missing tests, the tone of your comments |
| System design | 45 min | A design a team of 3 to 10 can build and run. "10K users now, 100K next year." |
| Technical deep dive | 30 to 45 min | Depth on what is on your CV. "Walk me through the Node.js event loop." |
| Debugging | 30 to 60 min | Method: measure, form a hypothesis, verify, then fix |
| Light algorithms | 30 to 45 min | Hash maps, sorting, Big-O. Less common at product startups, not rare |

The first four are the ones you will meet most at small product companies, roughly in that order. The rest of this module has one lesson and at least one task for each of them.

## What the scorecard looks like

When there is a written rubric, it usually has these dimensions:

- **Problem decomposition.** Do you break a vague problem into pieces before typing?
- **Technical depth for the level.** Can you go one or two "why" questions deep on what you use?
- **Trade-offs.** Do you name what your choice costs, not only what it buys?
- **Ownership.** Do you talk about outcomes you drove, or tasks you were given?
- **Culture add.** What do you bring that the team lacks?

At founder-led companies there is often no scorecard at all. The signal comes from conversation, so being easy to talk to through a technical problem counts for a lot. Thinking out loud is not a performance trick. It is how the interviewer collects evidence for every line above.

## What startups weigh differently

Startups hire for speed, ownership and comfort with ambiguity. That changes how answers land:

- "The architecture review took four weeks" sounds slow. "I shipped a first version in two weeks and iterated" sounds right.
- "I escalated to my manager's manager" sounds like you wait for permission. "I wrote a one-page proposal, got two engineers to agree, and did it" sounds like ownership.
- Over-engineering is a red flag. Proposing Kubernetes and Kafka for five engineers and a thousand users tells the interviewer you would spend their runway on infrastructure.

## Your angle as a frontend developer

You are not starting from zero, and you should not present yourself that way. Things that transfer and are worth saying out loud:

- You have consumed many APIs. You know what a confusing error format, a missing pagination cursor or an inconsistent status code costs the client. That is API design experience from the other side.
- You have debugged performance in the browser: profiling, measuring before optimising, avoiding needless re-renders. The same method works for a slow query or a blocked event loop.
- You have shipped TypeScript in production. Discriminated unions, `unknown` over `any`, and validating data at the boundary carry straight over.
- You have worked close to product and design. Startups value engineers who can talk to users and cut scope.

The gap is usually depth on databases, concurrency and operating a service in production. The core modules of this course close it. In an interview, say plainly what you have done in production and what you have practised. "I built this in a practice environment, here is what I learned" is honest and fine. Claiming production experience you do not have falls apart in the first follow-up question.

## A preparation plan

Two to three weeks of focused evening work is enough for most loops if the core modules are behind you.

1. **Find out the format.** Ask the recruiter what each round is. Read the company's engineering blog and job post for their stack.
2. **Build a story bank.** Six to eight stories, written down, that cover the common behavioural prompts. Lesson 5 shows how.
3. **Do two timed mock designs.** Use a timer and say everything out loud. Tasks 1 and 2 in this module are built for that.
4. **Do one time-boxed take-home.** Task 3. Stop when the timer stops and write down what you would do next.
5. **Review a pull request out loud.** Task 4. Practise finding the important problems first.
6. **Run the card decks daily.** The most-asked deck in lesson 7 is a good warm-up the morning of an interview.
7. **Prepare your questions for them.** Runway, team size, who is on call, how decisions get made, what the first 90 days look like.

### Questions worth asking at the end

The last five minutes are yours. Good questions show you think like an owner, and the answers help you decide:

```text
How many months of runway do you have, and what has to be true for the next raise?
Who is on call, how often does it page, and what was the last incident?
How does a technical decision get made here? Give me a recent example.
What would you want me to have shipped by the end of my first three months?
```

## Common mistakes

- Preparing only for big-tech algorithm rounds when the loop is practical coding and system design.
- Not asking what each round is. Recruiters will tell you.
- Coding in silence. The interviewer cannot score reasoning they never hear.
- Overselling backend experience you do not have, then failing the first follow-up.
- Designing for a scale the company will not reach for years.
- Having no questions for the interviewers, or asking only about perks.

## Go deeper

- [Underdog.io: startup interview process](https://underdog.io/blog/startup-interview-process): stages, timelines and what each round looks for.
- [Trunk.io: how we crack the coding interview](https://trunk.io/blog/how-we-crack-the-coding-interview): one startup's own loop, described by the people who run it.
- [techinterview.org: behavioural at startups vs FAANG](https://www.techinterview.org/post/3233474692/behavioral-startup-vs-faang/): why founder-led conversations are scored differently.
- [Tech Interview Handbook: STAR format](https://techinterviewhandbook.org/star-format/): the structure behind behavioural answers, used in lesson 5.
