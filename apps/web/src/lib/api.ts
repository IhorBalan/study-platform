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
  SessionDto,
  StatsResponse,
  SettingsDto,
  SubmissionDto,
  SubmissionListResponse,
  SubmitReviewResponse,
  TaskDetail,
  type CardStatus,
  type CreateCard,
  type Activity,
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
  init?: { method: string; body: unknown; keepalive?: boolean },
): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init ? { 'content-type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    // Lets a request sent while the page is closing still reach the server.
    keepalive: init?.keepalive,
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
  startReview: (submissionId: string, mode: 'copy_paste' | 'bridge') =>
    request(`/submissions/${submissionId}/reviews`, ReviewDto, { method: 'POST', body: { mode } }),
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

  stats: () => request('/stats', StatsResponse),
  startSession: (activity: Activity, itemId: string | null) =>
    request('/sessions', SessionDto, { method: 'POST', body: { activity, itemId } }),
  updateSession: (id: string, activeSeconds: number, keepalive = false) =>
    request(`/sessions/${id}`, z.undefined(), {
      method: 'PATCH',
      body: { activeSeconds },
      keepalive,
    }),
  dismissReviewTask: (id: string) =>
    request(`/review-tasks/${id}/dismiss`, z.undefined(), { method: 'POST', body: {} }),

  settings: () => request('/settings', SettingsDto),
  updateSettings: (patch: UpdateSettings) =>
    request('/settings', SettingsDto, { method: 'PATCH', body: patch }),
};
