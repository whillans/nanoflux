import Parser from "rss-parser";
import { getExistingGuids, sourceFromLink } from "../../db/items";
import {
  getDueFeeds,
  recordFeedFetchFailure,
  updateFeedFetchState,
} from "../../db/feeds";
import type { Feed } from "../../db/schema";
import { parseFeedGuids, serializeFeedGuids } from "../../db/utils";
import { maxPublishedAt, parsePublishedAt } from "../../utils/date";
import { isHttpUrl } from "../../shared/url";
import { isMd5Format, md5Hex } from "../../utils/hash";
import { stripHtml } from "../../utils/html";
import { enrichItemsContent, resolveItemLinks } from "../content/extractor";
import { addItemsWithDedup } from "../dedup";
import { filterItems, partitionByRules } from "../filters";
import { isGoogleNewsArticleUrl } from "../google-news";
import { translateItemTitles } from "../translate";
import { fetchRssFeed, fetchRssFeedConditional } from "../rss";
import { pickCoverFromRss } from "./cover";
import {
  DEFAULT_FETCH_INTERVAL_MIN,
  failureBackoffMin,
  nextFetchedAtIso,
  nextFetchIntervalMin,
} from "./interval";

type RssItemFields = {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  image?: unknown;
  /** Raw `<source url="…">` elements; rss-parser flattens `source` to its text. */
  sourceElement?: unknown;
};

const rssParser = new Parser<Record<string, unknown>, RssItemFields>({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
      "image",
      ["source", "sourceElement", { keepArray: true }],
    ],
  },
});

function sourceElementUrl(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const url = value[0]?.$?.url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * Publisher domain of an entry. A Google News link only points at Google, but
 * its `<source url>` names the publisher, so rules can run before resolution.
 */
function entrySource(entry: RssItemFields, link: string): string {
  if (isGoogleNewsArticleUrl(link)) {
    const url = sourceElementUrl(entry.sourceElement);
    if (url) return sourceFromLink(url);
  }
  return sourceFromLink(link);
}

/** Keep each tick finite when many feeds are overdue or a feed has a large backlog. */
const MAX_FEEDS_PER_TICK = 3;
const MAX_NEW_ITEMS_PER_FEED = 10;
const CATCH_UP_INTERVAL_MIN = 1;

const inFlightFeedIds = new Set<number>();
let dueFetchRunning = false;

function toStoredItem(entry: Parser.Item & RssItemFields) {
  const link = entry.link?.trim();
  // The link is rendered as an `href`, so `javascript:` and the like are dropped.
  if (!link || !isHttpUrl(link)) return null;

  const rawGuid = entry.guid?.trim() || link;
  const guid = isMd5Format(rawGuid) ? rawGuid : md5Hex(link);
  const title = entry.title?.trim() || link;

  const description =
    entry.contentSnippet?.trim() ||
    entry.summary?.trim() ||
    (entry.content ? stripHtml(entry.content) : "") ||
    null;

  const published_at =
    parsePublishedAt(entry.isoDate) ||
    parsePublishedAt(entry.pubDate) ||
    new Date().toISOString();

  return {
    guid,
    title,
    link,
    content: description && description != title ? description : null,
    cover: pickCoverFromRss(entry, link),
    published_at,
    source: entrySource(entry, link),
  };
}

function feedBuildDate(parsed: {
  pubDate?: unknown;
  lastBuildDate?: unknown;
}): string | null {
  const pubDate =
    typeof parsed.pubDate === "string" ? parsed.pubDate : undefined;
  const lastBuildDate =
    typeof parsed.lastBuildDate === "string"
      ? parsed.lastBuildDate
      : undefined;
  return parsePublishedAt(pubDate) || parsePublishedAt(lastBuildDate);
}

export async function fetchFeedMetadata(url: string): Promise<{
  title: string;
  description: string | null;
}> {
  try {
    const feed = await fetchRssFeed(url, rssParser);

    const title = feed.title?.trim() || "";
    const raw =
      feed.description?.trim() ||
      feed.itunes?.summary?.trim() ||
      null;
    const description = raw ? stripHtml(raw).slice(0, 500) || null : null;

    return { title, description };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to fetch feed metadata: ${message}`);
  }
}

export async function fetchFeed(feed: Feed): Promise<{
  newItems: any[];
  error?: string;
}> {
  if (inFlightFeedIds.has(feed.id)) {
    return { newItems: [] };
  }
  inFlightFeedIds.add(feed.id);

  const currentInterval =
    feed.fetch_interval_min || DEFAULT_FETCH_INTERVAL_MIN;

  try {
    const result = await fetchRssFeedConditional(feed.url, rssParser, {
      etag: feed.http_etag,
      lastModified: feed.http_last_modified,
    });
    if (result.notModified) {
      const nextInterval = nextFetchIntervalMin(currentInterval, 0, []);
      updateFeedFetchState(feed.id, {
        next_fetched_at: nextFetchedAtIso(nextInterval),
        fetch_interval_min: nextInterval,
        http_etag: result.validators.etag,
        http_last_modified: result.validators.lastModified,
      });
      return { newItems: [] };
    }

    const parsed = result.feed;
    const rawItems = parsed.items ?? [];
    const entries = rawItems
      .map(toStoredItem)
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const knownGuids = parseFeedGuids(feed.last_guids);
    const globalGuids = getExistingGuids(entries.map((entry) => entry.guid));
    const candidates = entries.filter(
      (entry) => !knownGuids.has(entry.guid) && !globalGuids.has(entry.guid),
    );
    const batch = candidates.slice(0, MAX_NEW_ITEMS_PER_FEED);
    const remaining = candidates.length - batch.length;
    const unprocessed = new Set(candidates.slice(MAX_NEW_ITEMS_PER_FEED).map((entry) => entry.guid));
    // Source and keyword rules run before any network work, so rejected items
    // are never resolved or scraped. A resolved link can show a different
    // domain than the `<source>` hint, so resolved items are screened again.
    const [earlyRejected, screened] = partitionByRules(batch);
    const resolved = (await resolveItemLinks(screened)).map((item) => ({
      ...item,
      source: sourceFromLink(item.link),
    }));
    const [lateRejected, kept] = partitionByRules(resolved);
    const ruleRejected = earlyRejected.length + lateRejected.length;
    if (ruleRejected > 0) {
      console.log(
        `[filter] ${feed.title}: rules rejected ${ruleRejected}/${batch.length} before scraping`,
      );
    }
    const enriched = await enrichItemsContent(kept);
    const filtered = [
      ...earlyRejected,
      ...lateRejected,
      ...(await filterItems(enriched)),
    ];
    const translated = await translateItemTitles(filtered);
    const inserted = await addItemsWithDedup(feed.id, translated);

    const nextInterval =
      remaining > 0
        ? CATCH_UP_INTERVAL_MIN
        : nextFetchIntervalMin(currentInterval, inserted.length, rawItems);
    let lastPublishedAt = maxPublishedAt(entries);
    if (lastPublishedAt && feed.last_published_at) {
      const next = Date.parse(lastPublishedAt);
      const prev = Date.parse(feed.last_published_at);
      if (!Number.isNaN(prev) && (Number.isNaN(next) || prev > next)) {
        lastPublishedAt = feed.last_published_at;
      }
    }
    updateFeedFetchState(feed.id, {
      next_fetched_at: nextFetchedAtIso(nextInterval),
      fetch_interval_min:
        remaining > 0 ? currentInterval : nextInterval,
      ...(lastPublishedAt ? { last_published_at: lastPublishedAt } : {}),
      last_build_date: feedBuildDate(parsed),
      last_guids: serializeFeedGuids(
        entries
          .filter((entry) => !unprocessed.has(entry.guid))
          .map((entry) => entry.guid),
      ),
      // A backlog must be re-read in full next time, so skip validators until
      // it is drained; otherwise the server answers 304 and drops the rest.
      http_etag: remaining > 0 ? null : result.validators.etag,
      http_last_modified:
        remaining > 0 ? null : result.validators.lastModified,
    });

    if (remaining > 0) {
      console.log(
        `[fetch] ${feed.title}: processed ${batch.length}, ${remaining} more queued`,
      );
    }

    return { newItems: inserted };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const failures = (feed.fetch_failures ?? 0) + 1;
    const backoffMin = failureBackoffMin(failures);
    try {
      recordFeedFetchFailure(feed.id, {
        next_fetched_at: nextFetchedAtIso(backoffMin),
        fetch_failures: failures,
        last_error: message.slice(0, 500),
      });
    } catch (recordError) {
      console.error("[fetch]", recordError);
    }
    return {
      newItems: [],
      error: `${feed.title}: ${message} (failures=${failures}, retry in ${backoffMin}m)`,
    };
  } finally {
    inFlightFeedIds.delete(feed.id);
  }
}

/** Fetch a newly created feed without waiting for the next cron tick. */
export function enqueueNewFeedFetch(feed: Feed): void {
  if (feed.next_fetched_at) return;

  void fetchFeed(feed)
    .then((result) => {
      console.log(
        `[fetch:create] ${feed.title} new=${result.newItems.length}`,
      );
      if (result.error) console.error(`[fetch:create] ${result.error}`);
    })
    .catch((error) => {
      console.error("[fetch:create]", error);
    });
}

export async function fetchDueFeeds(label: string): Promise<{
  feeds: number;
  newItems: number;
  errors: string[];
}> {
  if (dueFetchRunning) {
    console.log(`[fetch:${label}] skipped (already running)`);
    return { feeds: 0, newItems: 0, errors: [] };
  }
  dueFetchRunning = true;

  const started = Date.now();
  try {
    const due = getDueFeeds();
    const feeds = due.slice(0, MAX_FEEDS_PER_TICK);
    console.log(
      `[fetch:${label}] due=${due.length} taking=${feeds.length}`,
    );

    let newItemsCount = 0;
    const errors: string[] = [];

    for (const [index, feed] of feeds.entries()) {
      console.log(
        `[fetch:${label}] ${index + 1}/${feeds.length} ${feed.title}`,
      );
      const result = await fetchFeed(feed);
      newItemsCount += result.newItems.length;
      if (result.error) errors.push(result.error);
    }

    const result = {
      feeds: feeds.length,
      newItems: newItemsCount,
      errors,
    };

    console.log(
      `[fetch:${label}] done feeds=${result.feeds} new=${result.newItems} ${Date.now() - started}ms`,
    );

    for (const error of result.errors) {
      console.error(`[fetch:${label}] ${error}`);
    }

    return result;
  } finally {
    dueFetchRunning = false;
  }
}
