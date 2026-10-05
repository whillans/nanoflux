<script lang="ts">
  import { onMount, tick } from "svelte";
  import Download from "@lucide/svelte/icons/download";
  import Pencil from "@lucide/svelte/icons/pencil";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import {
    createFeed,
    deleteFeed,
    downloadFeedsOpml,
    fetchFeedsPage,
    previewFeed,
    resolveWechatFeed,
    searchWechatAccounts,
    updateFeed,
    type Feed,
    type FeedSort,
    type WechatAccount,
  } from "../lib/api";
  import { t } from "../lib/locale.svelte";
  import { formatTime } from "../lib/utils";
  import { buildKeywordGoogleNewsFeedUrl } from "../../../shared/google-news";
  import { isHttpUrl, safeHref } from "../../../shared/url";

  const PAGE_SIZE = 20;
  const iconProps = { size: 16, strokeWidth: 1.5, "aria-hidden": true as const };

  let feeds = $state<Feed[]>([]);
  let cursor = $state<string | null>(null);
  let hasMore = $state(true);
  let editId = $state<number | null>(null);
  let title = $state("");
  let url = $state("");
  let description = $state("");
  let formError = $state("");
  let listError = $state("");
  let loading = $state(true);
  let loadingMore = $state(false);
  let previewing = $state(false);
  let previewError = $state("");
  let titleTouched = $state(false);
  let descriptionTouched = $state(false);
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRequest = 0;
  let sentinel = $state<HTMLDivElement | null>(null);
  let sort = $state<FeedSort>("updated_desc");
  let exportingOpml = $state(false);
  /** Bumps every minute so relative timestamps stay current. */
  let now = $state(Date.now());
  let keywordDialogOpen = $state(false);
  let keywordInput = $state("");
  let keywordError = $state("");
  let keywordInputEl = $state<HTMLInputElement | null>(null);
  let wechatDialogOpen = $state(false);
  let wechatQuery = $state("");
  let wechatError = $state("");
  let wechatSearching = $state(false);
  let wechatResolving = $state(false);
  let wechatAccounts = $state<WechatAccount[]>([]);
  let wechatSearched = $state(false);
  let wechatInputEl = $state<HTMLInputElement | null>(null);
  let wechatSearchRequest = 0;

  const isEditing = $derived(editId !== null);

  async function openKeywordDialog() {
    keywordInput = "";
    keywordError = "";
    keywordDialogOpen = true;
    await tick();
    keywordInputEl?.focus();
  }

  function closeKeywordDialog() {
    keywordDialogOpen = false;
    keywordInput = "";
    keywordError = "";
  }

  function applyKeywordFeed() {
    const keyword = keywordInput.trim();
    if (!keyword) {
      keywordError = t("feeds.keywordEmpty");
      return;
    }

    resetForm();
    url = buildKeywordGoogleNewsFeedUrl(keyword);
    title = keyword;
    titleTouched = true;
    closeKeywordDialog();
    void runPreview(url);
  }

  async function openWechatDialog() {
    wechatQuery = "";
    wechatError = "";
    wechatAccounts = [];
    wechatSearched = false;
    wechatSearching = false;
    wechatResolving = false;
    wechatDialogOpen = true;
    await tick();
    wechatInputEl?.focus();
  }

  function closeWechatDialog() {
    wechatSearchRequest++;
    wechatDialogOpen = false;
    wechatQuery = "";
    wechatError = "";
    wechatAccounts = [];
    wechatSearched = false;
    wechatSearching = false;
    wechatResolving = false;
  }

  async function runWechatSearch() {
    const query = wechatQuery.trim();
    if (!query) {
      wechatError = t("feeds.wechatEmpty");
      return;
    }

    const requestId = ++wechatSearchRequest;
    wechatSearching = true;
    wechatError = "";
    wechatSearched = false;
    try {
      const accounts = await searchWechatAccounts(query);
      if (requestId !== wechatSearchRequest) return;
      wechatAccounts = accounts;
      wechatSearched = true;
    } catch (e) {
      if (requestId !== wechatSearchRequest) return;
      wechatAccounts = [];
      wechatSearched = true;
      wechatError = e instanceof Error ? e.message : t("feeds.loadFailed");
    } finally {
      if (requestId === wechatSearchRequest) wechatSearching = false;
    }
  }

  async function selectWechatAccount(account: WechatAccount) {
    if (wechatResolving) return;
    wechatResolving = true;
    wechatError = "";
    try {
      const resolved = account.rss_url
        ? {
            title: account.nickname,
            url: account.rss_url,
            description: account.alias.trim() || null,
          }
        : await resolveWechatFeed({
            fakeid: account.fakeid,
            nickname: account.nickname,
            alias: account.alias,
            head_img: account.round_head_img,
          });

      resetForm();
      title = resolved.title;
      url = resolved.url;
      description = resolved.description ?? "";
      titleTouched = true;
      descriptionTouched = Boolean(resolved.description);
      closeWechatDialog();
      void runPreview(url);
    } catch (e) {
      wechatError =
        e instanceof Error ? e.message : t("feeds.wechatResolveFailed");
    } finally {
      wechatResolving = false;
    }
  }

  function isValidFeedUrl(value: string): boolean {
    return isHttpUrl(value.trim());
  }

  function cancelPreview() {
    previewRequest++;
    previewing = false;
    clearTimeout(previewTimer);
  }

  async function runPreview(feedUrl: string) {
    const trimmed = feedUrl.trim();
    if (!isValidFeedUrl(trimmed)) {
      cancelPreview();
      return;
    }

    const requestId = ++previewRequest;
    previewing = true;
    previewError = "";
    try {
      const res = await previewFeed(trimmed);
      if (requestId !== previewRequest) return;
      if (!titleTouched && res.data.title) title = res.data.title;
      if (!descriptionTouched && res.data.description)
        description = res.data.description;
    } catch (e) {
      if (requestId !== previewRequest) return;
      previewError = e instanceof Error ? e.message : t("feeds.parseFailed");
    } finally {
      if (requestId === previewRequest) previewing = false;
    }
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewError = "";
    const feedUrl = url.trim();
    if (!isValidFeedUrl(feedUrl)) {
      cancelPreview();
      return;
    }
    previewTimer = setTimeout(() => void runPreview(feedUrl), 600);
  }

  function onUrlInput() {
    schedulePreview();
  }

  function onUrlBlur() {
    clearTimeout(previewTimer);
    const feedUrl = url.trim();
    if (!isValidFeedUrl(feedUrl)) {
      cancelPreview();
      return;
    }
    void runPreview(feedUrl);
  }

  async function loadFeeds(append = false) {
    listError = "";
    if (append) {
      if (loadingMore || !hasMore) return;
      loadingMore = true;
    } else {
      loading = true;
      cursor = null;
      hasMore = true;
    }

    try {
      const page = await fetchFeedsPage(
        append ? (cursor ?? undefined) : undefined,
        PAGE_SIZE,
        undefined,
        sort,
      );
      feeds = append ? [...feeds, ...page.data] : page.data;
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    } catch (e) {
      listError = e instanceof Error ? e.message : t("feeds.loadFailed");
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function loadMore() {
    await loadFeeds(true);
  }

  $effect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  function resetForm() {
    editId = null;
    title = "";
    url = "";
    description = "";
    formError = "";
    previewError = "";
    titleTouched = false;
    descriptionTouched = false;
    cancelPreview();
  }

  function startEdit(feed: Feed) {
    editId = feed.id;
    title = feed.title;
    url = feed.url;
    description = feed.description ?? "";
    formError = "";
    previewError = "";
    titleTouched = true;
    descriptionTouched = true;
    cancelPreview();
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    formError = "";

    try {
      if (editId !== null) {
        await updateFeed(editId, {
          title: title.trim(),
          url: url.trim(),
          description: description.trim() || null,
        });
      } else {
        await createFeed({
          title: title.trim(),
          url: url.trim(),
          description: description.trim() || null,
        });
      }
      resetForm();
      loading = true;
      await loadFeeds();
    } catch (err) {
      formError = err instanceof Error ? err.message : t("feeds.saveFailed");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm(t("feeds.confirmDelete"))) return;
    listError = "";
    try {
      await deleteFeed(id);
      if (editId === id) resetForm();
      loading = true;
      await loadFeeds();
    } catch (e) {
      listError = e instanceof Error ? e.message : t("feeds.deleteFailed");
    }
  }

  async function setSort(next: FeedSort) {
    if (next === sort) return;
    sort = next;
    loading = true;
    await loadFeeds();
  }

  async function handleExportOpml() {
    if (exportingOpml) return;
    listError = "";
    exportingOpml = true;
    try {
      await downloadFeedsOpml();
    } catch (e) {
      listError = e instanceof Error ? e.message : t("feeds.exportOpmlFailed");
    } finally {
      exportingOpml = false;
    }
  }

  onMount(() => {
    void loadFeeds();
    const timer = setInterval(() => {
      now = Date.now();
    }, 60_000);
    return () => clearInterval(timer);
  });
</script>

<section class="mb-10">
  <form class="space-y-3" onsubmit={handleSubmit}>
    <input
      type="text"
      bind:value={title}
      oninput={() => (titleTouched = true)}
      required
      placeholder={t("feeds.name")}
      class="w-full border-0 border-b border-neutral-200 bg-transparent py-2 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-900 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-100"
    />
    <input
      type="url"
      bind:value={url}
      oninput={onUrlInput}
      onblur={onUrlBlur}
      required
      readonly={isEditing}
      placeholder="https://example.com/feed.xml"
      class="w-full border-0 border-b border-neutral-200 bg-transparent py-2 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-900 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-100"
      class:cursor-not-allowed={isEditing}
      class:text-neutral-400={isEditing}
      class:dark:text-neutral-500={isEditing}
    />
    <input
      type="text"
      bind:value={description}
      oninput={() => (descriptionTouched = true)}
      placeholder={t("feeds.descriptionOptional")}
      class="w-full border-0 border-b border-neutral-200 bg-transparent py-2 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-900 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-100"
    />
    <div class="flex gap-4 pt-2">
      <button
        type="submit"
        class="text-sm text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
      >
        {isEditing ? t("feeds.save") : t("feeds.addFeed")}
      </button>
      {#if !isEditing}
        <button
          type="button"
          class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          onclick={openKeywordDialog}
        >
          {t("feeds.keyword")}
        </button>
        <button
          type="button"
          class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          onclick={() => void openWechatDialog()}
        >
          {t("feeds.wechat")}
        </button>
      {/if}
      {#if isEditing}
        <button
          type="button"
          class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          onclick={resetForm}
        >
          {t("feeds.cancel")}
        </button>
      {/if}
    </div>
  </form>
  {#if previewing}
    <p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">
      {t("feeds.parsing")}
    </p>
  {:else if previewError}
    <p class="mt-3 text-sm text-amber-600 dark:text-amber-500">
      {previewError}
    </p>
  {/if}
  {#if formError}
    <p class="mt-3 text-sm text-red-500">{formError}</p>
  {/if}
</section>

{#if keywordDialogOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeKeywordDialog();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") closeKeywordDialog();
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyword-dialog-title"
      class="w-full max-w-sm border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
      tabindex="-1"
    >
      <h3
        id="keyword-dialog-title"
        class="text-sm font-medium text-neutral-900 dark:text-neutral-100"
      >
        {t("feeds.keywordTitle")}
      </h3>
      <form
        class="mt-4 space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          applyKeywordFeed();
        }}
      >
        <input
          bind:this={keywordInputEl}
          type="text"
          bind:value={keywordInput}
          placeholder={t("feeds.keywordPlaceholder")}
          class="w-full border-0 border-b border-neutral-200 bg-transparent py-2 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-900 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-100"
        />
        {#if keywordError}
          <p class="text-sm text-red-500">{keywordError}</p>
        {/if}
        <div class="flex gap-4">
          <button
            type="submit"
            class="text-sm text-neutral-900 underline-offset-4 hover:underline dark:text-neutral-100"
          >
            {t("feeds.keywordConfirm")}
          </button>
          <button
            type="button"
            class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            onclick={closeKeywordDialog}
          >
            {t("feeds.cancel")}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if wechatDialogOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget && !wechatResolving) closeWechatDialog();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape" && !wechatResolving) closeWechatDialog();
    }}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="wechat-dialog-title"
      class="flex max-h-[80vh] w-full max-w-md flex-col border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
      tabindex="-1"
    >
      <h3
        id="wechat-dialog-title"
        class="text-sm font-medium text-neutral-900 dark:text-neutral-100"
      >
        {t("feeds.wechatTitle")}
      </h3>
      <form
        class="mt-4 flex gap-3"
        onsubmit={(e) => {
          e.preventDefault();
          void runWechatSearch();
        }}
      >
        <input
          bind:this={wechatInputEl}
          type="text"
          bind:value={wechatQuery}
          disabled={wechatSearching || wechatResolving}
          placeholder={t("feeds.wechatPlaceholder")}
          class="min-w-0 flex-1 border-0 border-b border-neutral-200 bg-transparent py-2 text-sm outline-none placeholder:text-neutral-300 focus:border-neutral-900 disabled:opacity-60 dark:border-neutral-700 dark:placeholder:text-neutral-600 dark:focus:border-neutral-100"
        />
        <button
          type="submit"
          disabled={wechatSearching || wechatResolving}
          class="shrink-0 text-sm text-neutral-900 underline-offset-4 hover:underline disabled:opacity-50 dark:text-neutral-100"
        >
          {wechatSearching ? t("feeds.wechatSearching") : t("feeds.wechatSearch")}
        </button>
      </form>
      {#if wechatError}
        <p class="mt-3 text-sm text-red-500">{wechatError}</p>
      {:else if wechatResolving}
        <p class="mt-3 text-sm text-neutral-400 dark:text-neutral-500">
          {t("feeds.wechatResolving")}
        </p>
      {/if}
      <div class="mt-4 min-h-0 flex-1 overflow-y-auto">
        {#if wechatSearching}
          <p class="py-6 text-center text-sm text-neutral-300 dark:text-neutral-600">
            {t("feeds.wechatSearching")}
          </p>
        {:else if wechatSearched && wechatAccounts.length === 0 && !wechatError}
          <p class="py-6 text-center text-sm text-neutral-300 dark:text-neutral-600">
            {t("feeds.wechatNoResults")}
          </p>
        {:else if wechatAccounts.length > 0}
          <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
            {#each wechatAccounts as account (account.fakeid)}
              <li>
                <button
                  type="button"
                  disabled={wechatResolving || account.subscribed}
                  class="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800/60"
                  onclick={() => void selectWechatAccount(account)}
                >
                  {#if account.round_head_img}
                    <img
                      src={account.round_head_img}
                      alt=""
                      class="h-9 w-9 shrink-0 rounded-full bg-neutral-100 object-cover dark:bg-neutral-800"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                    />
                  {:else}
                    <div
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500"
                      aria-hidden="true"
                    >
                      {account.nickname.slice(0, 1) || "?"}
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {account.nickname}
                    </p>
                    <p class="truncate text-xs text-neutral-400 dark:text-neutral-500">
                      {account.alias || account.fakeid}
                    </p>
                  </div>
                  <span
                    class="shrink-0 text-xs {account.subscribed
                      ? 'text-neutral-500 dark:text-neutral-400'
                      : 'text-neutral-300 dark:text-neutral-600'}"
                  >
                    {account.subscribed
                      ? t("feeds.wechatSubscribed")
                      : t("feeds.wechatNotSubscribed")}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="mt-4 flex gap-4">
        <button
          type="button"
          class="text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          disabled={wechatResolving}
          onclick={closeWechatDialog}
        >
          {t("feeds.cancel")}
        </button>
      </div>
    </div>
  </div>
{/if}

<section>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h2
      class="text-xs uppercase tracking-widest text-neutral-400 dark:text-neutral-500"
    >
      {t("feeds.feedList")}
    </h2>
    <div class="flex flex-wrap items-center gap-3 text-xs">
      <button
        type="button"
        class="inline-flex items-center gap-1 text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-50 dark:hover:text-neutral-300"
        disabled={exportingOpml}
        aria-label={t("feeds.exportOpml")}
        title={t("feeds.exportOpml")}
        onclick={() => void handleExportOpml()}
      >
        <Download {...iconProps} />
        {exportingOpml ? t("feeds.exportingOpml") : t("feeds.exportOpml")}
      </button>
      <div
        class="flex gap-3"
        role="group"
        aria-label={t("feeds.sortBy")}
      >
      <button
        type="button"
        class="transition-colors {sort === 'updated_desc'
          ? 'text-neutral-900 dark:text-neutral-100'
          : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}"
        aria-pressed={sort === "updated_desc"}
        onclick={() => setSort("updated_desc")}
      >
        {t("feeds.sortDefault")}
      </button>
      <button
        type="button"
        class="transition-colors {sort === 'published_desc'
          ? 'text-neutral-900 dark:text-neutral-100'
          : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300'}"
        aria-pressed={sort === "published_desc"}
        onclick={() => setSort("published_desc")}
      >
        {t("feeds.sortByPublished")}
      </button>
      </div>
    </div>
  </div>
  {#if listError}
    <p class="text-sm text-red-500">{listError}</p>
  {:else if loading}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("items.loading")}</p>
  {:else if feeds.length === 0}
    <p class="text-sm text-neutral-300 dark:text-neutral-600">{t("feeds.noFeeds")}</p>
  {:else}
    <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
      {#each feeds as feed (feed.id)}
        <li class="group grid w-full grid-cols-[1fr_auto] gap-x-4 gap-y-2 py-5">
            <p class="min-w-0 text-sm font-medium">{feed.title}</p>
            <div class="relative flex shrink-0 items-center">
              <div
                class="absolute right-full mr-2 flex gap-1 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 dark:text-neutral-500"
              >
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center justify-center rounded-md p-1 hover:text-neutral-900 dark:hover:text-neutral-100"
                  aria-label={t("feeds.edit")}
                  title={t("feeds.edit")}
                  onclick={() => startEdit(feed)}
                >
                  <Pencil {...iconProps} />
                </button>
                <button
                  type="button"
                  class="inline-flex cursor-pointer items-center justify-center rounded-md p-1 hover:text-red-500"
                  aria-label={t("feeds.delete")}
                  title={t("feeds.delete")}
                  onclick={() => handleDelete(feed.id)}
                >
                  <Trash2 {...iconProps} />
                </button>
              </div>
              <time
                datetime={feed.last_published_at ?? undefined}
                class="text-xs text-neutral-400 dark:text-neutral-500"
                title={t("feeds.lastPublished")}
              >
                {#if feed.last_published_at}
                  {formatTime(feed.last_published_at, now)}
                {:else}
                  {t("feeds.noPublished")}
                {/if}
              </time>
            </div>
            <a
              href={safeHref(feed.url)}
              target="_blank"
              rel="noopener noreferrer"
              class="col-span-2 min-w-0 w-full truncate text-sm text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            >
              {feed.url}
            </a>
            {#if feed.description}
              <p
                class="col-span-2 text-sm text-neutral-400 dark:text-neutral-500"
              >
                {feed.description}
              </p>
            {/if}
        </li>
      {/each}
    </ul>
    {#if loadingMore}
      <p class="py-8 text-center text-sm text-neutral-300 dark:text-neutral-600">
        {t("feeds.loading")}
      </p>
    {:else if !hasMore && feeds.length > 0}
      <p class="py-8 text-center text-sm text-neutral-300 dark:text-neutral-600">
        {t("feeds.noMore")}
      </p>
    {/if}
    <div bind:this={sentinel} class="h-1" aria-hidden="true"></div>
  {/if}
</section>
