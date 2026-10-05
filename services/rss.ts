import Parser from "rss-parser";
import { publicHttpGet, readBodyLimited } from "./http-fetcher";

const RSS_USER_AGENT = "NanoFlux/1.0 (+https://github.com/nanoflux)";
const RSS_TIMEOUT_MS = 15_000;
const MAX_FEED_BYTES = 10 * 1024 * 1024;

/** HTTP cache validators from the last successful fetch of a feed. */
export type FeedValidators = {
  etag: string | null;
  lastModified: string | null;
};

export type ConditionalFeedResult<T> =
  | { notModified: true; validators: FeedValidators }
  | { notModified: false; feed: T; validators: FeedValidators };

/**
 * Fetch and parse a feed, sending If-None-Match / If-Modified-Since when
 * `validators` are given. A 304 returns `notModified` without a body.
 */
export async function fetchRssFeedConditional<
  TFeed extends Record<string, unknown> = Record<string, unknown>,
  TItem extends Record<string, unknown> = Record<string, unknown>,
>(
  url: string,
  parser: Parser<TFeed, TItem> = new Parser<TFeed, TItem>(),
  validators?: FeedValidators,
): Promise<ConditionalFeedResult<Parser.Output<TFeed & TItem>>> {
  const headers: Record<string, string> = { "User-Agent": RSS_USER_AGENT };
  if (validators?.etag) headers["If-None-Match"] = validators.etag;
  if (validators?.lastModified) {
    headers["If-Modified-Since"] = validators.lastModified;
  }

  const response = await publicHttpGet(url, {
    headers,
    signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
  });

  if (response.status === 304 && validators) {
    await response.body?.cancel().catch(() => {});
    return {
      notModified: true,
      validators: {
        etag: response.headers.get("etag") ?? validators.etag,
        lastModified:
          response.headers.get("last-modified") ?? validators.lastModified,
      },
    };
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = await readBodyLimited(response, MAX_FEED_BYTES);
  const feed = await parser.parseString(new TextDecoder().decode(bytes));
  return {
    notModified: false,
    feed,
    validators: {
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    },
  };
}

export async function fetchRssFeed<
  TFeed extends Record<string, unknown> = Record<string, unknown>,
  TItem extends Record<string, unknown> = Record<string, unknown>,
>(
  url: string,
  parser: Parser<TFeed, TItem> = new Parser<TFeed, TItem>(),
): Promise<Parser.Output<TFeed & TItem>> {
  const result = await fetchRssFeedConditional(url, parser);
  if (result.notModified) {
    throw new Error("Unexpected 304 for an unconditional request");
  }
  return result.feed;
}
