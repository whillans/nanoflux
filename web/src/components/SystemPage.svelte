<script lang="ts">
  import { onMount } from "svelte";
  import { fetchSystemStatus, type SystemStatus } from "../lib/api";
  import { t, tf } from "../lib/locale.svelte";
  import type { MessageKey } from "../lib/i18n/messages";

  const REFRESH_MS = 3_000;
  const BAR_COLOR = "bg-[#2a78d6] dark:bg-[#3987e5]";
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
  {/if}
</section>
