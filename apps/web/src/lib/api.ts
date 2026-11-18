import { HealthResponse, PlanResponse, ProblemDetails } from '@study/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: ProblemDetails | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed with status ${status}`);
  }
}

/** Fetches JSON and validates it, so a drifting API fails here and not deep in a component. */
async function get<T extends z.ZodType>(path: string, schema: T): Promise<z.infer<T>> {
  const res = await fetch(`/api${path}`, { headers: { accept: 'application/json' } });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const problem = ProblemDetails.safeParse(body);
    throw new ApiError(res.status, problem.success ? problem.data : null);
  }
  return schema.parse(body);
}

export const api = {
  health: () => get('/health', HealthResponse),
  plan: () => get('/plan', PlanResponse),
};
