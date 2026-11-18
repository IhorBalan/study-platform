import { Injectable } from '@nestjs/common';
import { schema } from '@study/db';
import type { SearchResponse, SearchResult } from '@study/shared';
import { InjectDb, type Database } from '../database/database.module.js';
import { CurriculumService } from './curriculum.service.js';

const MAX_RESULTS = 20;
const MIN_TERM_LENGTH = 2;
const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 120;

interface Entry {
  kind: SearchResult['kind'];
  id: string;
  title: string;
  moduleTitle: string;
  /** Plain text of the page, for snippets. */
  text: string;
  titleLower: string;
  textLower: string;
  inNote: boolean;
}

/** A match in the learner's own words ranks above the same words in a lesson. */
const NOTE_BONUS = 50;

/** Turns Markdown into plain text that reads well in a one-line snippet. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n/g, ' ') // code fence markers; the code itself stays searchable
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images keep their label
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '') // headings, quotes, list markers
    .replace(/[*`|]/g, '')
    // Underscores are removed only where they mark emphasis, at the edge of a word.
    // Inside a word they are part of a name such as pg_trgm or statement_timeout.
    .replace(/(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    count++;
  }
  return count;
}

/**
 * Finds lessons and tasks by words in their title or text, and the learner's
 * notes by words in the note.
 *
 * The curriculum is a few hundred pages held in memory, so a plain scan is
 * fast enough and needs no index to keep in step with the files. Notes are
 * read from the database on every search, so a note is found as soon as it is saved.
 */
@Injectable()
export class SearchService {
  private entries: Entry[] | null = null;

  constructor(
    private readonly curriculum: CurriculumService,
    @InjectDb() private readonly db: Database,
  ) {}

  async search(query: string): Promise<SearchResponse> {
    // One-letter words match almost every page, so they are ignored.
    const terms = [
      ...new Set(
        query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term.length >= MIN_TERM_LENGTH),
      ),
    ];
    if (terms.length === 0) return { query, results: [] };

    const scored: { entry: Entry; score: number }[] = [];
    for (const entry of [...this.index(), ...(await this.noteEntries())]) {
      let score = 0;
      for (const term of terms) {
        // A note is found by its own words only: its page already matches on the title.
        const inTitle = !entry.inNote && entry.titleLower.includes(term);
        const inText = countOccurrences(entry.textLower, term);
        // Every word has to appear somewhere on the page.
        if (!inTitle && inText === 0) {
          score = 0;
          break;
        }
        // A title match outweighs any number of mentions in the text.
        score += (inTitle ? 100 : 0) + Math.min(inText, 20);
      }
      if (score > 0) scored.push({ entry, score: score + (entry.inNote ? NOTE_BONUS : 0) });
    }

    // The sort is stable, so equal scores stay in curriculum order.
    scored.sort((a, b) => b.score - a.score);
    return {
      query,
      results: scored.slice(0, MAX_RESULTS).map(({ entry }) => ({
        kind: entry.kind,
        id: entry.id,
        title: entry.title,
        moduleTitle: entry.moduleTitle,
        snippet: this.snippet(entry, terms),
        inNote: entry.inNote,
      })),
    };
  }

  private snippet(entry: Entry, terms: string[]): string {
    const positions = terms.map((t) => entry.textLower.indexOf(t)).filter((at) => at !== -1);
    if (positions.length === 0) return '';
    // Positions come from the lower-cased text. A few non-English letters change length when
    // lower-cased, which would shift the snippet slightly. The curriculum is English.
    const at = Math.min(...positions);
    const start = Math.max(0, at - SNIPPET_BEFORE);
    const end = Math.min(entry.text.length, at + SNIPPET_AFTER);
    const piece = entry.text.slice(start, end).trim();
    return `${start > 0 ? '…' : ''}${piece}${end < entry.text.length ? '…' : ''}`;
  }

  /** Built on first use: the curriculum is loaded by then and does not change while running. */
  private index(): Entry[] {
    if (this.entries) return this.entries;
    const entries: Entry[] = [];
    for (const module of this.curriculum.allModules()) {
      const pages = [
        ...module.lessons.map((l) => ({ kind: 'lesson' as const, page: l })),
        ...module.tasks.map((t) => ({ kind: 'task' as const, page: t })),
      ];
      for (const { kind, page } of pages) {
        const text = plainText(page.markdown);
        entries.push({
          kind,
          id: page.id,
          title: page.title,
          moduleTitle: module.title,
          text,
          titleLower: page.title.toLowerCase(),
          textLower: text.toLowerCase(),
          inNote: false,
        });
      }
    }
    this.entries = entries;
    return entries;
  }

  /** One entry per note whose lesson or task still exists. */
  private async noteEntries(): Promise<Entry[]> {
    const rows = await this.db.select().from(schema.notes);
    if (rows.length === 0) return [];
    const pages = new Map(this.index().map((entry) => [entry.id, entry]));
    const entries: Entry[] = [];
    for (const row of rows) {
      const page = pages.get(row.itemId);
      if (!page) continue;
      const text = plainText(row.body);
      entries.push({ ...page, text, textLower: text.toLowerCase(), inNote: true });
    }
    return entries;
  }
}
