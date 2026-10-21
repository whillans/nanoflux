/**
 * Where the process spends CPU: totals per fetch-pipeline stage, and a
 * short history that separates pipeline CPU from everything else.
 */

export type StageName = "rss" | "resolve" | "scrape" | "filter" | "translate" | "dedup";

export const STAGES: readonly StageName[] = [
  "rss",
  "resolve",
  "scrape",
  "filter",
  "translate",
  "dedup",
];

const SAMPLE_INTERVAL_MS = 10_000;
/** One hour of samples. */
const HISTORY_SIZE = 360;

type StageTotals = { runs: number; cpuUs: number; wallMs: number };

export type CpuSample = {
  /** Epoch ms at the end of the interval. */
  at: number;
  /** Process CPU over the interval; 100 = one core. */
  process: number;
  /** Share of `process` spent inside pipeline stages. */
  pipeline: number;
};

const stageTotals = new Map<StageName, StageTotals>(
  STAGES.map((stage) => [stage, { runs: 0, cpuUs: 0, wallMs: 0 }]),
);

const cpuNow = () => {
  const { user, system } = process.cpuUsage();
  return user + system;
};

/*
 * Pipeline CPU is counted while any stage runs, so overlapping fetches are not
 * double counted, and it is credited at each sample so a stage that spans
 * several samples is spread over them instead of landing in the last one.
 */
let activeStages = 0;
let pipelineCheckpoint = 0;
let pipelineCpuUs = 0;

function creditPipeline(now: number) {
  if (activeStages > 0) {
    pipelineCpuUs += now - pipelineCheckpoint;
    pipelineCheckpoint = now;
  }
}

/** Run one pipeline stage and add its CPU and wall time to the totals. */
export async function measureStage<T>(stage: StageName, fn: () => Promise<T>): Promise<T> {
  const startCpu = cpuNow();
  const startWall = performance.now();
  if (activeStages++ === 0) pipelineCheckpoint = startCpu;
  try {
    return await fn();
  } finally {
    const endCpu = cpuNow();
    creditPipeline(endCpu);
    activeStages--;
    const totals = stageTotals.get(stage)!;
    totals.runs++;
    totals.cpuUs += endCpu - startCpu;
    totals.wallMs += performance.now() - startWall;
  }
}

const history: CpuSample[] = [];
let lastSampleAt = performance.now();
let lastProcessCpu = cpuNow();
let lastPipelineCpu = 0;

function takeSample() {
  const now = performance.now();
  const processCpu = cpuNow();
  creditPipeline(processCpu);
  const elapsedUs = (now - lastSampleAt) * 1000;
  if (elapsedUs <= 0) return;

  const processPct = ((processCpu - lastProcessCpu) / elapsedUs) * 100;
  const pipelinePct = ((pipelineCpuUs - lastPipelineCpu) / elapsedUs) * 100;
  history.push({
    at: Date.now(),
    process: Math.max(0, processPct),
    pipeline: Math.min(Math.max(0, pipelinePct), Math.max(0, processPct)),
  });
  if (history.length > HISTORY_SIZE) history.shift();

  lastSampleAt = now;
  lastProcessCpu = processCpu;
  lastPipelineCpu = pipelineCpuUs;
}

setInterval(takeSample, SAMPLE_INTERVAL_MS).unref();

export function getCpuStats() {
  const processCpuUs = cpuNow();
  creditPipeline(processCpuUs);
  return {
    sampleIntervalSec: SAMPLE_INTERVAL_MS / 1000,
    history: [...history],
    /** CPU seconds since the process started. */
    processCpuSec: processCpuUs / 1e6,
    pipelineCpuSec: pipelineCpuUs / 1e6,
    stages: STAGES.map((stage) => {
      const totals = stageTotals.get(stage)!;
      return {
        stage,
        runs: totals.runs,
        cpuSec: totals.cpuUs / 1e6,
        wallSec: totals.wallMs / 1000,
      };
    }),
  };
}
