<script lang="ts">
  import { onMount } from "svelte";
  import { fetchSystemStatus, type SystemStatus } from "../lib/api";
  import { t, tf } from "../lib/locale.svelte";
  import type { MessageKey } from "../lib/i18n/messages";

  const REFRESH_MS = 3_000;
  const BAR_COLOR = "bg-[#2a78d6] dark:bg-[#3987e5]";
  const OUTSIDE_COLOR = "bg-[#eb6834] dark:bg-[#d95926]";
  const PIPELINE_FILL = "fill-[#2a78d6] dark:fill-[#3987e5]";
  const OUTSIDE_FILL = "fill-[#eb6834] dark:fill-[#d95926]";
  const labelClass = "text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500";

  let status = $state<SystemStatus | null>(null);
  let error = $state("");

  let loading = false;

  async function load() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      status = await fetchSystemStatus();
      error = "";
    } catch (e) {
      error = e instanceof Error ? e.message : t("system.loadFailed");
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  const percent = (value: number) => `${value.toFixed(1)}%`;

  function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const parts: string[] = [];
    if (days) parts.push(tf("system.days", { n: days }));
    if (days || hours) parts.push(tf("system.hours", { n: hours }));
    parts.push(tf("system.minutes", { n: minutes }));
    return parts.join(" ");
  }

  type Tile = {
    label: MessageKey;
    value: string;
    /** Meter fill, 0–1. */
    ratio: number;
    note: string;
  };
  type Detail = [MessageKey, string];

  const hostTiles = $derived.by<Tile[]>(() => {
    if (!status) return [];
    const { system } = status;
    return [
      {
        label: "system.cpu",
        value: percent(system.cpuPercent),
        ratio: system.cpuPercent / 100,
        note: [
          tf("system.cores", { n: system.cpuCores }),
          system.loadAvg.some((n) => n > 0)
            ? tf("system.load", { load: system.loadAvg.map((n) => n.toFixed(2)).join(" ") })
            : "",
        ].filter(Boolean).join(" · "),
      },
      {
        label: "system.memory",
        value: formatBytes(system.memoryUsed),
        ratio: system.memoryTotal > 0 ? system.memoryUsed / system.memoryTotal : 0,
        note: `${tf("system.ofTotal", { total: formatBytes(system.memoryTotal) })} · ${percent(
          system.memoryTotal > 0 ? (system.memoryUsed / system.memoryTotal) * 100 : 0,
        )}`,
      },
    ];
  });

  const appTiles = $derived.by<Tile[]>(() => {
    if (!status) return [];
    const { system, process } = status;
    return [
      {
        label: "system.processCpu",
        value: percent(process.cpuPercent),
        // One busy core fills the meter, matching the htop-style number.
        ratio: process.cpuPercent / 100,
        note: tf("system.cores", { n: system.cpuCores }),
      },
      {
        label: "system.rss",
        value: formatBytes(process.rss),
        ratio: system.memoryTotal > 0 ? process.rss / system.memoryTotal : 0,
        note: tf("system.ofHost", {
          rate: percent(system.memoryTotal > 0 ? (process.rss / system.memoryTotal) * 100 : 0),
        }),
      },
      {
        label: "system.heap",
        value: formatBytes(process.heapUsed),
        // Bun's heapTotal can be smaller than heapUsed, so compare against RSS.
        ratio: process.rss > 0 ? process.heapUsed / process.rss : 0,
        note: tf("system.heapOf", {
          rate: percent(process.rss > 0 ? (process.heapUsed / process.rss) * 100 : 0),
        }),
      },
    ];
  });

  const hostDetails = $derived<Detail[]>(
    status
      ? [
          ["system.platform", status.system.platform],
          ["system.cpuModel", status.system.cpuModel || "—"],
          ["system.uptime", formatUptime(status.system.uptimeSec)],
        ]
      : [],
  );

  // ---- Where CPU goes ----

  type StageKey = SystemStatus["cpuStats"]["stages"][number]["stage"];
  const STAGE_LABELS: Record<StageKey, MessageKey> = {
    rss: "system.stage.rss",
    resolve: "system.stage.resolve",
    scrape: "system.stage.scrape",
    filter: "system.stage.filter",
    translate: "system.stage.translate",
    dedup: "system.stage.dedup",
  };

  // Bottom of the stack first; colors follow the series, never its rank.
  const SERIES: { key: string; label: MessageKey; swatch: string }[] = [
    { key: "pipeline", label: "system.pipeline", swatch: BAR_COLOR },
    { key: "outside", label: "system.outside", swatch: OUTSIDE_COLOR },
  ];

  const CHART_W = 1000;
  const CHART_H = 100;

  let hovered = $state<number | null>(null);

  const history = $derived(status?.cpuStats.history ?? []);

  /** A round axis maximum, at least 10%. */
  function niceMax(max: number): number {
    const target = Math.max(10, max);
    const pow = 10 ** Math.floor(Math.log10(target));
    return [1, 1.2, 1.6, 2, 2.5, 3, 4, 5, 6, 8, 10].find((c) => c * pow >= target)! * pow;
  }

  const axisMax = $derived(niceMax(Math.max(0, ...history.map((s) => s.process))));

  const chart = $derived.by(() => {
    const n = history.length;
    if (n < 2) return null;
    const x = (i: number) => (i / (n - 1)) * CHART_W;
    const y = (v: number) => CHART_H - (Math.min(v, axisMax) / axisMax) * CHART_H;
    const pipelineTop = history.map((s, i) => `${x(i)},${y(s.pipeline)}`);
    const processTop = history.map((s, i) => `${x(i)},${y(s.process)}`);
    return {
      pipeline: `M0,${CHART_H} L${pipelineTop.join(" L")} L${CHART_W},${CHART_H} Z`,
      outside: `M${processTop.join(" L")} L${[...pipelineTop].reverse().join(" L")} Z`,
    };
  });

  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = (ms: number) => {
    const d = new Date(ms);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const clockSec = (ms: number) => `${clock(ms)}:${pad(new Date(ms).getSeconds())}`;

  const xTicks = $derived(
    history.length < 2
      ? []
      : [0, Math.floor((history.length - 1) / 2), history.length - 1].map((i) => clock(history[i]!.at)),
  );

  function onChartPointer(event: PointerEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (history.length < 2 || rect.width === 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    hovered = Math.round(fraction * (history.length - 1));
  }

  const hoveredSample = $derived(hovered === null ? null : (history[hovered] ?? null));
  const hoverLeft = $derived(
    hovered === null || history.length < 2 ? 0 : (hovered / (history.length - 1)) * 100,
  );
  const tooltipStyle = $derived(
    hoverLeft < 25
      ? `left: ${hoverLeft}%`
      : hoverLeft > 75
        ? `right: ${100 - hoverLeft}%`
        : `left: ${hoverLeft}%; transform: translateX(-50%)`,
  );
  const tooltipRows = $derived(
    hoveredSample
      ? [
          { color: OUTSIDE_COLOR, label: t("system.outside"), value: hoveredSample.process - hoveredSample.pipeline },
          { color: BAR_COLOR, label: t("system.pipeline"), value: hoveredSample.pipeline },
        ]
      : [],
  );

  const seconds = (value: number) =>
    value >= 3600
      ? `${(value / 3600).toFixed(1)} h`
      : value >= 60
        ? `${(value / 60).toFixed(1)} min`
        : `${value.toFixed(value >= 10 ? 0 : 1)} s`;

  type StageRow = { label: string; cpuSec: number; note: string; color: string };

  const stageRows = $derived.by<StageRow[]>(() => {
    if (!status) return [];
    const { stages, processCpuSec, pipelineCpuSec } = status.cpuStats;
    const rows: StageRow[] = stages.map((s) => ({
      label: t(STAGE_LABELS[s.stage]),
      cpuSec: s.cpuSec,
      note: tf("system.stageNote", {
        runs: s.runs,
        avg: seconds(s.runs > 0 ? s.wallSec / s.runs : 0),
      }),
      color: BAR_COLOR,
    }));
    rows.push({
      label: t("system.outside"),
      cpuSec: Math.max(0, processCpuSec - pipelineCpuSec),
      note: "",
      color: OUTSIDE_COLOR,
    });
    return rows.sort((a, b) => b.cpuSec - a.cpuSec);
  });

  const processCpuSec = $derived(status?.cpuStats.processCpuSec ?? 0);
  const shareOfProcess = (cpuSec: number) =>
    processCpuSec > 0 ? (cpuSec / processCpuSec) * 100 : 0;


  const appDetails = $derived<Detail[]>(
    status
      ? [
          ["system.pid", String(status.process.pid)],
          ["system.runtime", status.process.runtime],
          ["system.uptime", formatUptime(status.process.uptimeSec)],
        ]
      : [],
  );
</script>

{#snippet group(title: string, subtitle: string, tiles: Tile[], details: Detail[])}
  <section class="space-y-6">
    <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 class={labelClass}>{title}</h2>
      {#if subtitle}
        <span class="min-w-0 truncate text-xs text-neutral-400 dark:text-neutral-500">{subtitle}</span>
      {/if}
    </div>

    <div class="grid gap-x-6 gap-y-8 sm:grid-cols-3">
      {#each tiles as tile (tile.label)}
        <div class="min-w-0 space-y-2">
          <div class={labelClass}>{t(tile.label)}</div>
          <div class="text-3xl font-medium tracking-tight tabular-nums">{tile.value}</div>
          <div
            class="h-1.5 rounded-[4px] bg-neutral-100 dark:bg-neutral-800"
            role="meter"
            aria-label={t(tile.label)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(1, tile.ratio) * 100)}
          >
            <div
              class="h-full rounded-[4px] transition-[width] duration-500 {BAR_COLOR}"
              style="width: {Math.min(1, Math.max(0, tile.ratio)) * 100}%"
            ></div>
          </div>
          <div class="truncate text-xs text-neutral-400 tabular-nums dark:text-neutral-500" title={tile.note}>
            {tile.note}
          </div>
        </div>
      {/each}
    </div>

    <dl class="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
      {#each details as [label, value] (label)}
        <div class="min-w-0">
          <dt class="text-xs text-neutral-400 dark:text-neutral-500">{t(label)}</dt>
          <dd class="truncate" title={value}>{value}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/snippet}

<section class="space-y-12">
  <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("system.hint")}</p>

  {#if error && !status}
    <p class="text-sm text-red-500">{error}</p>
  {:else if !status}
    <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("items.loading")}</p>
  {:else}
    {#if error}
      <p class="text-sm text-red-500">{error}</p>
    {/if}
    {@render group(t("system.host"), status.system.hostname, hostTiles, hostDetails)}
    {@render group(t("system.app"), "", appTiles, appDetails)}

    <section class="space-y-6">
      <div class="space-y-2">
        <h2 class={labelClass}>{t("system.cpuBreakdown")}</h2>
        <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("system.breakdownHint")}</p>
      </div>

      <ul class="flex flex-wrap gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        {#each SERIES as series (series.key)}
          <li class="flex items-center gap-1.5">
            <span class="size-2.5 rounded-[2px] {series.swatch}" aria-hidden="true"></span>
            {t(series.label)}
          </li>
        {/each}
      </ul>

      {#if !chart}
        <p class="text-sm text-neutral-400 dark:text-neutral-500">
          {tf("system.collecting", { n: status.cpuStats.sampleIntervalSec })}
        </p>
      {:else}
        <div class="flex gap-2 text-xs text-neutral-400 tabular-nums dark:text-neutral-500">
          <div class="flex h-40 flex-col justify-between text-right" aria-hidden="true">
            <span class="-translate-y-1/2">{axisMax}%</span>
            <span>{axisMax / 2}%</span>
            <span class="translate-y-1/2">0</span>
          </div>

          <div class="min-w-0 flex-1">
            <div
              class="relative h-40 touch-none"
              role="img"
              aria-label={t("system.cpuBreakdown")}
              onpointermove={onChartPointer}
              onpointerdown={onChartPointer}
              onpointerleave={() => (hovered = null)}
            >
              <div class="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                <div class="border-t border-neutral-100 dark:border-neutral-800"></div>
                <div class="border-t border-neutral-100 dark:border-neutral-800"></div>
                <div class="border-t border-neutral-300 dark:border-neutral-700"></div>
              </div>

              <svg
                class="absolute inset-0 h-full w-full"
                viewBox="0 0 {CHART_W} {CHART_H}"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d={chart.pipeline} class={PIPELINE_FILL} />
                <path d={chart.outside} class={OUTSIDE_FILL} />
              </svg>

              {#if hoveredSample}
                <div
                  class="pointer-events-none absolute inset-y-0 w-px bg-neutral-400 dark:bg-neutral-500"
                  style="left: {hoverLeft}%"
                ></div>
                <div
                  class="pointer-events-none absolute bottom-full z-10 mb-1 min-w-44 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
                  style={tooltipStyle}
                >
                  <div class="mb-1.5 text-neutral-900 dark:text-neutral-100">{clockSec(hoveredSample.at)}</div>
                  {#each tooltipRows as row (row.label)}
                    <div class="flex items-center gap-1.5 py-0.5">
                      <span class="size-2.5 rounded-[2px] {row.color}" aria-hidden="true"></span>
                      <span class="flex-1">{row.label}</span>
                      <span class="text-neutral-900 tabular-nums dark:text-neutral-100">{percent(row.value)}</span>
                    </div>
                  {/each}
                  <div class="mt-1 flex border-t border-neutral-100 pt-1 dark:border-neutral-800">
                    <span class="flex-1">{t("system.total")}</span>
                    <span class="text-neutral-900 tabular-nums dark:text-neutral-100">
                      {percent(hoveredSample.process)}
                    </span>
                  </div>
                </div>
              {/if}
            </div>

            <div class="mt-2 flex justify-between" aria-hidden="true">
              {#each xTicks as tick, i (i)}
                <span>{tick}</span>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      <div class="space-y-4 pt-4">
        <h3 class={labelClass}>{t("system.stageTotals")}</h3>
        <ul class="space-y-3">
          {#each stageRows as row (row.label)}
            <li class="space-y-1.5">
              <div class="flex items-baseline gap-3 text-sm">
                <span class="min-w-0 flex-1 truncate">{row.label}</span>
                {#if row.note}
                  <span class="hidden shrink-0 text-xs text-neutral-400 sm:inline dark:text-neutral-500">{row.note}</span>
                {/if}
                <span class="w-16 shrink-0 text-right tabular-nums">{seconds(row.cpuSec)}</span>
                <span class="w-12 shrink-0 text-right text-neutral-400 tabular-nums dark:text-neutral-500">
                  {percent(shareOfProcess(row.cpuSec))}
                </span>
              </div>
              <div class="h-1.5">
                <div
                  class="h-full min-w-px rounded-r-[4px] {row.color}"
                  style="width: {shareOfProcess(row.cpuSec)}%"
                ></div>
              </div>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}
</section>
