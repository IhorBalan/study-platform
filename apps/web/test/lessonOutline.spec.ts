import { describe, expect, it } from 'vitest';
import { lessonOutline, readingMinutes } from '../src/lib/lessonOutline';

describe('lessonOutline', () => {
  it('lists second-level headings in order with ids', () => {
    const md = '# Title\n\nIntro\n\n## The model\n\ntext\n\n### Detail\n\n## Go deeper\n';
    expect(lessonOutline(md)).toEqual([
      { title: 'The model', id: 'the-model' },
      { title: 'Go deeper', id: 'go-deeper' },
    ]);
  });

  it('ignores headings inside code blocks', () => {
    const md = '## Real\n\n```md\n## Not a heading\n```\n\n~~~\n## Nor this\n~~~\n\n## Also real\n';
    expect(lessonOutline(md).map((i) => i.title)).toEqual(['Real', 'Also real']);
  });

  it('strips inline Markdown from titles', () => {
    const md = '## In Node with `amqplib`\n## **Bold** and [a link](https://example.com)\n';
    expect(lessonOutline(md)).toEqual([
      { title: 'In Node with amqplib', id: 'in-node-with-amqplib' },
      { title: 'Bold and a link', id: 'bold-and-a-link' },
    ]);
  });

  it('keeps ids unique when titles repeat', () => {
    expect(lessonOutline('## Example\n## Example\n## Example\n').map((i) => i.id)).toEqual([
      'example',
      'example-2',
      'example-3',
    ]);
  });

  it('gives a usable id to a title with no letters', () => {
    expect(lessonOutline('## ???\n')[0]?.id).toBe('section');
  });
});

describe('readingMinutes', () => {
  it('rounds to whole minutes at 200 words a minute', () => {
    expect(readingMinutes(Array.from({ length: 900 }, () => 'word').join(' '))).toBe(5);
  });

  it('is never less than one minute', () => {
    expect(readingMinutes('short')).toBe(1);
  });
});
