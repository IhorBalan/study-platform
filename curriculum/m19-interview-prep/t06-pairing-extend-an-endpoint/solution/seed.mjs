// Sample tickets for running the server by hand. The checks bring their own.
const STATUSES = ['open', 'pending', 'closed'];

export function sampleTickets(count = 60) {
  const start = Date.parse('2026-11-01T08:00:00Z');
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    title: `Ticket ${i + 1}`,
    status: STATUSES[i % STATUSES.length],
    priority: (i % 4) + 1,
    // Two tickets share each timestamp, so ties exist.
    createdAt: new Date(start + Math.floor(i / 2) * 3_600_000).toISOString(),
  }));
}
