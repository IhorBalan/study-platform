import { Editor, type SettingsDto, type UpdateSettings } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, PageHeader, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { agoLabel } from '../lib/format';
import { saveTheme, storedTheme, themes, type Theme } from '../lib/theme';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const bridge = useQuery({ queryKey: ['bridge'], queryFn: api.bridge });
  // Only the fields the user has edited are kept locally; the rest come from the server.
  const [draft, setDraft] = useState<UpdateSettings>({});
  const [theme, setTheme] = useState<Theme>(storedTheme);

  const save = useMutation({
    mutationFn: (values: UpdateSettings) => api.updateSettings(values),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  if (!settings.data) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;

  const set = <K extends keyof UpdateSettings>(key: K, value: UpdateSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const form: SettingsDto = { ...settings.data, ...draft };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    // An emptied number field holds NaN; the browser's `required` check stops it first.
    if (Object.values(draft).some((value) => typeof value === 'number' && Number.isNaN(value)))
      return;
    save.mutate(draft);
  };

  return (
    <section>
      <PageHeader title="Settings" />
      <form onSubmit={onSubmit} className="grid max-w-md gap-4">
        <Field
          label="New cards per day"
          hint="How many unseen cards the review queue introduces each day."
        >
          <Input
            type="number"
            min={0}
            max={200}
            required
            value={Number.isNaN(form.newCardsPerDay) ? '' : form.newCardsPerDay}
            onChange={(e) => set('newCardsPerDay', e.target.valueAsNumber)}
          />
        </Field>
        <Field label="Reviews per day" hint="Upper limit on due cards shown in one day.">
          <Input
            type="number"
            min={1}
            max={2000}
            required
            value={Number.isNaN(form.reviewsPerDay) ? '' : form.reviewsPerDay}
            onChange={(e) => set('reviewsPerDay', e.target.valueAsNumber)}
          />
        </Field>
        <Field
          label="Desired retention"
          hint="The share of cards you want to remember when they come up. Higher means more reviews. 0.90 is the usual choice."
        >
          <Input
            type="number"
            step={0.01}
            min={0.7}
            max={0.97}
            required
            value={Number.isNaN(form.desiredRetention) ? '' : form.desiredRetention}
            onChange={(e) => set('desiredRetention', e.target.valueAsNumber)}
          />
        </Field>
        <Field
          label="Claude review"
          hint="One click runs the Claude CLI on this computer with read-only tools, using your own Claude plan. It needs Claude Code installed and signed in. Copy and paste always works."
        >
          <Select
            value={form.reviewMode}
            onChange={(e) =>
              set('reviewMode', e.target.value === 'bridge' ? 'bridge' : 'copy_paste')
            }
          >
            <option value="copy_paste">Copy and paste</option>
            <option value="bridge">One click</option>
          </Select>
        </Field>
        <Field
          label="Lab repository path"
          hint="Where your task solutions live. Used when code tasks are submitted."
        >
          <Input
            type="text"
            placeholder="/Users/you/code/backend-lab"
            value={form.labRepoPath ?? ''}
            onChange={(e) => set('labRepoPath', e.target.value.trim() || null)}
          />
        </Field>
        <Field
          label="Editor"
          hint="Code task pages show a link that opens the task folder in this editor."
        >
          <Select
            value={form.editor}
            onChange={(e) => set('editor', Editor.catch('none').parse(e.target.value))}
          >
            <option value="vscode">VS Code</option>
            <option value="cursor">Cursor</option>
            <option value="none">No link</option>
          </Select>
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
          {save.isSuccess && (
            <span role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
              Saved
            </span>
          )}
          {save.isError && (
            <span role="alert" className="text-sm text-red-600 dark:text-red-400">
              {save.error instanceof ApiError && save.error.errors.length > 0
                ? save.error.errors.join('. ')
                : save.error.message}
            </span>
          )}
        </div>
      </form>

      <div className="mt-10 grid max-w-md gap-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <Field label="Theme" hint="Applies at once and is remembered in this browser only.">
          <Select
            value={theme}
            onChange={(e) => {
              const next = e.target.value as Theme;
              setTheme(next);
              saveTheme(next);
            }}
          >
            {themes.map((t) => (
              <option key={t} value={t}>
                {t === 'system' ? 'Same as the system' : t === 'light' ? 'Light' : 'Dark'}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-10 max-w-md border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">Backups</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
          {!bridge.data
            ? 'Checking for backups…'
            : !bridge.data.reachable
              ? 'The backup folder cannot be read while the host bridge is not running.'
              : bridge.data.lastBackupAt
                ? `The last backup was made ${agoLabel(bridge.data.lastBackupAt)}.`
                : 'There is no backup yet.'}
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          <code className="font-mono">pnpm dev</code> makes one when it starts if the newest is more
          than a day old. Run <code className="font-mono">pnpm backup</code> to make one now.
        </p>
      </div>
    </section>
  );
}
