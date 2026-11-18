import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  type OnModuleInit,
} from '@nestjs/common';
import type { LoadedTask } from '@study/curriculum';
import { schema } from '@study/db';
import {
  ReviewResult,
  RunReviewResponse,
  type ReviewDto,
  type RunReviewRequest,
} from '@study/shared';
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { ENV, type Env } from '../config/env.js';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { buildReviewPrompt, extractJson } from './prompt.js';

const ALREADY_HAS_RESULT = 'This review already has a result. Start a new review instead.';

const {
  submissions,
  verificationRuns,
  checkResults,
  rubricScores,
  cards,
  cardSchedules,
  cardSkills,
} = schema;

interface ValidationError {
  path: string;
  message: string;
}

@Injectable()
export class SubmissionReviewService implements OnModuleInit {
  private readonly logger = new Logger(SubmissionReviewService.name);

  constructor(
    @InjectDb() private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly curriculum: CurriculumService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Starts a review. Copy-paste stores the prompt and waits for the pasted
   * reply. One-click hands the same prompt to the bridge and finishes in the
   * background; the page polls for the outcome.
   */
  async start(
    submissionId: string,
    mode: 'copy_paste' | 'bridge' = 'copy_paste',
  ): Promise<ReviewDto> {
    const [submission] = await this.db
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId));
    if (!submission) throw new NotFoundException(`Submission "${submissionId}" does not exist`);
    const task = this.curriculum.task(submission.taskId);

    const [checksRun] = await this.db
      .select()
      .from(verificationRuns)
      .where(
        and(eq(verificationRuns.submissionId, submissionId), eq(verificationRuns.stage, 'checks')),
      )
      .orderBy(desc(verificationRuns.createdAt))
      .limit(1);
    if (checksRun && (checksRun.status === 'queued' || checksRun.status === 'running')) {
      throw new ConflictException('The automated checks are still running. Try again in a moment.');
    }
    const results = checksRun
      ? await this.db
          .select()
          .from(checkResults)
          .where(eq(checkResults.runId, checksRun.id))
          .orderBy(asc(checkResults.position))
      : [];

    const prompt = buildReviewPrompt({
      task,
      submission: { type: submission.type, commitSha: submission.commitSha, body: submission.body },
      checks: checksRun ? { status: checksRun.status, note: checksRun.error, results } : null,
    });

    const run = await this.db.transaction(async (tx) => {
      // The lock makes concurrent starts take turns, so only one sees "none running".
      await tx
        .select({ id: submissions.id })
        .from(submissions)
        .where(eq(submissions.id, submissionId))
        .for('update');
      if (mode === 'bridge') {
        const [running] = await tx
          .select({ id: verificationRuns.id })
          .from(verificationRuns)
          .where(
            and(
              eq(verificationRuns.submissionId, submissionId),
              eq(verificationRuns.stage, 'review'),
              eq(verificationRuns.mode, 'bridge'),
              eq(verificationRuns.status, 'running'),
            ),
          )
          .limit(1);
        if (running) {
          throw new ConflictException('A review of this submission is already running.');
        }
      }
      const [created] = await tx
        .insert(verificationRuns)
        .values({
          submissionId,
          stage: 'review',
          status: mode === 'bridge' ? 'running' : 'queued',
          mode,
          prompt,
        })
        .returning({ id: verificationRuns.id });
      if (!created) throw new Error('review run was not created');
      return created;
    });

    if (mode === 'bridge') {
      const { labRepoPath } = await this.settings.get();
      const request: RunReviewRequest = {
        taskId: task.id,
        prompt,
        ...(submission.type === 'repo' && labRepoPath ? { repoPath: labRepoPath } : {}),
        ...(submission.commitSha ? { commitSha: submission.commitSha } : {}),
      };
      // Not awaited: a review takes a minute or more.
      void this.runOnBridge(run.id, task, request);
    }
    return this.get(run.id);
  }

  /** Asks the bridge for a review, retries once on an unusable reply, and records the outcome. */
  private async runOnBridge(
    runId: string,
    task: LoadedTask,
    request: RunReviewRequest,
  ): Promise<void> {
    const fail = (error: string) =>
      this.db
        .update(verificationRuns)
        .set({ status: 'error', error, finishedAt: new Date() })
        .where(eq(verificationRuns.id, runId));
    try {
      let lastProblem = '';
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const reply = await this.callBridge(request);
        if (reply.status === 'error') {
          await fail(reply.message ?? 'The review could not run.');
          return;
        }
        const errors = await this.validateAndStore(runId, task, reply.output, {
          model: reply.model,
          costUsd: reply.costUsd,
          durationMs: reply.durationMs,
        });
        if (errors.length === 0) return;
        lastProblem = errors.map((e) => e.message).join(' ');
      }
      await fail(
        `Claude's reply did not match the expected format twice (${lastProblem.slice(0, 300)}). Try again, or use copy and paste.`,
      );
    } catch (error) {
      this.logger.warn(
        `One-click review failed: ${error instanceof Error ? error.message : error}`,
      );
      await fail(
        'The host bridge could not be reached. Start it with "pnpm dev", or use copy and paste.',
      ).catch(() => undefined);
    }
  }

  private async callBridge(request: RunReviewRequest): Promise<RunReviewResponse> {
    if (!this.env.BRIDGE_SECRET) throw new Error('BRIDGE_SECRET is not set');
    const res = await fetch(new URL('/review/run', this.env.BRIDGE_URL), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.env.BRIDGE_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(8 * 60 * 1000),
    });
    if (!res.ok) throw new Error(`bridge answered ${res.status}`);
    return RunReviewResponse.parse(await res.json());
  }

  /** Runs left unfinished by a restart can never complete; say so instead of spinning forever. */
  async onModuleInit(): Promise<void> {
    await this.db
      .update(verificationRuns)
      .set({
        status: 'error',
        error: 'The platform restarted while this review was running. Start it again.',
        finishedAt: new Date(),
      })
      .where(
        and(
          eq(verificationRuns.stage, 'review'),
          eq(verificationRuns.mode, 'bridge'),
          eq(verificationRuns.status, 'running'),
        ),
      );
  }

  /** Validates a pasted reply. Nothing is stored as a result unless every rule holds. */
  async submitResult(runId: string, raw: string): Promise<ReviewDto> {
    const [row] = await this.db
      .select({ run: verificationRuns, taskId: submissions.taskId })
      .from(verificationRuns)
      .innerJoin(submissions, eq(submissions.id, verificationRuns.submissionId))
      .where(and(eq(verificationRuns.id, runId), eq(verificationRuns.stage, 'review')));
    if (!row) throw new NotFoundException(`Review "${runId}" does not exist`);
    if (row.run.mode !== 'copy_paste') {
      throw new ConflictException('This review runs through the bridge and takes no pasted reply.');
    }
    if (row.run.status === 'passed') {
      throw new ConflictException(ALREADY_HAS_RESULT);
    }
    const task = this.curriculum.task(row.taskId);

    const errors = await this.validateAndStore(runId, task, raw);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'The reply does not match the expected format. Ask Claude to correct it and paste the new reply.',
        errors,
      });
    }
    return this.get(runId);
  }

  /**
   * Checks a reply against the schema and this task's rubric. A valid reply is
   * stored with its scores and suggested cards; an invalid one only keeps the raw text.
   */
  private async validateAndStore(
    runId: string,
    task: LoadedTask,
    raw: string,
    meta: { model?: string | null; costUsd?: number | null; durationMs?: number | null } = {},
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];
    const json = extractJson(raw);
    let result: ReviewResult | null = null;
    if (json === undefined) {
      errors.push({ path: '', message: 'No JSON object was found in the reply.' });
    } else {
      const parsed = ReviewResult.safeParse(json);
      if (!parsed.success) {
        errors.push(
          ...parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      } else {
        result = parsed.data;
        // The schema cannot know this task's rubric, so check ids and ranges here.
        for (const item of task.rubric) {
          const given = result.scores.filter((s) => s.rubricId === item.id);
          if (given.length !== 1) {
            errors.push({
              path: 'scores',
              message: `Expected exactly one score for rubric item "${item.id}", found ${given.length}.`,
            });
          } else if (given[0]!.score > item.max) {
            errors.push({
              path: 'scores',
              message: `The score for "${item.id}" is ${given[0]!.score}, but its maximum is ${item.max}.`,
            });
          }
        }
        for (const score of result.scores) {
          if (!task.rubric.some((r) => r.id === score.rubricId)) {
            errors.push({
              path: 'scores',
              message: `"${score.rubricId}" is not a rubric item of this task.`,
            });
          }
        }
      }
    }

    if (errors.length > 0 || !result) {
      await this.db
        .update(verificationRuns)
        .set({ rawOutput: raw })
        // A valid reply may have been stored since this one was read. Its text stays.
        .where(and(eq(verificationRuns.id, runId), ne(verificationRuns.status, 'passed')));
      return errors.length > 0 ? errors : [{ path: '', message: 'The reply is empty.' }];
    }

    const valid = result;
    const knownSkills = new Set(this.curriculum.skillIds());
    await this.db.transaction(async (tx) => {
      // Claim the run in the same statement that stores the result. Of two replies
      // arriving together (a double click, two tabs), only one finds it unclaimed.
      const claimed = await tx
        .update(verificationRuns)
        .set({
          status: 'passed',
          rawOutput: raw,
          result: valid,
          error: null,
          model: meta.model ?? null,
          costUsd: meta.costUsd ?? null,
          durationMs: meta.durationMs ?? null,
          finishedAt: new Date(),
        })
        .where(and(eq(verificationRuns.id, runId), ne(verificationRuns.status, 'passed')))
        .returning({ id: verificationRuns.id });
      if (claimed.length === 0) throw new ConflictException(ALREADY_HAS_RESULT);
      await tx.insert(rubricScores).values(
        task.rubric.map((item) => {
          const score = valid.scores.find((s) => s.rubricId === item.id)!;
          return {
            runId,
            rubricItemId: item.id,
            skillId: item.skill && knownSkills.has(item.skill) ? item.skill : null,
            score: score.score,
            maxScore: item.max,
            comment: score.comment,
          };
        }),
      );
      // Suggested cards wait for the learner's approval before they enter the queue.
      const taskSkills = task.skills.filter((s) => knownSkills.has(s));
      for (const suggestion of valid.suggestedCards) {
        const [card] = await tx
          .insert(cards)
          .values({ ...suggestion, source: 'claude', status: 'pending', suggestedByRunId: runId })
          .returning({ id: cards.id });
        if (!card) continue;
        await tx.insert(cardSchedules).values({ cardId: card.id });
        if (taskSkills.length > 0) {
          await tx
            .insert(cardSkills)
            .values(taskSkills.map((skillId) => ({ cardId: card.id, skillId })));
        }
      }
    });
    return [];
  }

  async get(runId: string): Promise<ReviewDto> {
    const [review] = await this.forRuns([runId]);
    if (!review) throw new NotFoundException(`Review "${runId}" does not exist`);
    return review;
  }

  /** The latest review per submission. */
  async latestFor(submissionIds: string[]): Promise<Map<string, ReviewDto>> {
    const latest = new Map<string, string>();
    if (submissionIds.length === 0) return new Map();
    const runs = await this.db
      .select({ id: verificationRuns.id, submissionId: verificationRuns.submissionId })
      .from(verificationRuns)
      .where(
        and(
          inArray(verificationRuns.submissionId, submissionIds),
          eq(verificationRuns.stage, 'review'),
        ),
      )
      .orderBy(asc(verificationRuns.createdAt));
    for (const run of runs) latest.set(run.submissionId, run.id);
    const reviews = await this.forRuns([...latest.values()]);
    const byRun = new Map(reviews.map((r) => [r.runId, r]));
    return new Map([...latest].map(([submissionId, id]) => [submissionId, byRun.get(id)!]));
  }

  private async forRuns(runIds: string[]): Promise<ReviewDto[]> {
    if (runIds.length === 0) return [];
    const rows = await this.db
      .select({ run: verificationRuns, taskId: submissions.taskId })
      .from(verificationRuns)
      .innerJoin(submissions, eq(submissions.id, verificationRuns.submissionId))
      .where(and(inArray(verificationRuns.id, runIds), eq(verificationRuns.stage, 'review')));
    const scores = await this.db
      .select()
      .from(rubricScores)
      .where(inArray(rubricScores.runId, runIds));
    const suggested = await this.db
      .select({ runId: cards.suggestedByRunId, n: count() })
      .from(cards)
      .where(inArray(cards.suggestedByRunId, runIds))
      .groupBy(cards.suggestedByRunId);

    return rows.map(({ run, taskId }) => {
      const rubric = this.curriculum.task(taskId).rubric;
      const parsed = ReviewResult.safeParse(run.result);
      return {
        runId: run.id,
        status: run.status,
        mode: run.mode ?? 'copy_paste',
        error: run.error,
        prompt: run.prompt ?? '',
        result: parsed.success ? parsed.data : null,
        scores: rubric.flatMap((item) => {
          const score = scores.find((s) => s.runId === run.id && s.rubricItemId === item.id);
          return score
            ? [
                {
                  rubricId: item.id,
                  title: item.title,
                  score: score.score,
                  max: score.maxScore,
                  comment: score.comment,
                },
              ]
            : [];
        }),
        cardsSuggested: suggested.find((s) => s.runId === run.id)?.n ?? 0,
        createdAt: run.createdAt.toISOString(),
      };
    });
  }
}
