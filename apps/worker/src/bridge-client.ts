import { RunChecksResponse, type RunChecksRequest } from '@study/shared';
import type { Config } from './config.js';

/** Thrown when the bridge cannot be reached at all, as opposed to a failed check. */
export class BridgeUnavailableError extends Error {}

export type RunChecksOnBridge = (request: RunChecksRequest) => Promise<RunChecksResponse>;

/** Checks may take minutes; the bridge enforces the per-task limit itself. */
const REQUEST_TIMEOUT_MS = 20 * 60 * 1000;

export function createBridgeClient(config: Config): RunChecksOnBridge {
  return async (request) => {
    if (!config.BRIDGE_SECRET) {
      throw new BridgeUnavailableError('BRIDGE_SECRET is not set');
    }
    let res: Response;
    try {
      res = await fetch(new URL('/checks/run', config.BRIDGE_URL), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.BRIDGE_SECRET}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new BridgeUnavailableError(error instanceof Error ? error.message : String(error));
    }
    if (res.status === 401 || res.status === 403) {
      throw new BridgeUnavailableError('the bridge rejected the shared secret');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { detail?: string } | null;
      throw new Error(body?.detail ?? `The bridge answered ${res.status}.`);
    }
    return RunChecksResponse.parse(await res.json());
  };
}
