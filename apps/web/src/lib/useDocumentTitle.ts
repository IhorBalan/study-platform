import { useEffect } from 'react';

const APP_NAME = 'Study platform';

/** The page first, so browser tabs and history entries can be told apart when cut short. */
export function documentTitle(page: string | null | undefined): string {
  const name = page?.trim();
  return name ? `${name} · ${APP_NAME}` : APP_NAME;
}

/** Names the browser tab after the page that is shown. */
export function useDocumentTitle(page: string | null | undefined): void {
  useEffect(() => {
    document.title = documentTitle(page);
  }, [page]);
}
