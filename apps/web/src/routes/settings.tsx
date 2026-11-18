import type { SettingsDto } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, PageHeader } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  // Only the fields the user has edited are kept locally; the rest come from the server.
  const [draft, setDraft] = useState<Partial<SettingsDto>>({});

  const save = useMutation({
    mutationFn: (values: SettingsDto) => api.updateSettings(values),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['review-queue'] });
    },
  });

  if (!settings.data) return <p className="text-sm text-zinc-500">Loading…</p>;

  const set = <K extends keyof SettingsDto>(key: K, value: SettingsDto[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const form: SettingsDto = { ...settings.data, ...draft };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(form);
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
            value={form.newCardsPerDay}
            onChange={(e) => set('newCardsPerDay', Number(e.target.value))}
          />
        </Field>
        <Field label="Reviews per day" hint="Upper limit on due cards shown in one day.">
          <Input
            type="number"
            min={1}
            max={2000}
            value={form.reviewsPerDay}
            onChange={(e) => set('reviewsPerDay', Number(e.target.value))}
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
            value={form.desiredRetention}
            onChange={(e) => set('desiredRetention', Number(e.target.value))}
          />
        </Field>
        <Field
          label="Lab repository path"
          hint="Where your task solutions live. Used when code tasks are submitted."
        >
          <Input
            type="text"
            placeholder="/Users/you/code/backend-lab"
            value={form.labRepoPath ?? ''}
            onChange={(e) => set('labRepoPath', e.target.value || null)}
          />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
          {save.isSuccess && (
            <span role="status" className="text-sm text-emerald-600">
              Saved
            </span>
          )}
          {save.isError && (
            <span role="alert" className="text-sm text-red-600">
              {save.error.message}
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
