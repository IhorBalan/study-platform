import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function HealthBadge() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
  });

  const ok = data?.status === 'ok' && !isError;
  const label = isError
    ? 'API offline'
    : data
      ? ok
        ? 'Connected'
        : 'Database down'
      : 'Connecting';

  return (
    <span className="inline-flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span
        aria-hidden
        className={`size-2 rounded-full ${ok ? 'bg-emerald-500' : isError || data ? 'bg-red-500' : 'bg-zinc-400'}`}
      />
      {label}
    </span>
  );
}
