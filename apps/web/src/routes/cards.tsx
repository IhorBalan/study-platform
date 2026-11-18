import { CardType, type CardDto } from '@study/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button, Field, PageHeader, Select, Textarea } from '../components/ui';
import { api } from '../lib/api';

export const Route = createFileRoute('/cards')({ component: CardsPage });

function CardsPage() {
  const queryClient = useQueryClient();
  const cards = useQuery({ queryKey: ['cards'], queryFn: () => api.cards() });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['cards'] });
    void queryClient.invalidateQueries({ queryKey: ['review-queue'] });
  };

  const [type, setType] = useState<CardType>('concept');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [blank, setBlank] = useState(false);

  const create = useMutation({
    mutationFn: () => api.createCard({ type, front, back, skills: [] }),
    onSuccess: () => {
      setFront('');
      setBack('');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; status: 'active' | 'suspended' }) =>
      api.updateCard(v.id, { status: v.status }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteCard(id),
    onSuccess: refresh,
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (front.trim() && back.trim()) {
      setBlank(false);
      create.mutate();
    } else {
      setBlank(true);
    }
  };

  const all = cards.data?.cards ?? [];
  const pending = all.filter((c) => c.status === 'pending');
  const rest = all.filter((c) => c.status !== 'pending');

  return (
    <section>
      <PageHeader title="Cards">
        Add your own cards, approve suggested ones, and suspend cards you no longer need.
      </PageHeader>

      <form
        onSubmit={onSubmit}
        className="grid gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-sm font-semibold">Add a card</h2>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as CardType)}>
            {CardType.options.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Front"
          hint={type === 'cloze' ? 'Wrap the hidden part in {{double braces}}.' : undefined}
        >
          <Textarea value={front} onChange={(e) => setFront(e.target.value)} required />
        </Field>
        <Field label="Back">
          <Textarea value={back} onChange={(e) => setBack(e.target.value)} required />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={create.isPending}>
            Add card
          </Button>
          {blank && (
            <span role="alert" className="text-sm text-red-600">
              The front and the back both need some text.
            </span>
          )}
          {!blank && create.isError && (
            <span role="alert" className="text-sm text-red-600">
              {create.error.message}
            </span>
          )}
        </div>
      </form>

      {pending.length > 0 && (
        <CardList title={`Waiting for approval (${pending.length})`} cards={pending}>
          {(card) => (
            <>
              <Button onClick={() => update.mutate({ id: card.id, status: 'active' })}>
                Approve
              </Button>
              <Button variant="danger" onClick={() => remove.mutate(card.id)}>
                Discard
              </Button>
            </>
          )}
        </CardList>
      )}

      <CardList title={`Your deck (${rest.length})`} cards={rest}>
        {(card) => (
          <>
            <Button
              variant="secondary"
              onClick={() =>
                update.mutate({
                  id: card.id,
                  status: card.status === 'suspended' ? 'active' : 'suspended',
                })
              }
            >
              {card.status === 'suspended' ? 'Resume' : 'Suspend'}
            </Button>
            <Button variant="danger" onClick={() => remove.mutate(card.id)}>
              Delete
            </Button>
          </>
        )}
      </CardList>
    </section>
  );
}

function CardList({
  title,
  cards,
  children,
}: {
  title: string;
  cards: CardDto[];
  children: (card: CardDto) => React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">{title}</h2>
      {cards.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No cards yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {cards.map((card) => (
            <li key={card.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium break-words">{card.front}</p>
                <p className="mt-1 break-words text-zinc-600 dark:text-zinc-300">{card.back}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {card.type} · {card.source} ·{' '}
                  {card.status === 'suspended' ? 'suspended' : card.state}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">{children(card)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
