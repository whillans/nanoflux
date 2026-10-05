import type Parser from "rss-parser";
import { isHttpUrl } from "../../shared/url";

const IMAGE_EXT = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg)(?:[?#]|$)/i;
const META_TAG = /<meta\b[^>]*>/gi;
const LINK_TAG = /<link\b[^>]*>/gi;
const IMG_TAG = /<img\b[^>]*>/gi;
const ATTR = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
const BAD_IMAGE = /favicon|sprite|pixel|1x1|spacer|tracking|adservice|doubleclick/i;
/** File names of a logo, icon, avatar or placeholder rather than article art. */
const GENERIC_IMAGE =
  /(?:^|[_.-])(?:logos?|icons?|avatars?|default|placeholder|blank|loading|share)(?=[_.-]|$)/i;
/** Declared <img> dimensions below this are thumbnails/badges, not cover art. */
const MIN_COVER_WIDTH = 200;
const MIN_COVER_HEIGHT = 120;

const META_KEYS = [
  "og:image",
  "og:image:secure_url",
  "og:image:url",
  "twitter:image",
  "twitter:image:src",
  "twitter:image:url",
];

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR.lastIndex = 0;
  for (const match of tag.matchAll(ATTR)) {
    const name = match[1]?.toLowerCase();
    if (!name || name === "meta" || name === "link" || name === "img") continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeEntities(raw.trim());
  }
  return attrs;
}

function looksLikeImageUrl(value: string): boolean {
  try {
    return IMAGE_EXT.test(new URL(value).pathname);
  } catch {
    return IMAGE_EXT.test(value);
  }
}

function attrsOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const rec = value as Record<string, unknown>;
  if (rec.$ && typeof rec.$ === "object") return rec.$ as Record<string, unknown>;
  return rec;
}

export function asAbsoluteHttpUrl(value: unknown, baseUrl?: string): string | null {
  if (typeof value === "string") {
    const trimmed = decodeEntities(value.trim());
    if (!trimmed || trimmed.startsWith("data:")) return null;
    try {
      const resolved = baseUrl ? new URL(trimmed, baseUrl).href : trimmed;
      return isHttpUrl(resolved) ? resolved : null;
    } catch {
      return isHttpUrl(trimmed) ? trimmed : null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const attrs = attrsOf(value);
  return asAbsoluteHttpUrl(
    attrs.url ?? attrs.href ?? rec.url ?? rec.href ?? rec["#"],
    baseUrl,
  );
}

function usableImageUrl(url: string | null): string | null {
  if (!url || BAD_IMAGE.test(url)) return null;
  try {
    const fileName = new URL(url).pathname.split("/").pop() ?? "";
    if (GENERIC_IMAGE.test(fileName)) return null;
  } catch {
    return null;
  }
  return url;
}

function isImageHint(type: unknown, medium: unknown): boolean {
  if (typeof medium === "string" && medium.toLowerCase() === "image") return true;
  if (typeof type === "string" && type.toLowerCase().startsWith("image/")) return true;
  return false;
}

function asList(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function pickFromMedia(values: unknown[], baseUrl: string): string | null {
  for (const value of values) {
    const attrs = attrsOf(value);
    const url = asAbsoluteHttpUrl(value, baseUrl);
    if (!url) continue;
    if (isImageHint(attrs.type, attrs.medium) || looksLikeImageUrl(url)) {
      return usableImageUrl(url);
    }
  }
  return null;
}

function tooSmall(attrs: Record<string, string>): boolean {
  const width = Number.parseInt(attrs.width ?? "", 10);
  const height = Number.parseInt(attrs.height ?? "", 10);
  if (width > 0 && width < MIN_COVER_WIDTH) return true;
  if (height > 0 && height < MIN_COVER_HEIGHT) return true;
  return false;
}

export function pickCoverFromHtml(html: string | undefined, baseUrl: string): string | null {
  if (!html) return null;
  IMG_TAG.lastIndex = 0;
  for (const [tag] of html.matchAll(IMG_TAG)) {
    const attrs = parseAttrs(tag);
    if (tooSmall(attrs)) continue;
    const raw = attrs.src || attrs["data-src"] || attrs["data-original"] || attrs["data-lazy-src"];
    const url = usableImageUrl(asAbsoluteHttpUrl(raw, baseUrl));
    if (url) return url;
  }
  return null;
}

export function pickCoverFromMeta(html: string, baseUrl: string): string | null {
  const values = new Map<string, string>();
  META_TAG.lastIndex = 0;
  for (const [tag] of html.matchAll(META_TAG)) {
    const attrs = parseAttrs(tag);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    const content = attrs.content || attrs.value;
    if (key && content) values.set(key, content);
  }
  for (const key of META_KEYS) {
    const url = usableImageUrl(asAbsoluteHttpUrl(values.get(key), baseUrl));
    if (url) return url;
  }
  const itemprop = usableImageUrl(asAbsoluteHttpUrl(values.get("image"), baseUrl));
  if (itemprop) return itemprop;

  LINK_TAG.lastIndex = 0;
  for (const [tag] of html.matchAll(LINK_TAG)) {
    const attrs = parseAttrs(tag);
    if ((attrs.rel || "").toLowerCase() !== "image_src") continue;
    const url = usableImageUrl(asAbsoluteHttpUrl(attrs.href, baseUrl));
    if (url) return url;
  }
  return null;
}

type CoverEntry = Parser.Item & {
  mediaContent?: unknown;
  mediaThumbnail?: unknown;
  image?: unknown;
  itunes?: { image?: unknown };
};

/** Cover from the RSS/Atom item itself (media, enclosure, itunes, item HTML). */
export function pickCoverFromRss(entry: CoverEntry, pageUrl: string): string | null {
  const fromThumb = pickFromMedia(asList(entry.mediaThumbnail), pageUrl);
  if (fromThumb) return fromThumb;

  const fromMedia = pickFromMedia(asList(entry.mediaContent), pageUrl);
  if (fromMedia) return fromMedia;

  const enclosure = entry.enclosure;
  if (enclosure?.url) {
    const url = asAbsoluteHttpUrl(enclosure.url, pageUrl);
    if (url && (isImageHint(enclosure.type, undefined) || looksLikeImageUrl(url))) {
      return usableImageUrl(url);
    }
  }

  const itunesImage = usableImageUrl(asAbsoluteHttpUrl(entry.itunes?.image, pageUrl));
  if (itunesImage) return itunesImage;

  const imageField = usableImageUrl(asAbsoluteHttpUrl(entry.image, pageUrl));
  if (imageField) return imageField;

  return pickCoverFromHtml(entry.content, pageUrl) || pickCoverFromHtml(entry.summary, pageUrl);
}
