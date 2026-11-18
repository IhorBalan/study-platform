import type { NextUp } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { Command } from './CopyButton';

const HIDE_KEY = 'study.setupPanelHidden';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function Step({ done, title, children }: { done: boolean; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${
          done
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : 'border-zinc-400 text-transparent dark:border-zinc-500'
        }`}
      >
        ✓
      </span>
      <div className="min-w-0">
        <p className="font-medium">
          {title}
          <span className="sr-only">{done ? ' (done)' : ' (to do)'}</span>
        </p>
        <div className="mt-1 text-zinc-600 dark:text-zinc-300">{children}</div>
      </div>
    </li>
  );
}

/**
 * What a new learner has to set up before the first code task can be checked.
 * Shown on the Plan until the lab repository is known and a first lesson is done.
 */
export function SetupPanel({
  nextLesson,
  anyLessonDone,
}: {
  nextLesson: NextUp['lesson'];
  anyLessonDone: boolean;
}) {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const bridge = useQuery({ queryKey: ['bridge'], queryFn: api.bridge });
  const [hidden, setHidden] = useState(readHidden);

  if (hidden || !settings.data) return null;
  const pathSet = settings.data.labRepoPath !== null;
  if (pathSet && anyLessonDone) return null;

  const imagesBuilt = ['node', 'nest'].every((runner) => bridge.data?.runners.includes(runner));
  const [moduleId = '', lessonSlug = ''] = nextLesson?.id.split('/') ?? [];

  return (
    <section
      aria-labelledby="setup"
      className="mt-6 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm dark:border-sky-900 dark:bg-sky-950"
    >
      <div className="flex items-start justify-between gap-4">
        <h2 id="setup" className="font-semibold">
          Getting started
        </h2>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(HIDE_KEY, '1');
            } catch {
              // Private windows may refuse storage. Hiding then lasts until the next reload.
            }
            setHidden(true);
          }}
          className="text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
        >
          Hide
        </button>
      </div>
      <p className="mt-1 text-zinc-600 dark:text-zinc-300">
        Lessons and flashcards work right away. Code tasks need a little setup on your machine.
      </p>
      <ol className="mt-3 grid gap-3">
        <Step done={imagesBuilt} title="Build the images that run task checks">
          <Command>pnpm lab images</Command>
        </Step>
        <Step done={pathSet} title="Create your lab repository and tell the platform where it is">
          <Command>pnpm lab init ~/code/backend-lab</Command>
          <p className="mt-1">
            Then enter its full path under{' '}
            <Link to="/settings" className="font-medium underline">
              Settings
            </Link>
            .
          </p>
        </Step>
        <Step done={anyLessonDone} title="Read your first lesson">
          {nextLesson ? (
            <Link
              to="/lessons/$moduleId/$lessonSlug"
              params={{ moduleId, lessonSlug }}
              className="font-medium underline"
            >
              {nextLesson.title}
            </Link>
          ) : (
            'Pick any lesson below.'
          )}
        </Step>
      </ol>
      <p className="mt-3 text-zinc-600 dark:text-zinc-300">
        Claude review works by copy and paste with no setup. One-click review can be turned on under
        Settings.
      </p>
    </section>
  );
}
