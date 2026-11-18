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

/** "1 h 20 min", "12 min", "under a minute". */
export function durationLabel(seconds: number): string {
  if (seconds < 60) return seconds === 0 ? '0 min' : 'under a minute';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function percentLabel(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** Route parameters for a lesson id such as "m00-foundations/l01-http-in-depth". */
export function lessonParams(lessonId: string): { moduleId: string; lessonSlug: string } {
  const [moduleId = '', lessonSlug = ''] = lessonId.split('/');
  return { moduleId, lessonSlug };
}
