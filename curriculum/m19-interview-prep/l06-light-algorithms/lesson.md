---
title: Light algorithms that actually come up
skills: [interview-algorithms]
---

Product startups rarely ask dynamic programming puzzles, but a screen with "Two Sum" or "find the order to run these jobs" is not rare, and Big-O questions appear in any round where you write a loop over data. This lesson covers the small set that comes up for backend-leaning fullstack roles: complexity, hash maps, sorting, two pointers and sliding windows, and graph traversal with BFS and DFS. All examples are TypeScript that runs with `node file.ts` on Node 24 and later.

## Complexity in one page

Big-O describes how cost grows with input size `n`, ignoring constants. What you need fluently:

| Complexity | Name | Backend example |
| --- | --- | --- |
| O(1) | constant | `Map.get`, `Set.has`, array index |
| O(log n) | logarithmic | binary search, B-tree index lookup |
| O(n) | linear | one pass over an array, a sequential scan |
| O(n log n) | linearithmic | sorting with `Array.prototype.sort` |
| O(n²) | quadratic | nested loops over the same list, N+1 lookups against an array |

Two things interviewers like to hear. First, space matters too: a `Map` that makes the time O(n) costs O(n) memory. Second, the same idea is behind database work. An index turns an O(n) scan into an O(log n) lookup, and an N+1 query pattern is the database version of a nested loop.

In JavaScript specifically: `array.includes` and `array.indexOf` are O(n), `array.shift()` is O(n) because it moves every element, and `Set.has` is O(1) on average. A loop that calls `includes` inside a loop is O(n²) even though it looks like one loop.

## Hash maps: the default tool

Most "find a pair", "count", "group" and "deduplicate" questions become O(n) with a `Map` or `Set`. The classic is Two Sum: return the indices of two numbers that add up to a target.

```ts
export function twoSum(nums: number[], target: number): [number, number] | null {
  const seen = new Map<number, number>(); // value -> index
  for (let i = 0; i < nums.length; i++) {
    const j = seen.get(target - nums[i]);
    if (j !== undefined) return [j, i];
    seen.set(nums[i], i);
  }
  return null;
}

console.log(twoSum([3, 8, 11, 4], 12)); // [1, 3]
```

The naive version checks every pair: O(n²). The map version is O(n) time and O(n) space. Say both out loud and explain the trade.

Counting and grouping use the same pattern. Top-k most frequent items in a log:

```ts
export function topK(items: string[], k: number): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([item]) => item);
}

console.log(topK(['/a', '/b', '/a', '/c', '/b', '/a'], 2)); // ['/a', '/b']
```

That is O(n + m log m) for `m` distinct items. If asked to do better, mention a heap of size `k` (O(m log k)) or bucket sort by count.

## Sorting

Know three facts about `Array.prototype.sort`. It sorts in place. Without a comparator it compares as strings, so `[10, 9, 1].sort()` gives `[1, 10, 9]`. Since ES2019 it is stable, so sorting by a second key and then by a first key keeps the second order within ties. `toSorted()` returns a copy instead.

Sorting first often turns a hard problem into an easy one. Merging overlapping time ranges (bookings, maintenance windows) is O(n log n) after a sort and one pass:

```ts
type Range = [start: number, end: number];

export function merge(ranges: Range[]): Range[] {
  const sorted = ranges.toSorted((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [start, end] of sorted) {
    const last = out.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

console.log(merge([[9, 12], [1, 3], [2, 6], [8, 9]])); // [[1, 6], [8, 12]]
```

## Two pointers and sliding windows

On a sorted array, two indices moving towards each other replace a nested loop. On a stream of events, a window with a left and right edge answers "in any 60 seconds" questions in one pass. A sliding window is also how a sliding-log rate limiter works.

```ts
// Longest run of requests where no more than `limit` errors occur.
export function longestWindow(isError: boolean[], limit: number): number {
  let left = 0;
  let errors = 0;
  let best = 0;
  for (let right = 0; right < isError.length; right++) {
    if (isError[right]) errors++;
    while (errors > limit) {
      if (isError[left]) errors--;
      left++;
    }
    best = Math.max(best, right - left + 1);
  }
  return best;
}

console.log(longestWindow([false, true, false, true, true, false], 1)); // 3
```

Each index enters and leaves the window once, so it is O(n) despite the inner `while`.

## Graphs: BFS and DFS

Backend data is full of graphs: job dependencies, org charts, follower networks, service call chains. Two traversals cover most questions.

**BFS** visits nodes in order of distance, so it finds the shortest path in an unweighted graph ("degrees of separation"). Use a queue. In JavaScript, use an array with a read index rather than `shift()`, which is O(n).

```ts
export function hops(graph: Map<string, string[]>, from: string, to: string): number {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (node === to) return dist.get(node)!;
    for (const next of graph.get(node) ?? []) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(node)! + 1);
        queue.push(next);
      }
    }
  }
  return -1;
}
```

**DFS** goes deep first. It is the natural fit for "does this have a cycle?" and for topological order: run jobs so that every job runs after its dependencies. This one is worth knowing well, because job schedulers, build tools and migrations all need it.

```ts
// deps: job -> jobs it depends on. Returns a valid run order or throws on a cycle.
export function runOrder(deps: Map<string, string[]>): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const visit = (job: string) => {
    if (state.get(job) === 'done') return;
    if (state.get(job) === 'visiting') throw new Error(`cycle at ${job}`);
    state.set(job, 'visiting');
    for (const dep of deps.get(job) ?? []) visit(dep);
    state.set(job, 'done');
    order.push(job);
  };
  for (const job of deps.keys()) visit(job);
  return order;
}

const deps = new Map([['deploy', ['build', 'test']], ['test', ['build']], ['build', []]]);
console.log(runOrder(deps)); // ['build', 'test', 'deploy']
```

Both are O(V + E): every node and edge is handled once. Recursive DFS can overflow the stack on very deep graphs (tens of thousands of levels); mention an explicit stack as the fix.

## How to run an algorithm round

1. Restate the problem and ask about input size, duplicates, empty input and sortedness.
2. Say the brute force and its complexity first. It gives you a baseline and a fallback.
3. Name the better idea ("a map from value to index") before coding it.
4. Write it, then walk one small example through by hand.
5. State time and space complexity, and one edge case you handled.

## Common mistakes

- Sorting numbers without a comparator.
- `includes` or `indexOf` inside a loop, making it O(n²) without noticing.
- Using `shift()` for a BFS queue on large inputs.
- Forgetting the visited set in a graph traversal, so a cycle loops forever.
- Coding before asking about input size and edge cases.
- Giving time complexity but not space.

## Go deeper

- [Tech Interview Handbook: algorithms study cheatsheets](https://techinterviewhandbook.org/algorithms/introduction): one page per data structure with the must-know problems.
- [Tech Interview Handbook: sorting and searching](https://www.techinterviewhandbook.org/algorithms/sorting-searching/): complexities and the patterns built on them.
- [MDN: Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map): insertion order, key equality and when to prefer it over an object.
- [MDN: Array.prototype.sort](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort): default string ordering, comparators and stability.
