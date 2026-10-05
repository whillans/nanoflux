import {
  asc,
  desc,
  eq,
  gt,
  isNull,
  like,
  lt,
  and,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./database";
import { feeds, type Feed, DEFAULT_LIMIT, MAX_LIMIT } from "./schema";
import { decodeCursor, parseFeedId } from "./utils";

export type FeedSort = "updated_desc" | "published_desc" | "published_asc";

const PUBLISHED_NULL_DESC = "1970-01-01T00:00:00.000Z";
const PUBLISHED_NULL_ASC = "9999-12-31T23:59:59.999Z";

const publishedSortKeyDesc = sql`COALESCE(${feeds.last_published_at}, ${PUBLISHED_NULL_DESC})`;
const publishedSortKeyAsc = sql`COALESCE(${feeds.last_published_at}, ${PUBLISHED_NULL_ASC})`;

export function feedCursorSortTime(
  feed: Feed,
  sort: FeedSort = "updated_desc",
): string {
  switch (sort) {
    case "published_desc":
      return feed.last_published_at ?? PUBLISHED_NULL_DESC;
    case "published_asc":
      return feed.last_published_at ?? PUBLISHED_NULL_ASC;
    default:
      return feed.updated_at;
  }
}

export function getFeeds(
  options?: {
    cursor?: string;
    limit?: number;
    keyword?: string;
    sort?: FeedSort;
  },
): Feed[] {
  try {
    const sort = options?.sort ?? "updated_desc";

    const decoded = options?.cursor ? decodeCursor(options.cursor) : null;
    if (options?.cursor && !decoded) {
      throw new Error(`Invalid cursor: ${options.cursor}`);
    }
    const cursorId = decoded ? parseFeedId(decoded.id) : null;
    if (decoded && cursorId === null) {
      throw new Error(`Invalid cursor: ${options?.cursor}`);
    }

    let cursorFilter;
    if (decoded) {
      if (sort === "published_asc") {
        cursorFilter = or(
          gt(publishedSortKeyAsc, decoded.sortTime),
          and(
            eq(publishedSortKeyAsc, decoded.sortTime),
            gt(feeds.id, cursorId!),
          ),
        );
      } else if (sort === "published_desc") {
        cursorFilter = or(
          lt(publishedSortKeyDesc, decoded.sortTime),
          and(
            eq(publishedSortKeyDesc, decoded.sortTime),
            lt(feeds.id, cursorId!),
          ),
        );
      } else {
        cursorFilter = or(
          lt(feeds.updated_at, decoded.sortTime),
          and(
            eq(feeds.updated_at, decoded.sortTime),
            lt(feeds.id, cursorId!),
          ),
        );
      }
    }

    const adjustedLimit = Math.min(
      Math.max(options?.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const keyword = options?.keyword?.trim();

    const feedFilter = keyword
      ? like(feeds.title, `%${keyword}%`)
      : undefined;

    const orderBy =
      sort === "published_asc"
        ? [asc(publishedSortKeyAsc), asc(feeds.id)]
        : sort === "published_desc"
          ? [desc(publishedSortKeyDesc), desc(feeds.id)]
          : [desc(feeds.updated_at), desc(feeds.id)];

    const selected = db
      .select()
      .from(feeds)
      .where(and(cursorFilter, feedFilter))
      .orderBy(...orderBy)
      .limit(adjustedLimit + 1)
      .all();

    return selected;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get feeds: ${detail}`);
  }
}

export function getAllFeeds(): Feed[] {
  try {
    return db
      .select()
      .from(feeds)
      .orderBy(asc(feeds.title), asc(feeds.id))
      .all();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get all feeds: ${detail}`);
  }
}

export function getFeed(id: number): Feed | null {

  try {

    const selected = db.select()
    .from(feeds)
    .where(eq(feeds.id, id))
    .get()

    if (!selected) {
      return null;
    }

    return selected;

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get feed: ${detail}`);
  }
}

export function getFeedByUrl(url: string): Feed | null {
  try {
    return db.select().from(feeds).where(eq(feeds.url, url)).get() ?? null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get feed: ${detail}`);
  }
}

export function createFeed(
  input: {
    title: string;
    url: string;
    description?: string | null;
  }
): Feed {

  try {

    const existing = getFeedByUrl(input.url);
    if (existing) {
      return existing;
    }

    const created = db.insert(feeds)
      .values({
        title: input.title,
        url: input.url,
        description: input.description ?? null,
      })
      .returning()
      .get();

    if (!created) {
      throw new Error("Failed to create feed");
    }

    return created;
      
  } catch (error) {
    const existing = getFeedByUrl(input.url);
    if (existing) {
      return existing;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create feed: ${detail}`);
  }
}

export function updateFeed(
  id: number,
  input: {
    title?: string;
    url?: string;
    description?: string | null;
  },
): Feed {

  try {

    const existing = getFeed(id);

    if (!existing) {
      throw new Error("Feed does not exist");
    }

    const title = input.title ?? existing.title;
    const description =
      input.description !== undefined ? input.description : existing.description;

    const updated = db.update(feeds)
      .set({
        title,
        description,
        updated_at: sql`datetime('now')`,
      })
      .where(eq(feeds.id, id))
      .returning()
      .get();

    return updated;

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update feed: ${detail}`);
  }
}

export function deleteFeed(id: number): boolean {

  try {

    const existing = getFeed(id);

    if (!existing) {
      throw new Error("Feed does not exist");
    }

    db.delete(feeds)
    .where(eq(feeds.id, id))
    .run();

    return true;

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete feed: ${detail}`);
  }
}


// About fetching

export function getDueFeeds(): Feed[] {

  try {

    const selected = db
      .select()
      .from(feeds)
      .where(
        or(
          isNull(feeds.next_fetched_at),
          sql`datetime(${feeds.next_fetched_at}) <= datetime('now')`,
        ),
      )
      .orderBy(sql`COALESCE(${feeds.next_fetched_at}, '1970-01-01')`)
      .all();

    return selected;

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get due feeds: ${detail}`);
  }
}

export function updateFeedFetchState(
  id: number,
  input: {
    next_fetched_at: string;
    fetch_interval_min: number;
    last_published_at?: string;
    last_build_date?: string | null;
    last_guids?: string;
    http_etag?: string | null;
    http_last_modified?: string | null;
  },
): void {

  try {

    db.update(feeds)
      .set({
        next_fetched_at: input.next_fetched_at,
        fetch_interval_min: input.fetch_interval_min,
        fetch_failures: 0,
        last_error: null,
        ...(input.last_published_at !== undefined
          ? { last_published_at: input.last_published_at }
          : {}),
        ...(input.last_build_date !== undefined
          ? { last_build_date: input.last_build_date }
          : {}),
        ...(input.last_guids !== undefined
          ? { last_guids: input.last_guids }
          : {}),
        ...(input.http_etag !== undefined
          ? { http_etag: input.http_etag }
          : {}),
        ...(input.http_last_modified !== undefined
          ? { http_last_modified: input.http_last_modified }
          : {}),
      })
      .where(eq(feeds.id, id))
    .run();

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to update feed fetch state: ${detail}`);
  }
}

/** Push a failed feed back in the queue so it cannot hold the head of `getDueFeeds`. */
export function recordFeedFetchFailure(
  id: number,
  input: {
    next_fetched_at: string;
    fetch_failures: number;
    last_error: string;
  },
): void {
  try {
    db.update(feeds)
      .set(input)
      .where(eq(feeds.id, id))
      .run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to record feed fetch failure: ${detail}`);
  }
}

