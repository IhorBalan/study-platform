---
title: Reviewing code in an interview
skills: [interview-code-review]
---

In a code review round you get a pull request, often with problems planted in it, and 30 to 60 minutes to review it out loud or in writing. It tests something live coding cannot: whether you can read someone else's code, see what matters, and say it in a way a teammate would accept. This lesson gives you an order to read in, a checklist per pass, and a way to phrase comments.

## Why order matters

A seeded PR usually has eight to fifteen problems, from a SQL injection to a misspelt variable. Candidates who start at line one and comment on everything in sequence run out of time with a list of naming nits and a missed injection. Interviewers score severity first. Find the problems that lose data, money or user trust before you mention style.

Read the PR in passes, each with a single question:

| Pass | Question | Typical finds |
| --- | --- | --- |
| 0. Context | What is this change for? | The description, the tests touched, the files changed |
| 1. Correctness | Does it do what it claims, on every path? | Missing `await`, wrong condition, off-by-one, unhandled error, wrong status code |
| 2. Security | Can a caller make it do something it should not? | SQL injection, missing auth or ownership check, secrets in code, unvalidated input, leaking internals in errors |
| 3. Data | Is the data still right after this runs, even when it fails halfway? | No transaction around related writes, N+1 queries, missing index, migration that locks a big table |
| 4. Concurrency | What if two of these run at once? | Read-then-write races, double charges, check-then-insert without a constraint |
| 5. Tests | Would a test fail if this broke? | No tests, tests that only cover the happy path, mocks that hide the bug |
| 6. Readability | Will the next person understand it? | Naming, dead code, comments that lie, function too long |

You will not finish every pass in 45 minutes. That is fine, as long as the early passes are done thoroughly.

## A small example

Here is a fragment of a PR that adds "transfer credits between users":

```ts
router.post('/transfers', async (req, res) => {
  const { from, to, amount } = req.body;
  const sender = await db.query(`SELECT * FROM accounts WHERE user_id = ${from}`);
  if (sender.rows[0].balance < amount) return res.status(200).json({ error: 'insufficient' });
  db.query('UPDATE accounts SET balance = balance - $1 WHERE user_id = $2', [amount, from]);
  await db.query('UPDATE accounts SET balance = balance + $1 WHERE user_id = $2', [amount, to]);
  res.json({ ok: true });
});
```

Going pass by pass:

- **Correctness.** The first `UPDATE` is not awaited, so its failure is unhandled and the response can go out before the debit happens. Insufficient funds returns `200`; it should be a `4xx` (`409` or `422`, with a problem body). A missing sender crashes on `rows[0].balance`.
- **Security.** `from` is interpolated into SQL: injection. Nothing checks that the caller owns account `from`, so anyone can drain anyone (broken object-level authorisation). `amount` is not validated: a negative amount reverses the transfer.
- **Data.** Debit and credit are separate statements without a transaction. A crash between them destroys credits.
- **Concurrency.** Two transfers can both read the old balance and both pass the check. Lock the row (`SELECT ... FOR UPDATE`) inside the transaction, or do a conditional update: `UPDATE ... SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1` and check the row count.
- **Tests.** None in the PR.

Seven lines, nine findings. A seeded PR is dense on purpose.

## Phrasing comments

The tone of your comments is scored too. The interviewer is asking: would I like getting this review? Three rules:

1. **Label severity.** Say which comments block the merge. Conventional Comments gives you a shared vocabulary: `issue (blocking):`, `suggestion:`, `question:`, `nitpick (non-blocking):`, `praise:`.
2. **Explain the consequence, then suggest a fix.** "This allows X" is more persuasive than "this is wrong".
3. **Talk about the code, not the author.** "This query" not "you forgot".

Compare:

```text
Weak:   This is SQL injection. Fix it.
Better: issue (blocking): `from` is interpolated into the SQL string, so a body like
        {"from": "1 OR 1=1"} changes the query. Use a parameter: WHERE user_id = $1.
```

```text
Weak:   Why no transaction??
Better: issue (blocking): the debit and the credit run as separate statements. If the
        process dies between them the credits are gone. Wrap both in one transaction
        and lock the sender row with SELECT ... FOR UPDATE.
```

Ask a question when you are not sure something is a bug: "question: is `amount` validated by middleware I can't see? If not, a negative amount reverses the transfer." It is honest, and it shows you know where validation usually lives.

End with a summary, as you would on a real PR: the blocking issues in one list, then non-blocking suggestions, then one line of praise for something genuinely good. Real reviewers start with the summary, so lead with your verdict: "Request changes: three blocking issues, all fixable in this PR."

## Running the round

- **Spend two minutes on context.** Read the PR description and the file list before any code.
- **Talk while you read.** "I'm reading the handler first, then the query helper."
- **Note, then move on.** Jot a one-line note for each find and keep reading. Write the polished comments at the end, worst first.
- **Distinguish taste from defects.** "I'd name this differently, but it's fine" is a valid, non-blocking comment, and saying so shows judgement.
- **Mention what is missing.** No tests, no migration for a new column, no error handling for the third-party call. Missing code is the easiest problem to miss.

## Common mistakes

- Reading top to bottom and spending the time on style.
- Listing problems without saying which block the merge.
- Harsh or vague wording: "this is bad", "why would you do this".
- Missing what is absent: tests, transactions, auth checks.
- Not checking every `await`, and every place a value from the request reaches SQL, a file path or a shell.
- Spotting a bug but not explaining its consequence, so it sounds like an opinion.

## Go deeper

- [Google engineering practices: what to look for in a code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html): a widely used checklist from design to comments.
- [Google engineering practices: code review guide](https://google.github.io/eng-practices/review/): the standard for approving and how to write comments.
- [Conventional Comments](https://conventionalcomments.org/): labels and decorations that make severity explicit.
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/0x00_2025-Introduction/): the security categories behind most seeded vulnerabilities.
