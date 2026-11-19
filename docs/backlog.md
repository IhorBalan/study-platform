# Backlog

Low-priority polish that was left open when active work stopped on 2026-11-19 (decision D-208 in [decisions.md](decisions.md)). Nothing here is a bug that blocks a learner. Each item fits one small pull request.

The list comes from the last round of reviews: UX round 9, code review 06, content review round 5 (with the open low items of round 4) and backend report 04.

## App

- **Written answer box is empty after "Save answer".** To revise an answer after a review, the learner has to copy the text out of the submission card. Prefill the box with the latest saved answer.
- **"13 cards joined your review queue" next to "10 new".** Nothing says that this is the new-cards-per-day limit. Add "(10 a day, change in Settings)" when the count is above the limit.
- **Older written submissions keep an open paste box** after a newer one is reviewed. Collapse the review panel on older submissions.

## API, worker and bridge

- **No commit pin when the bridge is down at submit.** The submission is stored without a commit, and "latest" is resolved when the checks start. The run records the commit it used. Idea: answer 503 when the commit cannot be pinned and none was typed.
- **Lenient query parameters.** `GET /cards?limit=-1`, `?cursor=garbage` and `GET /review/queue?limit=abc` fall back to defaults instead of 400. `PATCH /settings` ignores unknown keys and `{"dailyGoal":-1}`. No data goes wrong.
- **SHA-256 repositories cannot be checked.** `RunChecksRequest.commitSha` allows at most 40 characters. Allow 7 to 64.
- **The worker sends a duplicate job for each waiting run on every start.** Harmless. `singletonKey: runId` would tidy it.

## Curriculum checks

- **m16 t05, probes:** a `tcpSocket` liveness probe fails, although it does not depend on the database either. Accept it, or name the rule in the brief.
- **m16 t05, selectors:** only `matchLabels` is read. `matchExpressions` is valid Kubernetes and fails.
- **m16 t05, rollout:** `maxSurge: 0` with `maxUnavailable: 0`, and `type: Recreate` with a `rollingUpdate` block, pass although the API server rejects them.
- **m16 t05, YAML reader:** a `- |` block scalar inside a list does not parse, and `True` (capitalised) is read as a string.
- **m16 t05, text:** the solution's `NOTES.md` says "no Pod could ever be evicted", which holds only while the autoscaler sits at 3 replicas. The brief's dry-run tip needs `kubectl create namespace shop` first on a fresh cluster.
- **m19 t06, own-tests:** the broken copy only replaces `tickets.mjs`. A learner who moves the core into another module and tests that module directly fails the criterion.
- **m19 t06, brief:** about 470 words, above the 150 to 350 the authoring guide asks for.
- **m13 t02, solution:** the reference solution releases the refund claim when `deps.refund` throws. A timeout there has an unknown outcome, so the claim should stay. Learners never see the solution.
- **m13 t02, triage-repair:** a valid repair call that does not resend the system instructions could fail the mention count.
- **m13 t03:** two tests start with `grounded-answer:`. The grader handles it, but `docs/authoring.md` says "exactly one" test per id. Merge the tests or relax the sentence.
- **m13 t04:** the note-name rule in the brief does not match the solution's pattern (alphanumeric first character, at most 64 characters).
- **m15 t02:** the checks accept any state bucket and DynamoDB locking, though the brief names `acme-tofu-state` and `use_lockfile`.
- **m15 t01:** the solution's version comment cites S3 locking that it does not use.

## Lessons and cards

- **m15 l03:** `plan` takes the state lock too, and `dynamodb_table` is said to be deprecated rather than "still supported". Not verified: opentofu.org was not reachable from the build environment.
- **m15 l05:** the concurrency group sits on the plan job. Say that GitHub keeps only one pending run per group.
- **m17:** l01 says BullMQ has no ordering, l05 says "per queue, loosely". Make them agree.
- **m13 l06:** the example test is TypeScript, while the tasks require `.test.mjs`.
- **Cards with two questions on the front:** four in m13 and m17, eight in m15 and m16 (`sensitive-limit`, `prevent-destroy`, `scheduler`, `qos-classes`, `pdb` and others).
- **Trivia or open-list cards:** `managed-kafka`, `owasp-llm01`, `sst-engine`, `ai-output-check`. "Name N" cards should say "any N of".
- **Long lessons:** lessons above about 1,800 words of prose are candidates for a split (D-205).

## Never verified in the build environment

- A full start in Docker mode: the images cannot be built there without internet access.
- The one-click Claude review with a real `claude` CLI. The paste flow is tested.
