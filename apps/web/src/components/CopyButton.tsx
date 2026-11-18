import { useEffect, useState } from 'react';

/** A command with a button that copies it, for things the learner runs in a terminal. */
export function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-md bg-zinc-100 py-1 pr-1 pl-2 dark:bg-zinc-800">
      <code className="min-w-0 font-mono text-xs break-all">{children}</code>
      <button
        type="button"
        onClick={() => {
          // The clipboard is missing on plain http pages other than localhost.
          void navigator.clipboard?.writeText(children).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
        className="shrink-0 rounded border border-zinc-300 px-1.5 py-0.5 text-xs hover:bg-white dark:border-zinc-600 dark:hover:bg-zinc-700"
        aria-label={`Copy the command ${children}`}
      >
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </span>
  );
}
