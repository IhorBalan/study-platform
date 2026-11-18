#!/usr/bin/env node
import path from 'node:path';
import { loadCurriculum } from './load.js';

const root = path.resolve(process.argv[2] ?? 'curriculum');
const { modules, issues } = await loadCurriculum(root);

for (const m of modules) {
  const cards = m.lessons.reduce((n, l) => n + l.cards.length, 0);
  console.log(`${m.id}: ${m.lessons.length} lessons, ${m.tasks.length} tasks, ${cards} cards`);
}
if (issues.length > 0) {
  console.error(`\n${issues.length} problem(s):`);
  for (const i of issues) console.error(`  ${i.file}: ${i.message}`);
  process.exit(1);
}
console.log('\nCurriculum is valid.');
