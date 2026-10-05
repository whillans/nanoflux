import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { decodeHtmlBytes } from "../../utils/encoding";
import { countContentTokens } from "../../utils/text";
import { htmlToPlainText, stripSrcsetAttributes } from "../../utils/html";
import { resolveArticleUrl } from "../google-news";
import { publicHttpGet, readBodyLimited } from "../http-fetcher";
import { pickCoverFromHtml, pickCoverFromMeta } from "../feeds/cover";

/** Unified token threshold; roughly ~200 Chinese chars / 80 English words. */
const FULL_CONTENT_MIN_TOKENS = 80;

/** Desktop Chrome on Windows — normal browser fetch, not a crawler UA. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const ARTICLE_TIMEOUT_MS = 15_000;
const SCRAPE_CONCURRENCY = 3;
const MAX_ARTICLE_BYTES = 5 * 1024 * 1024;

/**
 * Readability's default 500-char floor is tuned for English. Chinese news
 * bodies are denser per character, so a lower floor avoids false empties.
 */
const READABILITY_CHAR_THRESHOLD = 140;

/** Common article roots when Readability misses (WeChat, CMS templates). */
const FALLBACK_SELECTORS = [
  "#js_content",
  ".rich_media_content",
  "[itemprop='articleBody']",
  "article",
  ".article-content",
  ".article-body",
  ".post-content",
  ".entry-content",
  "#content",
  "main",
];

/** Whether content is long enough that scraping is unnecessary. */
function hasFullContent(content: string | null | undefined): boolean {
  const text = content?.trim();
  if (!text) return false;
  return countContentTokens(text) >= FULL_CONTENT_MIN_TOKENS;
}

function needsFullContentScrape(content: string | null | undefined): boolean {
  return !hasFullContent(content);
}

function parseLinkedDocument(html: string, url: string) {
  const window = parseHTML(html);
  const document = window.document;
  const head = document.head ?? document.querySelector("head");
  if (head) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    head.insertBefore(base, head.firstChild);
  }
  return document;
}

function extractWithReadability(html: string, url: string): string | null {
  try {
    const document = parseLinkedDocument(html, url);
    const article = new Readability(document as unknown as Document, {
      charThreshold: READABILITY_CHAR_THRESHOLD,
      nbTopCandidates: 10,
    }).parse();
    return article?.content?.trim() || null;
  } catch {
    return null;
  }
}

function extractWithSelectors(html: string): string | null {
  try {
    const document = parseHTML(html).document;
    let bestHtml: string | null = null;
    let bestTokens = 0;
    for (const selector of FALLBACK_SELECTORS) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const inner = (el as { innerHTML?: string }).innerHTML?.trim();
      if (!inner) continue;
      const tokens = countContentTokens(htmlToPlainText(inner));
      if (tokens > bestTokens) {
        bestTokens = tokens;
        bestHtml = inner;
      }
    }
    return bestTokens >= FULL_CONTENT_MIN_TOKENS ? bestHtml : null;
  } catch {
    return null;
  }
}

/** Firefox Reader Mode first; CMS/WeChat selectors if that body is too short. */
function extractArticleHtml(html: string, url: string): string | null {
  const fromReader = extractWithReadability(html, url);
  const readerText = fromReader ? htmlToPlainText(fromReader) : "";
  if (countContentTokens(readerText) >= FULL_CONTENT_MIN_TOKENS) {
    return fromReader;
  }
  return extractWithSelectors(html) ?? fromReader;
}

async function fetchArticleHtml(url: string): Promise<string | null> {
  try {
    const response = await publicHttpGet(url, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(ARTICLE_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const bytes = await readBodyLimited(response, MAX_ARTICLE_BYTES);
    return stripSrcsetAttributes(
      decodeHtmlBytes(bytes, response.headers.get("content-type")),
    );
  } catch {
    return null;
  }
}

async function enrichItemContent<
  T extends { link: string; content: string | null; cover: string | null },
>(item: T): Promise<T> {
  let next = item;

  const needCover = !next.cover;
  const needContent = needsFullContentScrape(next.content);
  if (!needCover && !needContent) return next;

  const html = await fetchArticleHtml(next.link);
  if (!html) return next;

  if (needCover) {
    const fromMeta = pickCoverFromMeta(html, next.link);
    if (fromMeta) next = { ...next, cover: fromMeta };
  }

  const stillNeedCover = !next.cover;
  if (!needContent && !stillNeedCover) return next;

  const articleHtml = extractArticleHtml(html, next.link);

  if (stillNeedCover) {
    const fromBody =
      pickCoverFromHtml(articleHtml, next.link) ||
      pickCoverFromHtml(html, next.link);
    if (fromBody) next = { ...next, cover: fromBody };
  }

  if (needContent && articleHtml) {
    const text = htmlToPlainText(articleHtml);
    const extractedTokens = countContentTokens(text);
    const existingTokens = countContentTokens(next.content ?? "");
    if (text && extractedTokens > existingTokens) {
      next = { ...next, content: text };
    }
  }

  return next;
}

async function mapInBatches<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += SCRAPE_CONCURRENCY) {
    const batch = items.slice(i, i + SCRAPE_CONCURRENCY);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

/** Replace Google News redirect links with the publisher's article URL. */
export async function resolveItemLinks<T extends { link: string }>(
  items: T[],
): Promise<T[]> {
  return mapInBatches(items, async (item) => {
    const link = await resolveArticleUrl(item.link);
    return link !== item.link ? { ...item, link } : item;
  });
}

/** Scrape full text and cover for items with a resolved article link. */
export async function enrichItemsContent<
  T extends { link: string; content: string | null; cover: string | null },
>(items: T[]): Promise<T[]> {
  return mapInBatches(items, enrichItemContent);
}
