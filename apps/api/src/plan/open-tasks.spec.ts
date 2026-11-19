import type { ModuleSummary } from '@study/shared';
import { describe, expect, it } from 'vitest';
import { openTasksForNextUp } from './open-tasks.js';

type Status = 'not_started' | 'in_progress' | 'done';

function mod(id: string, lessons: Status[], tasks: Status[]): ModuleSummary {
  return {
    id,
    title: `Module ${id}`,
    summary: '',
    position: 0,
    kind: 'core',
    effort: 'M',
    services: [],
    lessons: lessons.map((status, i) => ({
      id: `${id}/l0${i + 1}`,
      title: `Lesson ${i + 1}`,
      position: i,
      status,
    })),
    tasks: tasks.map((status, i) => ({
      id: `${id}/t0${i + 1}`,
      title: `Task ${i + 1}`,
      position: i,
      type: 'repo',
      status,
    })),
  };
}
const ids = (tasks: { id: string }[]) => tasks.map((t) => t.id);

describe('openTasksForNextUp', () => {
  it('offers the tasks of the module that holds the next lesson', () => {
    const modules = [mod('m00', ['not_started'], ['not_started', 'not_started'])];
    expect(ids(openTasksForNextUp(modules, 'm00/l01'))).toEqual(['m00/t01', 'm00/t02']);
  });

  it('ignores a module where a lesson was only opened', () => {
    const modules = [
      mod('m00', ['done', 'not_started'], ['not_started']),
      mod('m08', ['in_progress'], ['not_started', 'not_started']),
    ];
    expect(ids(openTasksForNextUp(modules, 'm00/l02'))).toEqual(['m00/t01']);
  });

  it('counts a module with a finished lesson or a submitted task', () => {
    const modules = [
      mod('m00', ['done'], ['done']),
      mod('m01', ['done', 'not_started'], ['not_started']),
      mod('m05', ['not_started'], ['in_progress']),
      mod('m09', ['not_started'], ['not_started']),
    ];
    expect(ids(openTasksForNextUp(modules, null))).toEqual(['m05/t01', 'm01/t01']);
  });

  it('lists at most three tasks and puts started ones first', () => {
    const modules = [
      mod('m00', ['done'], ['not_started', 'not_started', 'not_started', 'in_progress']),
    ];
    expect(ids(openTasksForNextUp(modules, null))).toEqual(['m00/t04', 'm00/t01', 'm00/t02']);
  });
});
