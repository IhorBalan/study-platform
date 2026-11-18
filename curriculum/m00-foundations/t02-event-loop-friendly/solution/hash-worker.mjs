import { parentPort, workerData } from 'node:worker_threads';
import { iteratedHash } from './hash.mjs';

// One job per worker: compute, report, exit.
parentPort.postMessage(iteratedHash(workerData.input, workerData.rounds));
