import { Injectable } from '@nestjs/common';
import type { SearchResponse, SearchResult } from '@study/shared';
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
}

/** Turns Markdown into plain text that reads well in a one-line snippet. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n/g, ' ') // code fence markers; the code itself stays searchable
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // links and images keep their label
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '') // headings, quotes, list markers
    .replace(/[*_`|]/g, '')
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
 * Finds lessons and tasks by words in their title or text.
 *
 * The curriculum is a few hundred pages held in memory, so a plain scan is
 * fast enough and needs no index to keep in step with the files.
 */
@Injectable()
export class SearchService {
  private entries: Entry[] | null = null;

  constructor(private readonly curriculum: CurriculumService) {}

  search(query: string): SearchResponse {
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
    for (const entry of this.index()) {
      let score = 0;
      for (const term of terms) {
        const inTitle = entry.titleLower.includes(term);
        const inText = countOccurrences(entry.textLower, term);
        // Every word has to appear somewhere on the page.
        if (!inTitle && inText === 0) {
          score = 0;
          break;
        }
        // A title match outweighs any number of mentions in the text.
        score += (inTitle ? 100 : 0) + Math.min(inText, 20);
      }
      if (score > 0) scored.push({ entry, score });
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
        });
      }
    }
    this.entries = entries;
    return entries;
  }
}
