import {
  HealthResponse,
  LessonDetail,
  LessonProgressResponse,
  PlanResponse,
  ProblemDetails,
  CardDto,
  CardListResponse,
  ReviewQueueResponse,
  BridgeStatusResponse,
  ReviewDto,
  SettingsDto,
  SubmissionDto,
  SubmissionListResponse,
  SubmitReviewResponse,
  TaskDetail,
  type CardStatus,
  type CreateCard,
  type CreateSubmission,
  type Grade,
  type ProgressStatus,
  type UpdateCard,
  type UpdateSettings,
} from '@study/shared';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
  }

  /** Field-level messages from a validation failure, if the server sent any. */
  get errors(): string[] {
    return (this.problem?.errors ?? []).map((e) =>
      e.path ? `${e.path}: ${e.message}` : e.message,
    );
  }
}

/** Fetches JSON and validates it, so a drifting API fails here and not deep in a component. */
async function request<T extends z.ZodType>(
  path: string,
  schema: T,
  init?: { method: string; body: unknown },
): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init ? { 'content-type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return schema.parse(undefined);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const problem = ProblemDetails.safeParse(body);
    throw new ApiError(res.status, problem.success ? problem.data : null);
  }
  return schema.parse(body);
}

export const api = {
  health: () => request('/health', HealthResponse),
  plan: () => request('/plan', PlanResponse),
  /** Ids are "<module>/<slug>", which is also the URL path. */
  lesson: (id: string) => request(`/lessons/${id}`, LessonDetail),
  setLessonProgress: (id: string, status: ProgressStatus) =>
    request(`/lessons/${id}/progress`, LessonProgressResponse, { method: 'PUT', body: { status } }),
  task: (id: string) => request(`/tasks/${id}`, TaskDetail),
  submissions: (taskId: string) => request(`/tasks/${taskId}/submissions`, SubmissionListResponse),
  submit: (taskId: string, body: CreateSubmission) =>
    request(`/tasks/${taskId}/submissions`, SubmissionDto, { method: 'POST', body }),
  bridge: () => request('/bridge', BridgeStatusResponse),
  startReview: (submissionId: string) =>
    request(`/submissions/${submissionId}/reviews`, ReviewDto, { method: 'POST', body: {} }),
  submitReviewResult: (runId: string, raw: string) =>
    request(`/reviews/${runId}/result`, ReviewDto, { method: 'POST', body: { raw } }),

  reviewQueue: () => request('/review/queue', ReviewQueueResponse),
  submitReview: (cardId: string, grade: Grade, answerMs: number) =>
    request(`/review/${cardId}`, SubmitReviewResponse, {
      method: 'POST',
      body: { grade, answerMs },
    }),

  cards: (status?: CardStatus) =>
    request(`/cards${status ? `?status=${status}` : ''}`, CardListResponse),
  createCard: (card: CreateCard) => request('/cards', CardDto, { method: 'POST', body: card }),
  updateCard: (id: string, patch: UpdateCard) =>
    request(`/cards/${id}`, CardDto, { method: 'PATCH', body: patch }),
  deleteCard: (id: string) =>
    request(`/cards/${id}`, z.undefined(), { method: 'DELETE', body: {} }),

  settings: () => request('/settings', SettingsDto),
  updateSettings: (patch: UpdateSettings) =>
    request('/settings', SettingsDto, { method: 'PATCH', body: patch }),
};
