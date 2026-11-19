import type { StatsResponse } from '@study/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/ui';
import { api } from '../lib/api';
import { durationLabel, percentLabel } from '../lib/format';

export const Route = createFileRoute('/stats')({ component: StatsPage });

function StatsPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  if (stats.isPending) return <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>;
  if (stats.isError) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        Could not load statistics: {stats.error.message}
      </p>
    );
  }
  const { learning, memory } = stats.data;
  const moduleSeconds = (moduleId: string) =>
    learning.secondsByModule.find((s) => s.moduleId === moduleId)?.seconds ?? 0;
  const started = learning.modules.filter(
    (m) => m.lessonsDone > 0 || m.tasksDone > 0 || moduleSeconds(m.moduleId) > 0,
  );
  const notStarted = learning.modules.length - started.length;

  return (
    <section>
      <PageHeader title="Stats">
        Time is counted only while a study page is open and in use.
      </PageHeader>

      <h2 className="mt-2 text-lg font-semibold">Learning</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Time studied" value={durationLabel(learning.totalSeconds)} />
        <Tile label="Study streak" value={`${learning.studyStreakDays} d`} />
        <Tile label="Lessons done" value={`${learning.lessonsDone} / ${learning.lessonsTotal}`} />
        <Tile label="Tasks done" value={`${learning.tasksDone} / ${learning.tasksTotal}`} />
        <Tile
          label="Passed on first try"
          value={
            learning.firstAttemptPassRate === null
              ? 'No data'
              : percentLabel(learning.firstAttemptPassRate)
          }
        />
        <Tile
          label="Attempts per task"
          value={
            learning.averageAttemptsPerTask === null
              ? 'No data'
              : learning.averageAttemptsPerTask.toFixed(1)
          }
        />
        {learning.secondsByActivity.map((a) => (
          <Tile
            key={a.activity}
            label={{ lesson: 'Reading', task: 'Tasks', review: 'Reviewing cards' }[a.activity]}
            value={durationLabel(a.seconds)}
          />
        ))}
      </dl>

      <DailyChart days={learning.secondsByDay} />

      {started.length > 0 && (
        <Table
          caption="Progress by module"
          head={['Module', 'Lessons', 'Tasks', 'Time']}
          rows={started.map((m) => [
            m.title,
            `${m.lessonsDone} / ${m.lessonsTotal}`,
            `${m.tasksDone} / ${m.tasksTotal}`,
            durationLabel(moduleSeconds(m.moduleId)),
          ])}
        />
      )}
      {/* Modules with nothing done and no time spent would be rows of zeros. */}
      {notStarted > 0 && (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          {started.length === 0
            ? `None of the ${notStarted} modules is started yet.`
            : `${notStarted} more ${notStarted === 1 ? 'module is' : 'modules are'} not started.`}
        </p>
      )}

      {learning.rubricBySkill.length > 0 && (
        <Table
          caption="Review scores by skill, lowest first"
          head={['Skill', 'Average score', 'Scores']}
          rows={learning.rubricBySkill.map((s) => [
            s.title,
            percentLabel(s.average),
            String(s.reviews),
          ])}
        />
      )}

      <h2 className="mt-10 text-lg font-semibold">Memory</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Due today" value={String(memory.dueToday)} />
        <Tile label="Review streak" value={`${memory.reviewStreakDays} d`} />
        <Tile
          label="Retention, 30 days"
          value={memory.retention === null ? 'No data yet' : percentLabel(memory.retention)}
          // Only reviews of cards past their learning steps count. Without saying so,
          // "0 reviews" after a first session reads like a bug.
          hint={
            memory.retentionReviews === 0
              ? `Target ${percentLabel(memory.desiredRetention)} · counts once cards you have learned come back for review`
              : `Target ${percentLabel(memory.desiredRetention)} · ${memory.retentionReviews} ${memory.retentionReviews === 1 ? 'review' : 'reviews'} of learned cards`
          }
        />
        <Tile label="New cards" value={String(memory.cardsByState.new)} />
        <Tile label="Learning" value={String(memory.cardsByState.learning)} />
        <Tile
          label="Young"
          value={String(memory.cardsByState.young)}
          hint="Interval under 21 days"
        />
        <Tile
          label="Mature"
          value={String(memory.cardsByState.mature)}
          hint="Interval 21 days or more"
        />
        <Tile label="Suspended" value={String(memory.cardsByState.suspended)} />
      </dl>

      <ForecastChart days={memory.dueByDay} />

      {memory.weakestSkills.length > 0 ? (
        <Table
          caption="Weakest skills by recall, last 30 days"
          head={['Skill', 'Retention', 'Reviews', '']}
          rows={memory.weakestSkills.map((s) => [
            s.title,
            percentLabel(s.retention),
            String(s.reviews),
            s.weak ? 'Needs a refresh' : '',
          ])}
        />
      ) : (
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
          Skills appear here once their cards have been reviewed a few times.
        </p>
      )}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</dd>}
    </div>
  );
}

/** Minutes studied per day. Bars carry their value as text for screen readers and on hover. */
function DailyChart({ days }: { days: StatsResponse['learning']['secondsByDay'] }) {
  const max = Math.max(...days.map((d) => d.seconds), 60);
  return (
    <figure className="mt-6">
      <figcaption className="text-sm font-medium">Time per day, last 30 days</figcaption>
      <ol className="mt-2 flex h-28 items-end gap-[3px]" aria-label="Time per day">
        {days.map((d) => (
          <li
            key={d.day}
            className="group relative flex h-full flex-1 items-end"
            title={`${d.day}: ${durationLabel(d.seconds)}`}
          >
            <span className="sr-only">
              {d.day}: {durationLabel(d.seconds)}
            </span>
            <span
              aria-hidden="true"
              className={`w-full rounded-t ${d.seconds > 0 ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
              style={{ height: d.seconds > 0 ? `${Math.max(6, (d.seconds / max) * 100)}%` : '2px' }}
            />
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>{days[0]?.day}</span>
        <span>Today</span>
      </div>
    </figure>
  );
}

/** Cards coming due per day. A forecast of work, not a deadline. */
function ForecastChart({ days }: { days: StatsResponse['memory']['dueByDay'] }) {
  const max = Math.max(...days.map((d) => d.cards), 1);
  const total = days.reduce((sum, d) => sum + d.cards, 0);
  const label = (d: { day: string; cards: number }, i: number) =>
    `${i === 0 ? 'Today' : d.day}: ${d.cards} ${d.cards === 1 ? 'card' : 'cards'}`;
  return (
    <figure className="mt-6">
      <figcaption className="text-sm font-medium">
        Cards coming due, next {days.length} days
        <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">
          {total} in total, not counting new cards
        </span>
      </figcaption>
      <ol className="mt-2 flex h-28 items-end gap-[3px]" aria-label="Cards coming due per day">
        {days.map((d, i) => (
          <li
            key={d.day}
            className="relative flex h-full flex-1 flex-col items-center justify-end"
            title={label(d, i)}
          >
            <span className="sr-only">{label(d, i)}</span>
            {d.cards > 0 && (
              <span aria-hidden="true" className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {d.cards}
              </span>
            )}
            <span
              aria-hidden="true"
              className={`w-full rounded-t ${d.cards > 0 ? 'bg-sky-600 dark:bg-sky-500' : 'bg-zinc-200 dark:bg-zinc-800'}`}
              style={{ height: d.cards > 0 ? `${Math.max(6, (d.cards / max) * 80)}%` : '2px' }}
            />
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>Today</span>
        <span>{days.at(-1)?.day}</span>
      </div>
    </figure>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="mb-2 text-left text-sm font-medium">{caption}</caption>
        <thead>
          <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {head.map((h, i) => (
              <th key={i} scope="col" className="py-1 pr-4 font-normal whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-zinc-100 dark:border-zinc-900">
              {row.map((cell, j) =>
                j === 0 ? (
                  <th key={j} scope="row" className="py-1.5 pr-4 font-normal">
                    {cell}
                  </th>
                ) : (
                  <td
                    key={j}
                    // Numbers stay on one line; on a phone the name column wraps instead.
                    className="py-1.5 pr-4 whitespace-nowrap text-zinc-600 dark:text-zinc-300"
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
