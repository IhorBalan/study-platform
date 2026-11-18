/** "in 4 d", "in 10 min": how far away a due date is, for the grade buttons. */
export function untilLabel(iso: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} d`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} mo`;
  return `${(days / 365).toFixed(1)} y`;
}
