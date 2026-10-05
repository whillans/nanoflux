/**
 * Everything the UI loads is same-origin, except feed-supplied avatar images.
 * No inline script or style is allowed, and the page can never be framed.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: https: http:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/**
 * Default headers for every response. A handler that returns its own
 * `Response` with one of these headers (the cover proxy) keeps its value.
 */
export function applySecurityHeaders({
  set,
}: {
  set: { headers: Record<string, unknown> };
}): void {
  Object.assign(set.headers, SECURITY_HEADERS);
}
