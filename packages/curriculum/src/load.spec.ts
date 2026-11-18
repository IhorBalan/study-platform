import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadCurriculum } from './load.js';

let root: string;

async function write(file: string, content: string) {
  const full = path.join(root, file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

const moduleYaml = `title: Demo\nsummary: A demo module\nkind: core\neffort: S\nskills:\n  - { id: http-basics, title: HTTP basics }\n`;
const lessonMd = `---\ntitle: First lesson\nskills: [http-basics]\n---\n\n# Hello\n`;
const cardsYaml = `- { id: c1, type: term, front: Q, back: A, skills: [http-basics] }\n`;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'curriculum-'));
});

describe('loadCurriculum', () => {
  it('loads a valid module with a lesson, a deck and a text task', async () => {
    await write('m00-demo/module.yaml', moduleYaml);
    await write('m00-demo/l01-first/lesson.md', lessonMd);
    await write('m00-demo/l01-first/cards.yaml', cardsYaml);
    await write('m00-demo/t01-explain/task.yaml', `title: Explain\ntype: text\nrubric:\n  - { id: clarity, title: Clarity }\n`);
    await write('m00-demo/t01-explain/task.md', 'Explain HTTP.');

    const { modules, issues } = await loadCurriculum(root);

    expect(issues).toEqual([]);
    expect(modules).toHaveLength(1);
    expect(modules[0]?.lessons[0]).toMatchObject({
      id: 'm00-demo/l01-first',
      title: 'First lesson',
      markdown: '# Hello',
    });
    expect(modules[0]?.lessons[0]?.cards[0]?.key).toBe('m00-demo/l01-first#c1');
    expect(modules[0]?.tasks[0]?.rubric[0]?.max).toBe(4);
  });

  it('reports every problem with the file at fault instead of throwing', async () => {
    await write('m00-demo/module.yaml', moduleYaml.replace('effort: S', 'effort: XL'));
    await write('m01-other/module.yaml', moduleYaml.replace('http-basics', 'other-skill'));
    await write('m01-other/l01-x/lesson.md', lessonMd);
    await write('m01-other/t01-code/task.yaml', `title: Code\ntype: repo\nrubric:\n  - { id: r, title: R }\n`);
    await write('m01-other/t01-code/task.md', 'Do it.');

    const { issues } = await loadCurriculum(root);
    const text = issues.map((i) => `${i.file}: ${i.message}`).join('\n');

    expect(text).toContain('m00-demo/module.yaml: effort');
    expect(text).toContain('every lesson ships with a cards.yaml deck');
    expect(text).toContain('unknown skill "http-basics"');
    expect(text).toContain('a repo task needs at least one criterion');
    expect(text).toContain('a repo task needs a checks/ folder');
    expect(text).toContain('a repo task needs a solution/ folder');
  });
});
