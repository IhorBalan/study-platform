import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { schema } from '@study/db';
import { ReviewResult, type ReviewDto } from '@study/shared';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';
import { buildReviewPrompt, extractJson } from './prompt.js';

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
export class SubmissionReviewService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
  ) {}

  /** Starts a copy-paste review: stores the prompt so the pasted reply can be tied to it. */
  async start(submissionId: string): Promise<ReviewDto> {
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

    const [run] = await this.db
      .insert(verificationRuns)
      .values({ submissionId, stage: 'review', status: 'queued', mode: 'copy_paste', prompt })
      .returning({ id: verificationRuns.id });
    if (!run) throw new Error('review run was not created');
    return this.get(run.id);
  }

  /** Validates a pasted reply. Nothing is stored as a result unless every rule holds. */
  async submitResult(runId: string, raw: string): Promise<ReviewDto> {
    const [row] = await this.db
      .select({ run: verificationRuns, taskId: submissions.taskId })
      .from(verificationRuns)
      .innerJoin(submissions, eq(submissions.id, verificationRuns.submissionId))
      .where(and(eq(verificationRuns.id, runId), eq(verificationRuns.stage, 'review')));
    if (!row) throw new NotFoundException(`Review "${runId}" does not exist`);
    if (row.run.status === 'passed') {
      throw new ConflictException('This review already has a result. Start a new review instead.');
    }
    const task = this.curriculum.task(row.taskId);

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
        .where(eq(verificationRuns.id, runId));
      throw new UnprocessableEntityException({
        message:
          'The reply does not match the expected format. Ask Claude to correct it and paste the new reply.',
        errors,
      });
    }

    const valid = result;
    const knownSkills = new Set(this.curriculum.skillIds());
    await this.db.transaction(async (tx) => {
      await tx
        .update(verificationRuns)
        .set({ status: 'passed', rawOutput: raw, result: valid, finishedAt: new Date() })
        .where(eq(verificationRuns.id, runId));
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
    return this.get(runId);
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
