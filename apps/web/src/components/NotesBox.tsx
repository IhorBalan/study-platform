import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

/** How long after the last keystroke a note is saved. */
const SAVE_AFTER_MS = 800;

/** The learner's own notes on one lesson or task. Saved as they type. */
export function NotesBox({ itemId }: { itemId: string }) {
  const queryClient = useQueryClient();
  const key = ['note', itemId];
  const note = useQuery({ queryKey: key, queryFn: () => api.note(itemId) });
  // Null until the learner types; until then the box shows what the server has.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? note.data?.body ?? '';
  // Closed by default, open when there is a note to show. The learner's own toggle wins.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? Boolean(note.data?.body);

  const save = useMutation({
    mutationFn: (body: string) => api.saveNote(itemId, body),
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });
  const { mutate } = save;

  // Save a moment after typing stops, and at once when the page is left.
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (draft === null || draft === note.data?.body) return;
    pending.current = draft;
    const timer = setTimeout(() => {
      pending.current = null;
      mutate(draft);
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [draft, note.data?.body, mutate]);
  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return;
      void api.saveNote(itemId, pending.current, true).catch(() => undefined);
      pending.current = null;
    };
    // Closing the tab or reloading does not unmount the component, so listen for both.
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [itemId]);

  const unsaved = draft !== null && draft !== note.data?.body;
  const status = save.isError
    ? null
    : save.isPending || unsaved
      ? 'Saving…'
      : note.data?.updatedAt
        ? 'Saved'
        : '';

  return (
    <details
      className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      open={open}
      onToggle={(e) => setToggled(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">My notes</summary>
      <label className="mt-3 grid gap-1 text-sm">
        <span className="sr-only">My notes</span>
        <textarea
          rows={6}
          maxLength={20_000}
          value={text}
          disabled={note.isPending}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your own words: what surprised you, what to reread, how you would explain it. Markdown is fine."
          className="rounded-md border border-zinc-300 bg-transparent p-3 font-mono text-sm dark:border-zinc-700"
        />
      </label>
      <p className="mt-1 min-h-5 text-xs text-zinc-500 dark:text-zinc-400" role="status">
        {status}
      </p>
      {save.isError && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          Could not save the note: {save.error.message}
        </p>
      )}
    </details>
  );
}
