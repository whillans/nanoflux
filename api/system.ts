import { cpus, freemem, hostname, loadavg, platform, release, totalmem, uptime } from "node:os";
import { Elysia } from "elysia";
import { getCpuStats } from "../services/cpu-stats";

/** CPU percentages are deltas, so a reading needs at least this much elapsed time. */
const MIN_SAMPLE_MS = 500;

type Sample = {
  at: number;
  /** Summed over all cores, in ms. */
  systemBusy: number;
  systemTotal: number;
  /** Process user + system time, in µs. */
  processCpu: number;
};

type CpuReading = { systemPercent: number; processPercent: number };

let lastSample: Sample | null = null;
let lastReading: CpuReading | null = null;

function takeSample(): Sample {
  let busy = 0;
  let total = 0;
  for (const { times } of cpus()) {
    const sum = times.user + times.nice + times.sys + times.idle + times.irq;
    total += sum;
    busy += sum - times.idle;
  }
  const usage = process.cpuUsage();
  return {
    at: performance.now(),
    systemBusy: busy,
    systemTotal: total,
    processCpu: usage.user + usage.system,
  };
}

const clampPercent = (value: number, max: number) =>
  Math.min(max, Math.max(0, Number.isFinite(value) ? value : 0));

/**
 * CPU usage since the previous reading. Readings closer than MIN_SAMPLE_MS
 * reuse the last result, so concurrent viewers do not shrink the window.
 */
async function readCpu(): Promise<CpuReading> {
  if (!lastSample) {
    lastSample = takeSample();
    await Bun.sleep(MIN_SAMPLE_MS);
  } else if (lastReading && performance.now() - lastSample.at < MIN_SAMPLE_MS) {
    return lastReading;
  }

  const prev = lastSample;
  const next = takeSample();
  const cores = cpus().length || 1;
  const elapsedMs = next.at - prev.at;
  const systemDelta = next.systemTotal - prev.systemTotal;

  lastSample = next;
  lastReading = {
    systemPercent: clampPercent(
      systemDelta > 0 ? ((next.systemBusy - prev.systemBusy) / systemDelta) * 100 : 0,
      100,
    ),
    // Same convention as top/htop: 100% is one fully busy core.
    processPercent: clampPercent(
      elapsedMs > 0 ? ((next.processCpu - prev.processCpu) / 1000 / elapsedMs) * 100 : 0,
      cores * 100,
    ),
  };
  return lastReading;
}

/**
 * Available memory. On Linux `MemFree` excludes reclaimable page cache, so
 * `MemAvailable` is read directly; elsewhere the OS figure is used.
 */
async function availableMemory(): Promise<number> {
  if (platform() === "linux") {
    try {
      const meminfo = await Bun.file("/proc/meminfo").text();
      const kb = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(meminfo)?.[1];
      if (kb) return Number(kb) * 1024;
    } catch {
      /* fall through */
    }
  }
  return freemem();
}

async function getSystemHandler() {
  try {
    const [cpu, available] = await Promise.all([readCpu(), availableMemory()]);
    const cpuList = cpus();
    const memory = process.memoryUsage();
    return {
      code: 0,
      message: "ok",
      data: {
        system: {
          hostname: hostname(),
          platform: `${platform()} ${release()}`,
          cpuModel: cpuList[0]?.model.trim() ?? "",
          cpuCores: cpuList.length,
          cpuPercent: cpu.systemPercent,
          loadAvg: loadavg(),
          memoryTotal: totalmem(),
          memoryUsed: Math.max(0, totalmem() - available),
          uptimeSec: uptime(),
        },
        process: {
          pid: process.pid,
          runtime: `Bun ${Bun.version}`,
          cpuPercent: cpu.processPercent,
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          uptimeSec: process.uptime(),
        },
        cpuStats: getCpuStats(),
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to read system status";
    return { code: 500, message };
  }
}

export const routes = new Elysia({ prefix: "/api/system" })
  .get("/", getSystemHandler);
