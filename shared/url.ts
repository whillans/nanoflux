/** True for absolute http(s) URLs; rejects `javascript:`, `data:` and relative values. */
export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** `href` value for untrusted links: the URL when it is http(s), otherwise none. */
export function safeHref(value: string | null | undefined): string | undefined {
  return value && isHttpUrl(value) ? value : undefined;
}
