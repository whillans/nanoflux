<script lang="ts">
  import { onMount } from "svelte";
  import Ban from "@lucide/svelte/icons/ban";
  import { t, tf } from "../lib/locale.svelte";
  import {
    blockSource,
    fetchItemCluster,
    fetchItemsPage,
    markAllItemsRead,
    markItemRead,
    type ClusterItem,
    type Item,
  } from "../lib/api";
  import { formatTime } from "../lib/utils";
  import { safeHref } from "../../../shared/url";
  import ItemFilterToggle from "./buttons/ItemFilterToggle.svelte";
  import MarkAllReadButton from "./buttons/MarkAllReadButton.svelte";

  const PAGE_SIZE = 20;

  type ItemFilter = "unread" | "all";

  let items = $state<Item[]>([]);
  let cursor = $state<string | null>(null);
  let hasMore = $state(true);
  let loading = $state(false);
  let error = $state("");
  let sentinel = $state<HTMLDivElement | null>(null);
  let filter = $state<ItemFilter>("unread");
  let loadGeneration = 0;
  let blockingSources = $state(new Set<string>());
  let hiddenCovers = $state(new Set<number>());
  /** Items whose first-report/duplicate list is expanded. */
  let openClusters = $state(new Set<number>());
  /** Loaded cluster members by item id; `null` while loading. */
  let clusters = $state(new Map<number, ClusterItem[] | null>());
  let clusterErrors = $state(new Map<number, string>());
  const MIN_COVER_WIDTH = 200;
  const MIN_COVER_HEIGHT = 120;
  /** Bumps every minute so relative timestamps stay current. */
  let now = $state(Date.now());

  const filterIsRead = $derived(filter === "unread" ? (0 as const) : undefined);

  function resetList() {
    items = [];
    cursor = null;
    hasMore = true;
    error = "";
    loading = false;
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    const gen = ++loadGeneration;
    loading = true;
    error = "";

    try {
      const page = await fetchItemsPage(
        cursor ?? undefined,
        PAGE_SIZE,
        filterIsRead,
      );
      if (gen !== loadGeneration) return;
      items = [...items, ...page.data];
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    } catch (e) {
      if (gen !== loadGeneration) return;
      error = e instanceof Error ? e.message : t("items.loadFailed");
    } finally {
      if (gen === loadGeneration) loading = false;
    }
  }

  async function setReadFilter(next: ItemFilter) {
    if (next === filter) return;
    filter = next;
    loadGeneration++;
    resetList();
    await loadMore();
  }

  $effect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function compareItem(a: Item, b: Item): number {
    const cmp = b.published_at.localeCompare(a.published_at);
    if (cmp !== 0) return cmp;
    return b.id.localeCompare(a.id);
  }

  function handleOpenItem(item: Item) {
    if (item.is_read) return;
    if (filter === "unread") {
      items = items.filter((n) => n.id !== item.id);
    } else {
      items = items.map((n) =>
        n.id === item.id ? { ...n, is_read: true } : n,
      );
    }
    void markItemRead(item.id).catch(() => {
      if (filter === "unread") {
        items = [...items, { ...item, is_read: false }].sort(compareItem);
      } else {
        items = items.map((n) =>
          n.id === item.id ? { ...n, is_read: false } : n,
        );
      }
    });
  }

  /** Hide covers too small or too oddly shaped to fill the 4:3 thumbnail. */
  function handleCoverLoad(event: Event, item: Item): void {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;
    const { naturalWidth: width, naturalHeight: height } = image;
    const ratio = width / height;
    if (width >= MIN_COVER_WIDTH && height >= MIN_COVER_HEIGHT && ratio <= 3 && ratio >= 0.5) return;
    hiddenCovers = new Set([...hiddenCovers, item.id]);
  }

  /**
   * Covers always load through the same-origin proxy: a direct request would
   * hand the feed's image host the reader's IP and the time they opened the list.
   */
  function coverSrc(item: Item): string {
    return `/api/items/${item.id}/cover`;
  }

  function handleCoverError(item: Item): void {
    hiddenCovers = new Set([...hiddenCovers, item.id]);
  }

  async function toggleCluster(item: Item): Promise<void> {
    const open = new Set(openClusters);
    if (open.delete(item.id)) {
      openClusters = open;
      return;
    }
    openClusters = new Set([...open, item.id]);
    if (clusters.get(item.id)) return;

    clusters = new Map(clusters).set(item.id, null);
    const errors = new Map(clusterErrors);
    errors.delete(item.id);
    clusterErrors = errors;
    try {
      const members = await fetchItemCluster(item.id);
      clusters = new Map(clusters).set(item.id, members);
    } catch (e) {
      const next = new Map(clusters);
      next.delete(item.id);
      clusters = next;
      clusterErrors = new Map(clusterErrors).set(
        item.id,
        e instanceof Error ? e.message : t("items.clusterLoadFailed"),
      );
    }
  }

  /** Marks a cluster member read, including its row in the main list when present. */
  function handleOpenClusterItem(member: ClusterItem) {
    if (member.is_read) return;
    const listed = items.find((n) => n.id === member.id);
    if (listed) {
      handleOpenItem(listed);
    } else {
      void markItemRead(member.id).catch(() => {});
    }
    clusters = new Map(
      [...clusters].map(([id, members]) => [
        id,
        members?.map((m) => (m.id === member.id ? { ...m, is_read: true } : m)) ?? null,
      ]),
    );
  }

  async function handleBlockSource(source: string): Promise<void> {
    if (blockingSources.has(source)) return;
    blockingSources = new Set([...blockingSources, source]);
    error = "";
    try {
      await blockSource(source);
      items = items.filter((item) => item.source !== source);
    } catch (e) {
      error = e instanceof Error ? e.message : t("items.blockSourceFailed");
    } finally {
      const next = new Set(blockingSources);
      next.delete(source);
      blockingSources = next;
    }
  }

  export async function markAllRead() {
    if (items.length === 0) return;
    const until = items.reduce<string | undefined>((max, item) => {
      const publishedAt = item.published_at;
      if (!publishedAt) return max;
      if (!max || publishedAt > max) return publishedAt;
      return max;
    }, undefined);
    if (!until) return;
    await markAllItemsRead(until);
    if (filter === "unread") {
      items = items.filter((item) => item.published_at > until);
    } else {
      items = items.map((item) =>
        item.published_at <= until ? { ...item, is_read: true } : item,
      );
    }
  }

  onMount(() => {
    void loadMore();

    const timer = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  });
</script>

<div class="mb-6 flex items-center justify-end gap-0.5">
  <ItemFilterToggle
    {filter}
    onToggle={() => setReadFilter(filter === "unread" ? "all" : "unread")}
  />
  <MarkAllReadButton onMarkAllRead={() => markAllRead()} />
</div>

{#if error}
  <p class="py-6 text-sm text-red-500">{error}</p>
{:else if items.length === 0 && !loading}
  <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.noItems")}</p>
{:else}
  <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
    {#each items as item (item.id)}
      <li class="py-5">
        <article class="flex items-start gap-4">
          <div class="min-w-0 flex-1">
            <div
              class="flex items-baseline gap-1.5 text-xs text-neutral-400 dark:text-neutral-500"
            >
              <time datetime={item.published_at}>
                {formatTime(item.published_at, now)}
              </time>
              <span class="text-neutral-300 dark:text-neutral-600" aria-hidden="true"
                >·</span
              >
              <span>{item.feed_title}</span>
            </div>
            <a
              href={safeHref(item.link)}
              target="_blank"
              rel="noopener noreferrer"
              onclick={() => handleOpenItem(item)}
              class="mt-1 block text-sm leading-snug hover:text-neutral-600 dark:hover:text-neutral-300 {item.is_read
                ? 'font-normal text-neutral-500 dark:text-neutral-500'
                : 'font-medium text-neutral-900 dark:text-neutral-100'}"
            >
              {item.title}
            </a>
            {#if item.content}
              <p
                class="mt-2 line-clamp-2 text-sm text-neutral-400 dark:text-neutral-500"
              >
                {item.content}
              </p>
            {/if}
            {#if item.source || item.sim_id !== null || item.duplicate_count > 0}
              <div class="mt-2 flex h-4 items-center justify-between gap-3 text-xs leading-4 text-neutral-400 dark:text-neutral-500">
                <p class="group flex min-w-0 items-center gap-1">
                  {#if item.source}
                    <span>{item.source}</span>
                    <button
                      type="button"
                      class="inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded p-0 text-neutral-400 opacity-0 transition-[color,background-color,opacity] group-hover:opacity-100 focus-visible:opacity-100 hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      aria-label={`${t("items.blockSource")} ${item.source}`}
                      title={t("items.blockSource")}
                      disabled={blockingSources.has(item.source)}
                      onclick={() => void handleBlockSource(item.source)}
                    >
                      <Ban size={14} strokeWidth={1.5} aria-hidden={true} />
                    </button>
                  {/if}
                </p>
                {#if item.sim_id !== null || item.duplicate_count > 0}
                  <button
                    type="button"
                    class="-mx-1 shrink-0 cursor-pointer rounded px-1 hover:text-neutral-700 dark:hover:text-neutral-200 {item.sim_id ===
                    null
                      ? 'text-neutral-500 dark:text-neutral-400'
                      : ''}"
                    aria-expanded={openClusters.has(item.id)}
                    title={t("items.showCluster")}
                    onclick={() => void toggleCluster(item)}
                  >
                    {#if item.sim_id !== null}
                      {t("items.duplicate")}
                    {:else}
                      {t("items.firstReport")}
                      <span class="text-neutral-300 dark:text-neutral-600" aria-hidden="true">·</span>
                      {tf("items.duplicateCount", { n: item.duplicate_count })}
                    {/if}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
          {#if item.cover && !hiddenCovers.has(item.id)}
            <a
              href={safeHref(item.link)}
              target="_blank"
              rel="noopener noreferrer"
              onclick={() => handleOpenItem(item)}
              class="block aspect-[4/3] w-50 shrink-0 overflow-hidden rounded-md"
              tabindex="-1"
              aria-hidden="true"
            >
              <img
                src={coverSrc(item)}
                alt=""
                class="h-full w-full bg-neutral-100 object-cover dark:bg-neutral-800"
                loading="lazy"
                onload={(event) => handleCoverLoad(event, item)}
                onerror={() => handleCoverError(item)}
              />
            </a>
          {/if}
        </article>
        {#if openClusters.has(item.id)}
          <div class="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-xs dark:bg-neutral-900">
            {#if clusterErrors.has(item.id)}
              <p class="py-1 text-red-500">{clusterErrors.get(item.id)}</p>
            {:else if !clusters.get(item.id)}
              <p class="py-1 text-neutral-400 dark:text-neutral-500">{t("items.loading")}</p>
            {:else if clusters.get(item.id)?.length === 0}
              <p class="py-1 text-neutral-400 dark:text-neutral-500">{t("items.clusterEmpty")}</p>
            {:else}
              <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
                {#each clusters.get(item.id) ?? [] as member (member.id)}
                  <li class="py-2">
                    <div class="flex items-baseline gap-1.5 text-neutral-400 dark:text-neutral-500">
                      <span class={member.sim_id === null ? "text-neutral-600 dark:text-neutral-300" : ""}>
                        {member.sim_id === null ? t("items.firstReport") : t("items.duplicate")}
                      </span>
                      <span class="text-neutral-300 dark:text-neutral-600" aria-hidden="true">·</span>
                      <time datetime={member.published_at}>
                        {formatTime(member.published_at, now)}
                      </time>
                      <span class="text-neutral-300 dark:text-neutral-600" aria-hidden="true">·</span>
                      <span class="truncate">{member.source || member.feed_title}</span>
                      {#if member.id === item.id}
                        <span class="text-neutral-300 dark:text-neutral-600" aria-hidden="true">·</span>
                        <span>{t("items.clusterCurrent")}</span>
                      {/if}
                    </div>
                    <a
                      href={safeHref(member.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onclick={() => handleOpenClusterItem(member)}
                      class="mt-0.5 block leading-snug hover:text-neutral-600 dark:hover:text-neutral-300 {member.is_read
                        ? 'text-neutral-500 dark:text-neutral-500'
                        : 'text-neutral-800 dark:text-neutral-200'}"
                    >
                      {member.title}
                    </a>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if loading}
  <p class="py-8 text-center text-sm text-neutral-300 dark:text-neutral-600">
    {t("items.loading")}
  </p>
{:else if !hasMore && items.length > 0}
  <p class="py-8 text-center text-sm text-neutral-300 dark:text-neutral-600">
    {t("items.noMore")}
  </p>
{/if}

<div bind:this={sentinel} class="h-1" aria-hidden="true"></div>
