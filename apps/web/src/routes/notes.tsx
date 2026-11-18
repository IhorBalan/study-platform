import type { NoteListItem } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Markdown } from '../components/Markdown';
import { PageHeader } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/notes')({ component: NotesPage });

/** Groups notes that follow each other under the same module. */
function byModule(notes: NoteListItem[]): { moduleTitle: string; notes: NoteListItem[] }[] {
  const groups: { moduleTitle: string; notes: NoteListItem[] }[] = [];
  for (const note of notes) {
    const last = groups.at(-1);
    if (last?.moduleTitle === note.moduleTitle) last.notes.push(note);
    else groups.push({ moduleTitle: note.moduleTitle, notes: [note] });
  }
  return groups;
}

function NotesPage() {
  const notes = useQuery({ queryKey: ['notes'], queryFn: api.notes });

  return (
    <section>
      <PageHeader title="Notes">
        Everything you wrote under "My notes" on lessons and tasks, in the order of the plan.
      </PageHeader>

      {notes.isPending && <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}
      {notes.isError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Could not load your notes: {notes.error.message}
        </p>
      )}
      {notes.data?.notes.length === 0 && (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No notes yet. Open "My notes" at the end of a lesson or a task and write in your own
          words.
        </p>
      )}

      {byModule(notes.data?.notes ?? []).map((group) => (
        <section key={group.moduleTitle} className="mt-8 first:mt-0">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
            {group.moduleTitle}
          </h2>
          <ul className="mt-2 grid gap-3">
            {group.notes.map((note) => {
              const [moduleId = '', slug = ''] = note.itemId.split('/');
              return (
                <li
                  key={note.itemId}
                  className="min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                    {note.kind === 'lesson' ? (
                      <Link
                        to="/lessons/$moduleId/$lessonSlug"
                        params={{ moduleId, lessonSlug: slug }}
                        className="font-medium hover:underline"
                      >
                        {note.title}
                      </Link>
                    ) : (
                      <Link
                        to="/tasks/$moduleId/$taskSlug"
                        params={{ moduleId, taskSlug: slug }}
                        className="font-medium hover:underline"
                      >
                        {note.title}
                      </Link>
                    )}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {note.kind === 'lesson' ? 'Lesson' : 'Task'} · edited{' '}
                      {new Date(note.updatedAt).toLocaleDateString()}
                    </span>
                  </p>
                  <div className="mt-2">
                    <Markdown compact>{note.body}</Markdown>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
