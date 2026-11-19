/**
 * How many of the given cards belong to each module. A lesson id is "<module>/<slug>".
 * Cards the learner wrote without a lesson belong to no module and are left out.
 */
export function moduleCardCounts(cards: { lessonId: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const moduleId = card.lessonId?.split('/')[0];
    if (moduleId) counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
  }
  return counts;
}
