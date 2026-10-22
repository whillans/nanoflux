/** Whether a feed URL is a Google News RSS feed (`news.google.com/rss...`). */
export function isGoogleNewsFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /(^|\.)news\.google\.com$/i.test(parsed.hostname) && parsed.pathname.startsWith("/rss");
  } catch {
    return false;
  }
}

/** Detect Google News `hl` from keyword script: Chinese → zh-CN, otherwise en-US. */
export function googleNewsLanguageFromKeyword(keyword: string): string {
  return /[\u4e00-\u9fff]/.test(keyword) ? "zh-CN" : "en-US";
}

/**
 * Build a Google News RSS feed URL for a keyword (last 3 days).
 * Format: `https://news.google.com/rss/search?q={keyword}+when:3d&hl={language}`
 */
export function buildKeywordGoogleNewsFeedUrl(keyword: string): string {
  const trimmed = keyword.trim();
  if (!trimmed) {
    throw new Error("keyword must not be empty");
  }

  const q = encodeURIComponent(trimmed).replace(/%20/g, "+");
  const language = googleNewsLanguageFromKeyword(trimmed);
  return `https://news.google.com/rss/search?q=${q}+when:3d&hl=${language}`;
}
