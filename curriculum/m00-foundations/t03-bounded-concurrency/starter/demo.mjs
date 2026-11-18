// A quick way to watch your implementation work: `node demo.mjs`.
import { setTimeout as sleep } from 'node:timers/promises';
import { mapLimit } from './map-limit.mjs';

let inFlight = 0;

const results = await mapLimit([300, 100, 200, 50, 150], 2, async (ms, index) => {
  inFlight += 1;
  console.log(`start #${index} (${ms} ms), in flight: ${inFlight}`);
  await sleep(ms);
  inFlight -= 1;
  return `#${index} done`;
});

console.log(results);
