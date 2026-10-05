import type { InferSelectModel } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

export const feeds = sqliteTable(
  "t_feeds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    url: text("url").notNull().unique(),
    description: text("description"),
    fetch_interval_min: integer("fetch_interval_min").notNull().default(15),
    next_fetched_at: text("next_fetched_at"),
    last_build_date: text("last_build_date"),
    last_guids: text("last_guids"),
    last_published_at: text("last_published_at"),
    /** Consecutive failed fetches; drives retry backoff. Reset on success. */
    fetch_failures: integer("fetch_failures").notNull().default(0),
    last_error: text("last_error"),
    /** HTTP cache validators for conditional feed requests. */
    http_etag: text("http_etag"),
    http_last_modified: text("http_last_modified"),
    created_at: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updated_at: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_feeds_updated_at").on(table.updated_at),
  ],
);

export const items = sqliteTable(
  "t_items",
  {
    id: integer("id").primaryKey(),
    feed_id: integer("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    title: text("title").notNull(),
    /** Space-separated jieba keywords (nouns, verbs, abbreviations) of `title`; NULL until tokenized. */
    title_tokens: text("title_tokens"),
    content: text("content"),
    link: text("link").notNull(),
    source: text("source").notNull().default(""),
    cover: text("cover"),
    published_at: text("published_at").notNull(),
    created_at: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    status: text("status", { enum: ["passed", "rejected", "deleted"] })
      .notNull()
      .default("passed"),
    status_reason: text("status_reason"),
    is_read: integer("is_read").notNull().default(0),
    /** Id of the first-published item this one duplicates; NULL for a first report. */
    sim_id: integer("sim_id"),
  },
  (table) => [
    unique().on(table.guid),
    index("idx_items_published_at").on(table.published_at),
    // Child key of the feeds FK cascade; also serves Fever "mark feed read".
    index("idx_items_feed_id_published_at").on(table.feed_id, table.published_at),
    // Covers Fever unread-id lists and status counts without touching row content.
    index("idx_items_status_is_read").on(table.status, table.is_read),
    // Status-filtered timeline; `is_read` lets read/unread filters skip row lookups.
    index("idx_items_status_published_at").on(table.status, table.published_at, table.is_read),
    // Almost every row is NULL in these columns, so index only the rest.
    index("idx_items_sim_id").on(table.sim_id).where(sql`${table.sim_id} IS NOT NULL`),
    index("idx_items_cover").on(table.cover, table.sim_id).where(sql`${table.cover} IS NOT NULL`),
  ],
);

/** Small key/value store for internal state, e.g. derived-data signatures. */
export const meta = sqliteTable("t_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Feed = InferSelectModel<typeof feeds>;
export type Item = InferSelectModel<typeof items>;

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
