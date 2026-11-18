import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { z } from 'zod';
import { CardFile, LessonMeta, ModuleFile, TaskFile } from './schemas.js';

export interface LoadedCard {
  /** "<lesson id>#<card id>", unique across the curriculum. */
  key: string;
  type: CardFile[number]['type'];
  front: string;
  back: string;
  skills: string[];
}

export interface LoadedLesson {
  /** "<module>/<lesson>" */
  id: string;
  moduleId: string;
  slug: string;
  position: number;
  title: string;
  skills: string[];
  markdown: string;
  cards: LoadedCard[];
}

export interface LoadedTask extends Omit<TaskFile, 'title'> {
  /** "<module>/<task>" */
  id: string;
  moduleId: string;
  slug: string;
  position: number;
  title: string;
  markdown: string;
  /** Absolute paths, or null when the task has no such folder. */
  checksDir: string | null;
  starterDir: string | null;
  /** Reference solution. Never shown to the learner; used to prove the checks work. */
  solutionDir: string | null;
}

export interface LoadedModule extends ModuleFile {
  id: string;
  position: number;
  lessons: LoadedLesson[];
  tasks: LoadedTask[];
}

export interface CurriculumIssue {
  file: string;
  message: string;
}

export interface Curriculum {
  modules: LoadedModule[];
  issues: CurriculumIssue[];
}

const MODULE_DIR = /^m(\d{2})-[a-z0-9-]+$/;
const LESSON_DIR = /^l(\d{2})-[a-z0-9-]+$/;
const TASK_DIR = /^t(\d{2})-[a-z0-9-]+$/;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

async function exists(p: string): Promise<boolean> {
  return stat(p).then(
    () => true,
    () => false,
  );
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/**
 * Reads and validates everything under `root`. It never throws for content
 * problems: each one becomes an entry in `issues`, with the file at fault, so
 * all of them can be fixed in one pass.
 */
export async function loadCurriculum(root: string): Promise<Curriculum> {
  const issues: CurriculumIssue[] = [];
  const modules: LoadedModule[] = [];
  const rel = (p: string) => path.relative(root, p) || '.';

  function validate<T extends z.ZodType>(schema: T, data: unknown, file: string): z.infer<T> | null {
    const result = schema.safeParse(data);
    if (result.success) return result.data;
    for (const issue of result.error.issues) {
      const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
      issues.push({ file: rel(file), message: `${where}${issue.message}` });
    }
    return null;
  }

  async function readYaml(file: string): Promise<unknown> {
    try {
      return parseYaml(await readFile(file, 'utf8'));
    } catch (error) {
      issues.push({ file: rel(file), message: `cannot read YAML: ${(error as Error).message}` });
      return undefined;
    }
  }

  if (!(await exists(root))) {
    return { modules, issues: [{ file: '.', message: `curriculum folder not found: ${root}` }] };
  }

  for (const moduleDir of await subdirs(root)) {
    const moduleMatch = MODULE_DIR.exec(moduleDir);
    if (!moduleMatch) {
      issues.push({ file: moduleDir, message: 'module folders are named mNN-slug, e.g. m03-postgres' });
      continue;
    }
    const modulePath = path.join(root, moduleDir);
    const moduleFile = path.join(modulePath, 'module.yaml');
    if (!(await exists(moduleFile))) {
      issues.push({ file: rel(moduleFile), message: 'missing module.yaml' });
      continue;
    }
    const meta = validate(ModuleFile, await readYaml(moduleFile), moduleFile);
    if (!meta) continue;

    const loaded: LoadedModule = {
      ...meta,
      id: moduleDir,
      position: Number(moduleMatch[1]),
      lessons: [],
      tasks: [],
    };

    for (const child of await subdirs(modulePath)) {
      const childPath = path.join(modulePath, child);
      const lessonMatch = LESSON_DIR.exec(child);
      const taskMatch = TASK_DIR.exec(child);

      if (lessonMatch) {
        const lessonFile = path.join(childPath, 'lesson.md');
        if (!(await exists(lessonFile))) {
          issues.push({ file: rel(lessonFile), message: 'missing lesson.md' });
          continue;
        }
        const raw = await readFile(lessonFile, 'utf8');
        const fm = FRONT_MATTER.exec(raw);
        if (!fm) {
          issues.push({ file: rel(lessonFile), message: 'lesson.md must start with YAML front matter' });
          continue;
        }
        let fmData: unknown;
        try {
          fmData = parseYaml(fm[1] ?? '');
        } catch (error) {
          issues.push({ file: rel(lessonFile), message: `front matter: ${(error as Error).message}` });
          continue;
        }
        const lessonMeta = validate(LessonMeta, fmData, lessonFile);
        if (!lessonMeta) continue;

        const id = `${moduleDir}/${child}`;
        const cardsFile = path.join(childPath, 'cards.yaml');
        let cards: LoadedCard[] = [];
        if (await exists(cardsFile)) {
          const parsed = validate(CardFile, await readYaml(cardsFile), cardsFile);
          if (parsed) {
            const seen = new Set<string>();
            for (const card of parsed) {
              if (seen.has(card.id)) {
                issues.push({ file: rel(cardsFile), message: `duplicate card id "${card.id}"` });
              }
              seen.add(card.id);
            }
            cards = parsed.map((c) => ({
              key: `${id}#${c.id}`,
              type: c.type,
              front: c.front,
              back: c.back,
              skills: c.skills,
            }));
          }
        } else {
          issues.push({ file: rel(cardsFile), message: 'every lesson ships with a cards.yaml deck' });
        }

        loaded.lessons.push({
          id,
          moduleId: moduleDir,
          slug: child,
          position: Number(lessonMatch[1]),
          title: lessonMeta.title,
          skills: lessonMeta.skills,
          markdown: raw.slice(fm[0].length).trim(),
          cards,
        });
      } else if (taskMatch) {
        const taskFile = path.join(childPath, 'task.yaml');
        const taskMd = path.join(childPath, 'task.md');
        if (!(await exists(taskFile)) || !(await exists(taskMd))) {
          issues.push({ file: rel(childPath), message: 'a task needs both task.yaml and task.md' });
          continue;
        }
        const taskMeta = validate(TaskFile, await readYaml(taskFile), taskFile);
        if (!taskMeta) continue;
        if (taskMeta.type === 'repo' && taskMeta.criteria.length === 0) {
          issues.push({ file: rel(taskFile), message: 'a repo task needs at least one criterion' });
        }
        const checksDir = path.join(childPath, 'checks');
        const starterDir = path.join(childPath, 'starter');
        const solutionDir = path.join(childPath, 'solution');
        const hasChecks = await exists(checksDir);
        if (taskMeta.type === 'repo' && !hasChecks) {
          issues.push({ file: rel(childPath), message: 'a repo task needs a checks/ folder' });
        }
        if (taskMeta.type === 'repo' && !(await exists(solutionDir))) {
          issues.push({ file: rel(childPath), message: 'a repo task needs a solution/ folder' });
        }
        loaded.tasks.push({
          ...taskMeta,
          id: `${moduleDir}/${child}`,
          moduleId: moduleDir,
          slug: child,
          position: Number(taskMatch[1]),
          markdown: (await readFile(taskMd, 'utf8')).trim(),
          checksDir: hasChecks ? checksDir : null,
          starterDir: (await exists(starterDir)) ? starterDir : null,
          solutionDir: (await exists(solutionDir)) ? solutionDir : null,
        });
      } else {
        issues.push({
          file: rel(childPath),
          message: 'expected a lesson (lNN-slug) or task (tNN-slug) folder',
        });
      }
    }

    modules.push(loaded);
  }

  // Cross-references: every skill used must be declared by some module.
  const declared = new Set(modules.flatMap((m) => m.skills.map((s) => s.id)));
  const checkSkills = (skills: string[], file: string) => {
    for (const s of skills) {
      if (!declared.has(s)) issues.push({ file, message: `unknown skill "${s}"` });
    }
  };
  const positions = new Set<number>();
  for (const m of modules) {
    if (positions.has(m.position)) issues.push({ file: m.id, message: 'duplicate module number' });
    positions.add(m.position);
    for (const l of m.lessons) {
      checkSkills(l.skills, `${l.id}/lesson.md`);
      for (const c of l.cards) checkSkills(c.skills, `${l.id}/cards.yaml`);
    }
    for (const t of m.tasks) {
      checkSkills(t.skills, `${t.id}/task.yaml`);
      checkSkills(
        t.rubric.flatMap((r) => (r.skill ? [r.skill] : [])),
        `${t.id}/task.yaml`,
      );
    }
  }

  return { modules, issues };
}
