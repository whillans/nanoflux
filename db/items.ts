import {
  asc,
  and,
  desc,
  eq,
  gte,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core";
import { db } from "./database";
import { getFeed } from "./feeds";
import { feeds, items, meta, DEFAULT_LIMIT, MAX_LIMIT } from "./schema";
import { newItemId, decodeCursor, parseItemId, parseTimeRange, TimeUnit, toUtcIso } from "./utils";
import { titleTokens, TITLE_TOKENS_VERSION } from "../utils/text";
import { md5Hex } from "../utils/hash";
import { getTokenizerState } from "../config";

const COMMON_SECOND_LEVEL_SUFFIXES = new Set([
  "ac", "co", "com", "edu", "firm", "gen", "go", "gob", "gov", "ind",
  "mil", "net", "ne", "nom", "or", "org", "sch",
]);

/** Return the registrable-looking domain used as an item's source. */
export function sourceFromLink(link: string): string {
  try {
    const hostname = new URL(link).hostname.toLowerCase().replace(/^www\./, "");
    if (!hostname || hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
      return hostname;
    }

    const labels = hostname.split(".");
    if (
      labels.length > 2 &&
      labels.at(-1)!.length === 2 &&
      COMMON_SECOND_LEVEL_SUFFIXES.has(labels.at(-2)!)
    ) {
      return labels.slice(-3).join(".");
    }
    return labels.length > 2 ? labels.slice(-2).join(".") : hostname;
  } catch {
    return "";
  }
}

type ItemQueryOptions = {
  since?: string;
  until?: string;
  unit?: string;
  count?: number;
  isRead?: number;
  status?: "passed" | "rejected" | "deleted";
  cursor?: string;
  limit?: number;
  /** Return only the first `contentChars` characters of content; full content when omitted. */
  contentChars?: number;
};

export function getItems(options?: ItemQueryOptions): any[] {

  try {

    const decoded = options?.cursor ? decodeCursor(options.cursor) : null;
    if (options?.cursor && !decoded) {
      throw new Error(`Invalid cursor: ${options.cursor}`);
    }
    const cursorId = decoded ? parseItemId(decoded.id) : null;
    if (decoded && cursorId === null) {
      throw new Error(`Invalid cursor: ${options?.cursor}`);
    }

    const adjustedLimit = Math.min(
      Math.max(options?.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const relativeRange =
      options?.unit && options?.count
        ? parseTimeRange(options.unit, options.count)
        : undefined;
    const since = options?.since ?? relativeRange?.since;
    const until = options?.until ?? relativeRange?.until;
    const timeFilter =
      since || until
        ? and(
            since ? gte(items.published_at, since) : undefined,
            until ? lte(items.published_at, until) : undefined,
          )
        : undefined;

    const cursorFilter = decoded
      ? or(
          lt(items.published_at, decoded.sortTime),
          and(eq(items.published_at, decoded.sortTime), lt(items.id, cursorId!)),
        )
      : undefined;

    const readFilter =
      options?.isRead === 0 || options?.isRead === 1
        ? eq(items.is_read, options.isRead)
        : undefined;
    const statusFilter = eq(items.status, options?.status ?? "passed");

    const selected = db
      .select({
        id: items.id,
        feed_id: items.feed_id,
        guid: items.guid,
        title: items.title,
        link: items.link,
        source: items.source,
        content:
          options?.contentChars !== undefined
            ? sql<string | null>`substr(${items.content}, 1, ${options.contentChars})`
            : items.content,
        cover: items.cover,
        published_at: items.published_at,
        is_read: items.is_read,
        created_at: items.created_at,
        feed_title: feeds.title,
        sim_id: items.sim_id,
      })
      .from(items)
      .innerJoin(feeds, eq(items.feed_id, feeds.id))
      .where(and(timeFilter, cursorFilter, readFilter, statusFilter))
      .orderBy(desc(items.published_at), desc(items.id))
      .limit(adjustedLimit + 1)
      .all();

    const duplicateCounts = countDuplicates(
      selected.filter((row) => row.sim_id === null).map((row) => row.id),
    );
    return withoutGenericCovers(selected).map((row) => ({
      ...row,
      duplicate_count: row.sim_id === null ? duplicateCounts.get(row.id) ?? 0 : 0,
      created_at: toUtcIso(row.created_at),
    }));
  
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get items: ${detail}`);
  }
}

/**
 * The visible first report and duplicates of `id`'s cluster, newest first.
 * Returns an empty list for an item that is not part of a cluster.
 */
export function getItemCluster(id: number): {
  id: number;
  title: string;
  link: string;
  source: string;
  published_at: string;
  is_read: number;
  feed_title: string;
  sim_id: number | null;
}[] {
  try {
    const item = db
      .select({ id: items.id, sim_id: items.sim_id })
      .from(items)
      .where(eq(items.id, id))
      .get();
    if (!item) return [];
    const rootId = item.sim_id ?? item.id;

    const members = db
      .select({
        id: items.id,
        title: items.title,
        link: items.link,
        source: items.source,
        published_at: items.published_at,
        is_read: items.is_read,
        feed_title: feeds.title,
        sim_id: items.sim_id,
      })
      .from(items)
      .innerJoin(feeds, eq(items.feed_id, feeds.id))
      .where(
        and(
          or(eq(items.id, rootId), eq(items.sim_id, rootId)),
          eq(items.status, "passed"),
        ),
      )
      .orderBy(desc(items.published_at), desc(items.id))
      .all();
    return members.length > 1 ? members : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get item cluster: ${detail}`);
  }
}

/** Number of visible items pointing at each first-report root. */
function countDuplicates(rootIds: number[]): Map<number, number> {
  if (rootIds.length === 0) return new Map();
  const rows = db
    .select({ root: items.sim_id, count: sql<number>`count(*)` })
    .from(items)
    .where(and(inArray(items.sim_id, rootIds), eq(items.status, "passed")))
    .groupBy(items.sim_id)
    .all();
  return new Map(rows.map((row) => [row.root!, row.count]));
}

/** A cover shared by this many distinct stories is a site logo or default share image. */
const GENERIC_COVER_STORIES = 3;

/** Drops covers reused across unrelated stories (logos, default og:image) from query rows. */
export function withoutGenericCovers<T extends { cover: string | null }>(rows: T[]): T[] {
  const covers = [...new Set(rows.map((row) => row.cover).filter((cover): cover is string => !!cover))];
  if (covers.length === 0) return rows;

  const generic = new Set(
    db
      .select({ cover: items.cover })
      .from(items)
      .where(inArray(items.cover, covers))
      .groupBy(items.cover)
      .having(sql`count(distinct coalesce(${items.sim_id}, ${items.id})) >= ${GENERIC_COVER_STORIES}`)
      .all()
      .map((row) => row.cover),
  );
  if (generic.size === 0) return rows;
  return rows.map((row) => (row.cover && generic.has(row.cover) ? { ...row, cover: null } : row));
}

/** Returns the stored cover for a visible item. Used by the same-origin cover proxy. */
export function getItemCover(id: number): string | null {
  try {
    const row = db
      .select({ cover: items.cover })
      .from(items)
      .where(and(eq(items.id, id), eq(items.status, "passed")))
      .get();
    return row?.cover ?? null;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get item cover: ${detail}`);
  }
}

export function getItemsForExport(options: {
  since?: string;
  until?: string;
}): { published_at: string; title: string; content: string | null; link: string }[] {
  try {
    const sinceFilter = options.since
      ? gte(items.published_at, options.since)
      : undefined;
    const untilFilter = options.until
      ? lte(items.published_at, options.until)
      : undefined;
    const statusFilter = eq(items.status, "passed");

    return db
      .select({
        published_at: items.published_at,
        title: items.title,
        content: items.content,
        link: items.link,
      })
      .from(items)
      .where(and(sinceFilter, untilFilter, statusFilter))
      .orderBy(desc(items.published_at), desc(items.id))
      .all();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export items: ${detail}`);
  }
}

export function getExistingGuids(guids: string[]): Set<string> {
  if (guids.length === 0) return new Set();

  const rows = db
    .select({ guid: items.guid })
    .from(items)
    .where(inArray(items.guid, guids))
    .all();

  return new Set(rows.map((row) => row.guid));
}

export function addItems(
  feedId: number,
  newItems: {
    guid: string;
    title: string;
    link: string;
    content: string | null;
    cover: string | null;
    published_at: string;
    status: "passed" | "rejected" | "deleted";
    status_reason: string | null;
    /** Stored items judged to report the same news; merges them into one cluster. */
    duplicate_ids?: number[];
  }[],
): any[] {

  try {

    const feed = getFeed(feedId);

    if (!feed) {
      throw new Error(`Feed ${feedId} not found`);
    }

    const feed_title = feed.title;
    const existingGuids = getExistingGuids(newItems.map((item) => item.guid));
    const stopwords = new Set(getTokenizerState().stopwords);

    let insertedItems = [];

    for (const newItem of newItems) {
      if (existingGuids.has(newItem.guid)) continue;

      const id = newItemId();
      const { status, status_reason } = newItem;

      const inserted = db.transaction((tx) => {
        const cluster = newItem.duplicate_ids?.length
          ? resolveCluster(tx, id, newItem.published_at, newItem.duplicate_ids)
          : null;
        const item = tx.insert(items)
          .values({
            id,
            feed_id: feedId,
            guid: newItem.guid,
            title: newItem.title,
            title_tokens: titleTokens(newItem.title, stopwords),
            link: newItem.link,
            source: sourceFromLink(newItem.link),
            content: newItem.content,
            cover: newItem.cover,
            published_at: newItem.published_at,
            is_read: 0,
            status,
            status_reason,
            sim_id: cluster && cluster.rootId !== id ? cluster.rootId : null,
          })
          .onConflictDoNothing({ target: items.guid })
          .returning()
          .get();

        if (item && cluster && cluster.rerootIds.length > 0) {
          tx.update(items)
            .set({ sim_id: cluster.rootId })
            .where(or(inArray(items.id, cluster.rerootIds), inArray(items.sim_id, cluster.rerootIds)))
            .run();
        }

        return item;
      });


      if (inserted) {
        existingGuids.add(inserted.guid);
        insertedItems.push({
          ...inserted,
          created_at: toUtcIso(inserted.created_at),
          feed_title,
        });
      }
    }

    return insertedItems;

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to add items: ${detail}`);
  }
}

const TITLE_TOKENS_SIGNATURE_KEY = "title_tokens_signature";

/** Identifies the tokenizer rules and stopwords that stored `title_tokens` came from. */
function titleTokensSignature(stopwords: string[]): string {
  return md5Hex(JSON.stringify({ version: TITLE_TOKENS_VERSION, stopwords: [...stopwords].sort() }));
}

/**
 * Bring stored `title_tokens` up to date. Rows never tokenized are always
 * filled; every row is recomputed only when the stopwords or tokenizer rules
 * changed since the last sync. Runs after config load.
 */
export function syncTitleTokens(): { updated: number; full: boolean } {
  const { stopwords: stopwordList } = getTokenizerState();
  const stopwords = new Set(stopwordList);
  const signature = titleTokensSignature(stopwordList);
  const stored = db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, TITLE_TOKENS_SIGNATURE_KEY))
    .get();
  const full = stored?.value !== signature;

  const rows = db
    .select({ id: items.id, title: items.title, title_tokens: items.title_tokens })
    .from(items)
    .where(full ? undefined : isNull(items.title_tokens))
    .all();

  const changed = rows
    .map((row) => ({ id: row.id, next: titleTokens(row.title, stopwords), prev: row.title_tokens }))
    .filter((row) => row.next !== row.prev);

  db.transaction((tx) => {
    for (const row of changed) {
      tx.update(items)
        .set({ title_tokens: row.next })
        .where(eq(items.id, row.id))
        .run();
    }
    if (full) {
      tx.insert(meta)
        .values({ key: TITLE_TOKENS_SIGNATURE_KEY, value: signature })
        .onConflictDoUpdate({ target: meta.key, set: { value: signature } })
        .run();
    }
  });
  return { updated: changed.length, full };
}

type Tx = SQLiteTransaction<"sync", any, any, any>;

/**
 * Pick the first-published root for a new item and its duplicates' clusters.
 * `rerootIds` are old cluster roots whose members must now point at `rootId`.
 * Ties keep the stored item as root (the new item counts as later).
 */
function resolveCluster(
  tx: Tx,
  newId: number,
  publishedAt: string,
  duplicateIds: number[],
): { rootId: number; rerootIds: number[] } | null {
  const duplicates = tx
    .select({ id: items.id, sim_id: items.sim_id })
    .from(items)
    .where(inArray(items.id, duplicateIds))
    .all();
  const rootIds = [...new Set(duplicates.map((row) => row.sim_id ?? row.id))];
  if (rootIds.length === 0) return null;

  const roots = tx
    .select({ id: items.id, published_at: items.published_at })
    .from(items)
    .where(inArray(items.id, rootIds))
    .orderBy(asc(items.published_at), asc(items.id))
    .all();
  const earliest = roots[0];
  const rootId = !earliest || publishedAt < earliest.published_at ? newId : earliest.id;
  return { rootId, rerootIds: rootIds.filter((candidate) => candidate !== rootId) };
}

/**
 * Title tokens of visible items published within `windowMs` of `publishedAt`,
 * for ranking duplicate candidates. Only the columns needed to rank are read;
 * `getDedupNews` loads the few that reach the LLM.
 */
export function getDedupCandidates(
  publishedAt: string,
  windowMs: number,
): { id: number; title_tokens: string }[] {
  const center = Date.parse(publishedAt);
  if (Number.isNaN(center)) return [];
  return db
    .select({ id: items.id, title_tokens: sql<string>`${items.title_tokens}` })
    .from(items)
    .where(
      and(
        gte(items.published_at, new Date(center - windowMs).toISOString()),
        lte(items.published_at, new Date(center + windowMs).toISOString()),
        eq(items.status, "passed"),
        sql`${items.title_tokens} IS NOT NULL AND ${items.title_tokens} != ''`,
      ),
    )
    .all();
}

/** Title, date and the first `contentChars` characters of content for `ids`. */
export function getDedupNews(
  ids: number[],
  contentChars: number,
): { id: number; title: string; content: string | null; published_at: string }[] {
  if (ids.length === 0) return [];
  return db
    .select({
      id: items.id,
      title: items.title,
      content: sql<string | null>`substr(${items.content}, 1, ${contentChars})`,
      published_at: items.published_at,
    })
    .from(items)
    .where(inArray(items.id, ids))
    .all();
}

export function markItemsRead(until: string): void {
  
  try {

    db.update(items)
    .set({ is_read: 1 })
    .where(
      and(
        lte(items.published_at, until),
        eq(items.is_read, 0),
        eq(items.status, "passed"),
      ),
    )
    .run();

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to mark items as read: ${detail}`);
  }
}

export function deleteItem(id: number, reason: string): boolean {
  try {
    const deletedReason = reason.trim();
    if (!deletedReason) {
      throw new Error("Delete reason is required");
    }

    const existing = db
      .select({ id: items.id, status: items.status })
      .from(items)
      .where(eq(items.id, id))
      .get();

    if (!existing) {
      throw new Error("Item does not exist");
    }

    if (existing.status === "deleted") {
      throw new Error("Item is already deleted");
    }

    db.update(items)
      .set({ status: "deleted", status_reason: deletedReason })
      .where(eq(items.id, id))
      .run();

    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete item ${id}: ${detail}`);
  }
}

/** Soft-delete every visible item from a source after it is blocked. */
export function deleteItemsBySource(source: string): number {
  try {
    const normalizedSource = source.trim().toLocaleLowerCase();
    if (!normalizedSource) {
      throw new Error("Source is required");
    }

    const result = db
      .update(items)
      .set({
        status: "deleted",
        status_reason: `Source filter: ${normalizedSource}`,
      })
      .where(
        and(
          eq(items.source, normalizedSource),
          eq(items.status, "passed"),
        ),
      )
      .returning({ id: items.id })
      .all();

    return result.length;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to delete items from source: ${detail}`);
  }
}

export function markItemRead(id: number): void {

  try {

    db.update(items)
    .set({ is_read: 1 })
    .where(and(eq(items.id, id), eq(items.is_read, 0), eq(items.status, "passed")))
    .run();

  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to mark item ${id} as read: ${detail}`);
  }
}

const MCP_NEWS_CURSOR_KEY = "mcp_news_cursor";
/** Only news published this recently is handed out to MCP. */
const MCP_NEWS_WINDOW_MS = 3 * TimeUnit.DAY;

/**
 * Hands out the next batch of recent visible first reports (items that do not
 * duplicate an earlier one) to MCP in ascending item ID order. The largest ID
 * handed out is stored, so each call resumes after the previous one and no
 * item is returned twice.
 */
export function takeUningestedItems(): {
  items: {
    id: number;
    title: string;
    link: string;
    content: string | null;
    published_at: string;
    feed_title: string;
  }[];
  hasMore: boolean;
} {
  try {
    return db.transaction((tx) => {
      const stored = tx
        .select({ value: meta.value })
        .from(meta)
        .where(eq(meta.key, MCP_NEWS_CURSOR_KEY))
        .get();
      const cursor = Number(stored?.value);
      const since = new Date(Date.now() - MCP_NEWS_WINDOW_MS).toISOString();

      const selected = tx
        .select({
          id: items.id,
          title: items.title,
          link: items.link,
          content: items.content,
          published_at: items.published_at,
          feed_title: feeds.title,
        })
        .from(items)
        .innerJoin(feeds, eq(items.feed_id, feeds.id))
        .where(
          and(
            Number.isSafeInteger(cursor) ? gt(items.id, cursor) : undefined,
            gte(items.published_at, since),
            eq(items.status, "passed"),
            isNull(items.sim_id),
          ),
        )
        .orderBy(asc(items.id))
        .limit(MAX_LIMIT + 1)
        .all();

      const hasMore = selected.length > MAX_LIMIT;
      const taken = selected.slice(0, MAX_LIMIT);
      const last = taken.at(-1);
      if (last) {
        const value = String(last.id);
        tx.insert(meta)
          .values({ key: MCP_NEWS_CURSOR_KEY, value })
          .onConflictDoUpdate({ target: meta.key, set: { value } })
          .run();
      }

      return { items: taken, hasMore };
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to take uningested items: ${detail}`);
  }
}

export function clearItems(): void {
  try {
    const cutoff = new Date(Date.now() - 90 * TimeUnit.DAY).toISOString();
    db.delete(items).where(lt(items.published_at, cutoff)).run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to clear items: ${detail}`);
  }
}
