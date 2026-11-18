import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { goTargets, resolveShortcut } from '../lib/shortcuts';
import { Button } from './ui';

/** How long "g" waits for its second key. */
const PREFIX_MS = 1500;

const Key = ({ children }: { children: string }) => (
  <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900">
    {children}
  </kbd>
);

/** Listens for the global shortcuts and holds the "?" help dialog. */
export function Shortcuts() {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const prefixUntil = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      const afterG = Date.now() < prefixUntil.current;
      prefixUntil.current = 0;
      // While the help is open only Escape (handled by the dialog) and "?" do anything.
      const action = resolveShortcut(
        {
          key: event.key,
          code: event.code,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          inField,
        },
        afterG,
      );
      if (!action) return;
      if (dialog.current?.open) {
        if (action.kind === 'help') dialog.current.close();
        return;
      }
      if (action.kind === 'prefix') {
        prefixUntil.current = Date.now() + PREFIX_MS;
        return;
      }
      event.preventDefault();
      if (action.kind === 'help') {
        dialog.current?.showModal();
      } else if (action.kind === 'search') {
        const field = document.querySelector<HTMLInputElement>('input[type="search"]');
        if (field) field.focus();
        else void navigate({ to: '/search', search: { q: '' } });
      } else {
        void navigate({ to: action.to });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcuts-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
    >
      <h2 id="shortcuts-title" className="text-lg font-semibold">
        Keyboard shortcuts
      </h2>
      <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        {Object.entries(goTargets).map(([code, target]) => (
          <div key={code} className="contents">
            <dt className="flex gap-1">
              <Key>g</Key>
              <Key>{code.slice(3).toLowerCase()}</Key>
            </dt>
            <dd>Go to {target.label}</dd>
          </div>
        ))}
        <div className="contents">
          <dt>
            <Key>/</Key>
          </dt>
          <dd>Search</dd>
        </div>
        <div className="contents">
          <dt className="flex gap-1">
            <Key>Space</Key>
            <Key>1</Key>
            <Key>2</Key>
            <Key>3</Key>
            <Key>4</Key>
          </dt>
          <dd>In a review: show the answer, then grade it</dd>
        </div>
        <div className="contents">
          <dt>
            <Key>z</Key>
          </dt>
          <dd>In a review: undo the last grade</dd>
        </div>
        <div className="contents">
          <dt>
            <Key>?</Key>
          </dt>
          <dd>Show or hide this list</dd>
        </div>
      </dl>
      <form method="dialog" className="mt-5 text-right">
        <Button type="submit">Close</Button>
      </form>
    </dialog>
  );
}
