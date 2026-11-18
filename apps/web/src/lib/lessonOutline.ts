/** The sections of a lesson, taken from its second-level headings. */
export interface OutlineItem {
  title: string;
  /** The `id` its heading gets on the page, unique within the lesson. */
  id: string;
}

const FENCE = /^\s*(```|~~~)/;

/** Heading text without inline Markdown: code ticks, emphasis and link targets. */
function plain(heading: string): string {
  return heading
    .replaceAll(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/[`*_]/g, '')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}]+/gu, '-')
      .replaceAll(/^-+|-+$/g, '') || 'section'
  );
}

/** Every `## heading` at the start of a line, outside code blocks, in order. */
export function lessonOutline(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const used = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^## +(.+)$/.exec(line);
    if (!match?.[1]) continue;
    const title = plain(match[1]);
    const base = slug(title);
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    items.push({ title, id: seen === 0 ? base : `${base}-${seen + 1}` });
  }
  return items;
}

/** Reading time at 200 words a minute, at least one minute. Code counts as words too. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
