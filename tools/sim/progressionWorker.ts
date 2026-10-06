// Worker thread: applies the experiment patch (if any) to the shared data, then simulates the players it is sent.
import { parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_META_DATA } from '../../src/meta/metaData';
import { DEFAULT_DATA } from '../../src/sim/data';
import { applyExperiment, type Experiment } from './experiment';
import { type PlayerConfig, simulatePlayer } from './progressionPlayer';

const exp = (workerData as { exp?: Experiment } | undefined)?.exp;
if (exp) applyExperiment(DEFAULT_DATA, DEFAULT_META_DATA, exp);

parentPort!.on('message', (cfg: PlayerConfig | null) => {
  if (cfg === null) process.exit(0);
  parentPort!.postMessage(simulatePlayer(cfg));
});
