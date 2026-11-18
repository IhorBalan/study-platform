import type { Activity } from '@study/shared';
import { useEffect } from 'react';
import { api } from './api';

const HEARTBEAT_SECONDS = 20;
/** No key, pointer or scroll input for this long counts as away from the desk. */
const IDLE_AFTER_MS = 3 * 60 * 1000;

/**
 * Records time spent on a lesson, a task or reviews. Only seconds in which
 * the tab is visible and the learner was recently active are counted.
 */
export function useStudySession(activity: Activity, itemId: string | null): void {
  useEffect(() => {
    let sessionId: string | null = null;
    let activeSeconds = 0;
    let sentSeconds = 0;
    let lastInput = Date.now();
    let stopped = false;

    const onInput = () => {
      lastInput = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'pointermove', 'scroll'] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true });

    const flush = () => {
      if (!sessionId || activeSeconds === sentSeconds) return;
      sentSeconds = activeSeconds;
      // Time tracking must never get in the way of studying, so failures are ignored.
      api.updateSession(sessionId, activeSeconds).catch(() => undefined);
    };

    const tick = window.setInterval(() => {
      const present =
        document.visibilityState === 'visible' && Date.now() - lastInput < IDLE_AFTER_MS;
      if (!present) return;
      activeSeconds += 1;
      if (!sessionId && activeSeconds === 5) {
        // Start the session only after a few seconds, so passing through a page leaves no record.
        api
          .startSession(activity, itemId)
          .then((session) => {
            if (stopped) return;
            sessionId = session.id;
            flush();
          })
          .catch(() => undefined);
      }
      if (activeSeconds % HEARTBEAT_SECONDS === 0) flush();
    }, 1000);

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      stopped = true;
      window.clearInterval(tick);
      for (const name of events) window.removeEventListener(name, onInput);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [activity, itemId]);
}
