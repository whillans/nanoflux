import { httpGet, httpPost } from "./http-fetcher";

export {
  buildKeywordGoogleNewsFeedUrl,
  googleNewsLanguageFromKeyword,
} from "../shared/google-news";

const GOOGLE_NEWS_HOST = /(^|\.)news\.google\.com$/i;
const BATCH_EXECUTE_URL =
  "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const RESOLVE_TIMEOUT_MS = 15_000;

export function isGoogleNewsArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!GOOGLE_NEWS_HOST.test(parsed.hostname)) return false;
    return /\/rss\/articles\/|\/articles\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function googleNewsArticleId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/(?:rss\/)?articles\/([^/?#]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Older Google News tokens sometimes embed the publisher URL in base64. */
function tryDecodeEmbeddedPublisherUrl(articleId: string): string | null {
  try {
    let b64 = articleId.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    const match = decoded.match(/https?:\/\/[^\s\x00-\x1f"'<>\\]+/);
    if (!match) return null;
    const candidate = match[0].replace(/[.,);]+$/, "");
    const parsed = new URL(candidate);
    if (GOOGLE_NEWS_HOST.test(parsed.hostname)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function stripBatchExecutePrefix(body: string): string {
  let text = body;
  if (text.startsWith(")]}'")) {
    const nl = text.indexOf("\n");
    text = nl >= 0 ? text.slice(nl + 1) : text.slice(4);
  }
  text = text.trimStart();
  const firstNl = text.indexOf("\n");
  if (firstNl > 0 && /^\d+$/.test(text.slice(0, firstNl).trim())) {
    text = text.slice(firstNl + 1);
  }
  return text.trim();
}

function parsePublisherUrlFromBatchExecute(body: string): string | null {
  try {
    const envelopes = JSON.parse(stripBatchExecutePrefix(body)) as unknown;
    if (!Array.isArray(envelopes)) return null;

    for (const env of envelopes) {
      if (
        !Array.isArray(env) ||
        env[0] !== "wrb.fr" ||
        env[1] !== "Fbv4je" ||
        typeof env[2] !== "string"
      ) {
        continue;
      }
      const payload = JSON.parse(env[2]) as unknown;
      if (
        Array.isArray(payload) &&
        payload[0] === "garturlres" &&
        typeof payload[1] === "string"
      ) {
        const href = payload[1].trim();
        if (!href) return null;
        const parsed = new URL(href);
        if (GOOGLE_NEWS_HOST.test(parsed.hostname)) return null;
        return parsed.href;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve a Google News article redirect to the publisher URL.
 * Post-2024 tokens need Google's batchexecute `Fbv4je` RPC.
 */
async function resolveGoogleNewsArticleUrl(
  url: string,
): Promise<string | null> {
  if (!isGoogleNewsArticleUrl(url)) return null;

  const articleId = googleNewsArticleId(url);
  if (!articleId) return null;

  const embedded = tryDecodeEmbeddedPublisherUrl(articleId);
  if (embedded) return embedded;

  try {
    const page = await httpGet(url, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!page.ok) return null;

    const html = await page.text();
    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!signature || !timestamp) return null;

    const rpcInner = JSON.stringify([
      "garturlreq",
      [
        [
          "X",
          "X",
          ["X", "X"],
          null,
          null,
          1,
          1,
          "US:en",
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          0,
          1,
        ],
        "X",
        "X",
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId,
      Number(timestamp),
      signature,
    ]);
    const fReq = JSON.stringify([[["Fbv4je", rpcInner, null, "generic"]]]);

    const response = await httpPost(BATCH_EXECUTE_URL, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Referer: "https://news.google.com/",
        "User-Agent": BROWSER_USER_AGENT,
      },
      body: new URLSearchParams({ "f.req": fReq }).toString(),
      signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    return parsePublisherUrlFromBatchExecute(await response.text());
  } catch {
    return null;
  }
}

/** Resolve Google News redirects; pass through other URLs unchanged. */
export async function resolveArticleUrl(url: string): Promise<string> {
  if (!isGoogleNewsArticleUrl(url)) return url;
  return (await resolveGoogleNewsArticleUrl(url)) ?? url;
}
