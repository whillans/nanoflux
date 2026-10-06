<script lang="ts">
  import { fetchItemStats, type ItemStats } from "../lib/api";
  import { t, tf } from "../lib/locale.svelte";
  import type { MessageKey } from "../lib/i18n/messages";

  type RangeKey = "24h" | "7d" | "30d";
  type Bucket = "hour" | "day";
  type Series = "rejected" | "duplicates" | "firstReports";

  const RANGES: { key: RangeKey; label: MessageKey; bucket: Bucket; count: number }[] = [
    { key: "24h", label: "stats.range24h", bucket: "hour", count: 24 },
    { key: "7d", label: "stats.range7d", bucket: "day", count: 7 },
    { key: "30d", label: "stats.range30d", bucket: "day", count: 30 },
  ];

  // Fixed order, bottom of the stack first. Colors follow the status, never its rank.
  const SERIES: { key: Series; label: MessageKey; color: string }[] = [
    { key: "firstReports", label: "items.firstReport", color: "bg-[#2a78d6] dark:bg-[#3987e5]" },
    { key: "duplicates", label: "stats.duplicates", color: "bg-[#1baf7a] dark:bg-[#199e70]" },
    { key: "rejected", label: "stats.rejected", color: "bg-[#eb6834] dark:bg-[#d95926]" },
  ];
  const BAR_COLOR = SERIES[0]!.color;

  const labelClass = "text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500";

  let rangeKey = $state<RangeKey>("7d");
  let stats = $state<ItemStats | null>(null);
  /** Local start of each bucket in the loaded range, oldest first. */
  let bucketStarts = $state<Date[]>([]);
  let loadedBucket = $state<Bucket>("day");
  let loading = $state(true);
  let error = $state("");
  let hovered = $state<number | null>(null);

  let requestSeq = 0;

  const pad = (n: number) => String(n).padStart(2, "0");

  /** Matches the server's bucket key: local `YYYY-MM-DD` or `YYYY-MM-DD HH`. */
  function bucketKey(date: Date, bucket: Bucket): string {
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return bucket === "hour" ? `${day} ${pad(date.getHours())}` : day;
  }

  /** Whole local buckets ending with the current one. */
  function bucketsFor(bucket: Bucket, count: number): Date[] {
    const now = new Date();
    return Array.from({ length: count }, (_, i) => {
      const back = count - 1 - i;
      return bucket === "hour"
        ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - back)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    });
  }

  async function load(key: RangeKey) {
    const range = RANGES.find((r) => r.key === key)!;
    const starts = bucketsFor(range.bucket, range.count);
    const seq = ++requestSeq;
    loading = true;
    error = "";
    try {
      const data = await fetchItemStats({
        since: starts[0]!.toISOString(),
        until: new Date().toISOString(),
        bucket: range.bucket,
      });
      if (seq !== requestSeq) return;
      stats = data;
      bucketStarts = starts;
      loadedBucket = range.bucket;
      hovered = null;
    } catch (e) {
      if (seq !== requestSeq) return;
      error = e instanceof Error ? e.message : t("stats.loadFailed");
    } finally {
      if (seq === requestSeq) loading = false;
    }
  }

  $effect(() => {
    void load(rangeKey);
  });

  const fmt = (n: number) => n.toLocaleString();
  const percent = (part: number, whole: number) =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

  const tiles = $derived(
    stats
      ? ([
          ["stats.total", stats.overview.total],
          ["stats.passed", stats.overview.passed],
          ["stats.rejected", stats.overview.rejected],
          ["items.firstReport", stats.overview.firstReports],
          ["stats.duplicates", stats.overview.duplicates],
          ["stats.mcpPending", stats.overview.mcpPending],
        ] as [MessageKey, number][])
      : [],
  );

  const columns = $derived.by(() => {
    if (!stats) return [];
    const byKey = new Map(stats.trend.map((row) => [row.bucket, row]));
    return bucketStarts.map((start) => {
      const row = byKey.get(bucketKey(start, loadedBucket));
      const rejected = row?.rejected ?? 0;
      const duplicates = row?.duplicates ?? 0;
      const firstReports = row?.firstReports ?? 0;
      return { start, total: rejected + duplicates + firstReports, rejected, duplicates, firstReports };
    });
  });

  /** A round axis maximum whose midpoint is a whole number. */
  function niceMax(max: number): number {
    if (max <= 2) return 2;
    if (max < 10) return max % 2 ? max + 1 : max;
    const pow = 10 ** Math.floor(Math.log10(max));
    return [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10].find((c) => c * pow >= max)! * pow;
  }

  const axisMax = $derived(niceMax(Math.max(0, ...columns.map((c) => c.total))));
  const tickEvery = $derived(
    loadedBucket === "hour" ? 6 : columns.length > 7 ? 5 : 1,
  );

  function tickLabel(start: Date): string {
    return loadedBucket === "hour"
      ? `${pad(start.getHours())}:00`
      : `${start.getMonth() + 1}/${start.getDate()}`;
  }

  function fullLabel(start: Date): string {
    const day = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    return loadedBucket === "hour" ? `${day} ${pad(start.getHours())}:00` : day;
  }

  const hoveredColumn = $derived(hovered === null ? null : (columns[hovered] ?? null));
  const tooltipStyle = $derived.by(() => {
    if (hovered === null || columns.length === 0) return "";
    const center = ((hovered + 0.5) / columns.length) * 100;
    // Keep the tooltip inside the plot near either edge.
    if (center < 25) return `left: ${center}%`;
    if (center > 75) return `right: ${100 - center}%`;
    return `left: ${center}%; transform: translateX(-50%)`;
  });

  type RankRow = { label: string; value: number; note?: string };

  const feedRows = $derived<RankRow[]>(
    (stats?.byFeed ?? []).map((row) => ({
      label: row.title,
      value: row.total,
      note: tf("stats.passRate", { rate: percent(row.passed, row.total) }),
    })),
  );
  const sourceRows = $derived<RankRow[]>(
    (stats?.bySource ?? []).map((row) => ({
      label: row.source,
      value: row.total,
      note: tf("stats.passRate", { rate: percent(row.passed, row.total) }),
    })),
  );
  const reasonRows = $derived.by<RankRow[]>(() => {
    if (!stats || stats.overview.rejected === 0) return [];
    const { source, keyword, ai } = stats.byReason;
    const rejected = stats.overview.rejected;
    return (
      [
        ["stats.reasonAi", ai],
        ["stats.reasonKeyword", keyword],
        ["stats.reasonSource", source],
      ] as [MessageKey, number][]
    ).map(([label, value]) => ({
      label: t(label),
      value,
      note: percent(value, rejected),
    }));
  });
</script>

{#snippet rankList(title: string, rows: RankRow[])}
  {@const max = Math.max(1, ...rows.map((row) => row.value))}
  <section class="min-w-0 space-y-4">
    <h2 class={labelClass}>{title}</h2>
    <ul class="space-y-3">
      {#each rows as row, i (i)}
        <li class="space-y-1.5">
          <div class="flex items-baseline gap-3 text-sm">
            <span class="min-w-0 flex-1 truncate" title={row.label}>{row.label}</span>
            {#if row.note}
              <span class="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{row.note}</span>
            {/if}
            <span class="shrink-0 tabular-nums">{fmt(row.value)}</span>
          </div>
          <div class="h-1.5">
            <div
              class="h-full min-w-px rounded-r-[4px] {BAR_COLOR}"
              style="width: {(row.value / max) * 100}%"
            ></div>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/snippet}

<section class="space-y-12">
  <div class="flex flex-wrap items-center justify-between gap-4">
    <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("stats.hint")}</p>
    <div class="flex gap-4 text-sm" role="group" aria-label={t("stats.range")}>
      {#each RANGES as range (range.key)}
        <button
          type="button"
          class="underline-offset-4 transition-colors {rangeKey === range.key
            ? 'text-neutral-900 underline dark:text-neutral-100'
            : 'text-neutral-400 hover:text-neutral-900 dark:text-neutral-500 dark:hover:text-neutral-100'}"
          aria-pressed={rangeKey === range.key}
          onclick={() => (rangeKey = range.key)}
        >
          {t(range.label)}
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <p class="text-sm text-red-500">{error}</p>
  {:else if !stats}
    <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("items.loading")}</p>
  {:else}
    <div class="space-y-12 transition-opacity {loading ? 'opacity-50' : ''}">
      <dl class="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
        {#each tiles as [label, value] (label)}
          <div class="space-y-2">
            <dt class={labelClass}>{t(label)}</dt>
            <dd class="text-3xl font-medium tracking-tight">{fmt(value)}</dd>
          </div>
        {/each}
      </dl>

      {#if stats.overview.total === 0}
        <p class="text-sm text-neutral-400 dark:text-neutral-500">{t("stats.empty")}</p>
      {:else}
        <section class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <h2 class={labelClass}>{t("stats.trend")}</h2>
            <ul class="flex gap-4 text-xs text-neutral-500 dark:text-neutral-400">
              {#each SERIES as series (series.key)}
                <li class="flex items-center gap-1.5">
                  <span class="size-2.5 rounded-[2px] {series.color}" aria-hidden="true"></span>
                  {t(series.label)}
                </li>
              {/each}
            </ul>
          </div>

          <div class="flex gap-2 text-xs text-neutral-400 tabular-nums dark:text-neutral-500">
            <div class="flex h-44 flex-col justify-between text-right" aria-hidden="true">
              <span class="-translate-y-1/2">{fmt(axisMax)}</span>
              <span>{fmt(axisMax / 2)}</span>
              <span class="translate-y-1/2">0</span>
            </div>

            <div class="min-w-0 flex-1">
              <div
                class="relative h-44"
                role="group"
                aria-label={t("stats.trend")}
                onpointerleave={() => (hovered = null)}
              >
                <div class="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                  <div class="border-t border-neutral-100 dark:border-neutral-800"></div>
                  <div class="border-t border-neutral-100 dark:border-neutral-800"></div>
                  <div class="border-t border-neutral-300 dark:border-neutral-700"></div>
                </div>

                <div class="relative flex h-full gap-0.5 sm:gap-1">
                  {#each columns as column, i (column.start.getTime())}
                    {@const segments = SERIES.filter((series) => column[series.key] > 0)}
                    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                    <div
                      class="flex h-full min-w-0 flex-1 justify-center rounded-t-[4px] outline-none {hovered === i
                        ? 'bg-neutral-100 dark:bg-neutral-900'
                        : ''}"
                      role="img"
                      tabindex="0"
                      aria-label="{fullLabel(column.start)}: {SERIES.map(
                        (series) => `${t(series.label)} ${fmt(column[series.key])}`,
                      ).join(', ')}"
                      onpointerenter={() => (hovered = i)}
                      onfocus={() => (hovered = i)}
                      onblur={() => (hovered = null)}
                    >
                      <div class="flex h-full w-full max-w-6 flex-col-reverse gap-0.5">
                        {#each segments as series, s (series.key)}
                          <div
                            class="min-h-px {series.color} {s === segments.length - 1
                              ? 'rounded-t-[4px]'
                              : ''}"
                            style="height: {(column[series.key] / axisMax) * 100}%"
                          ></div>
                        {/each}
                      </div>
                    </div>
                  {/each}
                </div>

                {#if hoveredColumn}
                  <div
                    class="pointer-events-none absolute bottom-full z-10 mb-1 min-w-36 rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
                    style={tooltipStyle}
                  >
                    <div class="mb-1.5 text-neutral-900 dark:text-neutral-100">
                      {fullLabel(hoveredColumn.start)}
                    </div>
                    {#each [...SERIES].reverse() as series (series.key)}
                      <div class="flex items-center gap-1.5 py-0.5">
                        <span class="size-2.5 rounded-[2px] {series.color}" aria-hidden="true"></span>
                        <span class="flex-1">{t(series.label)}</span>
                        <span class="text-neutral-900 dark:text-neutral-100">
                          {fmt(hoveredColumn[series.key])}
                        </span>
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>

              <div class="mt-2 flex gap-0.5 sm:gap-1" aria-hidden="true">
                {#each columns as column, i (column.start.getTime())}
                  <div class="flex min-w-0 flex-1 justify-center">
                    {#if (columns.length - 1 - i) % tickEvery === 0}
                      <span class="whitespace-nowrap">{tickLabel(column.start)}</span>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          </div>
        </section>

        <div class="grid gap-x-10 gap-y-12 md:grid-cols-2">
          {#if feedRows.length > 0}
            {@render rankList(t("stats.byFeed"), feedRows)}
          {/if}
          {#if sourceRows.length > 0}
            {@render rankList(t("stats.bySource"), sourceRows)}
          {/if}
          {#if reasonRows.length > 0}
            {@render rankList(t("stats.byReason"), reasonRows)}
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>
