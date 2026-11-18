import { BadRequestException, Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { CreateSubmission, SubmissionDto } from '@study/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { CurriculumService } from '../curriculum/curriculum.service.js';
import { InjectDb, type Database } from '../database/database.module.js';
import { QueueService } from '../queue/queue.service.js';
import { SubmissionReviewService } from '../review/review.service.js';

const { submissions, verificationRuns, checkResults } = schema;

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly curriculum: CurriculumService,
    private readonly queue: QueueService,
    private readonly reviews: SubmissionReviewService,
  ) {}

  async create(taskId: string, input: CreateSubmission): Promise<SubmissionDto> {
    const task = this.curriculum.task(taskId);
    if (task.type !== input.type) {
      throw new BadRequestException(
        `This task takes a ${task.type === 'repo' ? 'commit from your lab repository' : `${task.type} answer`}.`,
      );
    }

    const { submissionId, runId } = await this.db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(submissions)
        .values(
          input.type === 'repo'
            ? { taskId, type: 'repo', folder: taskId, commitSha: input.commitSha ?? null }
            : { taskId, type: 'text', body: input.body },
        )
        .returning({ id: submissions.id });
      if (!submission) throw new Error('submission was not created');

      // Only code tasks with a check suite have a stage 1.
      if (input.type !== 'repo' || !task.checksDir) {
        return { submissionId: submission.id, runId: null };
      }
      const [run] = await tx
        .insert(verificationRuns)
        .values({ submissionId: submission.id, stage: 'checks', status: 'queued' })
        .returning({ id: verificationRuns.id });
      if (!run) throw new Error('run was not created');
      return { submissionId: submission.id, runId: run.id };
    });

    if (runId) await this.queue.enqueueChecks({ runId });

    const [created] = await this.load([submissionId]);
    if (!created) throw new Error('submission disappeared');
    return created;
  }

  async list(taskId: string): Promise<SubmissionDto[]> {
    this.curriculum.task(taskId);
    const rows = await this.db
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.taskId, taskId))
      .orderBy(desc(submissions.createdAt))
      .limit(20);
    return this.load(rows.map((r) => r.id));
  }

  /** Loads submissions with their runs and check results, newest first. */
  private async load(ids: string[]): Promise<SubmissionDto[]> {
    if (ids.length === 0) return [];
    const subs = await this.db
      .select()
      .from(submissions)
      .where(inArray(submissions.id, ids))
      .orderBy(desc(submissions.createdAt));
    const runs = await this.db
      .select()
      .from(verificationRuns)
      .where(inArray(verificationRuns.submissionId, ids))
      .orderBy(asc(verificationRuns.createdAt));
    const checks =
      runs.length === 0
        ? []
        : await this.db
            .select()
            .from(checkResults)
            .where(
              inArray(
                checkResults.runId,
                runs.map((r) => r.id),
              ),
            )
            .orderBy(asc(checkResults.position));
    const reviews = await this.reviews.latestFor(ids);

    return subs.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      type: s.type,
      commitSha: s.commitSha,
      body: s.body,
      createdAt: s.createdAt.toISOString(),
      review: reviews.get(s.id) ?? null,
      runs: runs
        .filter((r) => r.submissionId === s.id && r.stage === 'checks')
        .map((r) => ({
          id: r.id,
          stage: r.stage,
          status: r.status,
          error: r.error,
          durationMs: r.durationMs,
          createdAt: r.createdAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          checks: checks
            .filter((c) => c.runId === r.id)
            .map((c) => ({
              criterionId: c.criterionId,
              title: c.title,
              passed: c.passed,
              log: c.log,
            })),
        })),
    }));
  }
}
