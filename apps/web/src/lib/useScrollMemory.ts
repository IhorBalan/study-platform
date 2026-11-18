import { useEffect } from 'react';

/** How long to wait for the page to grow tall enough before settling for less. */
const GIVE_UP_MS = 3000;

const entryKey = (): string | undefined =>
  (window.history.state as { key?: string } | null)?.key ?? undefined;

/**
 * Remembers how far a page was scrolled, per history entry, and returns there
 * on Back, Forward and reload. A page opened by a link starts at the top.
 *
 * Lessons render their Markdown after the first paint, so the page is short at
 * first and the browser's own restoring lands at the top. This waits until the
 * page is tall enough.
 *
 * `page` is what is shown, so moving between two lessons counts as a new page.
 */
export function useScrollMemory(page: string): void {
  useEffect(() => {
    const entry = entryKey();
    if (!entry) return;
    const storageKey = `study.scroll.${entry}`;
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem(storageKey)) || 0;
    } catch {
      // Storage can be blocked; the page then just starts at the top.
    }

    let restoring = saved > 0;
    let observer: ResizeObserver | undefined;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      restoring = false;
      observer?.disconnect();
      clearTimeout(giveUp);
    };
    if (restoring) {
      const restore = () => {
        if (document.documentElement.scrollHeight < saved + window.innerHeight) return;
        window.scrollTo(0, saved);
        stop();
      };
      observer = new ResizeObserver(restore);
      observer.observe(document.body);
      giveUp = setTimeout(() => {
        window.scrollTo(0, saved);
        stop();
      }, GIVE_UP_MS);
      restore();
    }

    // The learner moving the page themselves ends the wait: their place wins.
    const onIntent = () => stop();
    let writeSoon: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      // While waiting, the page is still at the top and that is not the learner's place.
      // After a navigation the old page can get one last scroll event; it is not its own.
      if (restoring || entryKey() !== entry) return;
      const y = Math.round(window.scrollY);
      clearTimeout(writeSoon);
      writeSoon = setTimeout(() => {
        try {
          sessionStorage.setItem(storageKey, String(y));
        } catch {
          // Nothing to do without storage.
        }
      }, 150);
    };
    window.addEventListener('wheel', onIntent, { passive: true });
    window.addEventListener('touchstart', onIntent, { passive: true });
    window.addEventListener('keydown', onIntent);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      stop();
      window.removeEventListener('wheel', onIntent);
      window.removeEventListener('touchstart', onIntent);
      window.removeEventListener('keydown', onIntent);
      window.removeEventListener('scroll', onScroll);
    };
  }, [page]);
}
