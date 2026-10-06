import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";

async function httpRequest(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  return undiciFetch(url, init) as unknown as Response;
}

export async function httpGet(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  return httpRequest(url, init);
}

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges. */
const BLOCKED_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // Unspecified, loopback and deprecated IPv4-compatible (::a.b.c.d).
  ["::", 96],
  // Local-use NAT64 and 6to4: both embed an IPv4 address that a translator
  // or relay could route to an internal host.
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2002::", 16],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** IPv4 embedded in IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) addresses. */
function embeddedIpv4(address: string): string | null {
  const match = address
    .toLowerCase()
    .match(/^(?:::ffff:|64:ff9b::)(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
  if (!match) return null;
  if (match[1]) return match[1];
  const high = Number.parseInt(match[2]!, 16);
  const low = Number.parseInt(match[3]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return BLOCKED_ADDRESSES.check(address, "ipv4");
  if (family !== 6) return true;
  const v4 = embeddedIpv4(address);
  if (v4) return BLOCKED_ADDRESSES.check(v4, "ipv4");
  return BLOCKED_ADDRESSES.check(address, "ipv6");
}

/** Hosts from `FETCH_ALLOW_PRIVATE_HOSTS`, e.g. a self-hosted RSSHub on the LAN. */
function allowedPrivateHosts(): Set<string> {
  return new Set(
    (process.env.FETCH_ALLOW_PRIVATE_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/^\[|\]$/g, ""))
      .filter(Boolean),
  );
}

export class BlockedUrlError extends Error {}

function bareHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

/**
 * Resolve a URL's host to the addresses a request may connect to, IPv4 first.
 * Rejects URLs that are not http(s) or whose host resolves to a non-public
 * address. Every resolved address must be public, so a DNS answer mixing
 * public and private records cannot slip through. Returns null for hosts
 * exempted by `FETCH_ALLOW_PRIVATE_HOSTS`.
 */
export async function resolvePublicAddresses(
  url: URL,
): Promise<string[] | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Blocked URL scheme: ${url.protocol}`);
  }
  const host = bareHostname(url);
  if (allowedPrivateHosts().has(host)) return null;

  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true, verbatim: true })).map(
        (entry) => entry.address,
      );
  const blocked = addresses.find(isBlockedAddress);
  if (blocked) {
    throw new BlockedUrlError(
      `Blocked non-public address for ${host}: ${blocked}`,
    );
  }
  return addresses.sort((a, b) => isIP(a) - isIP(b));
}

/**
 * GET `url` by connecting to `address` instead of resolving the host again.
 * The URL carries the IP, so the runtime does not get to re-resolve the name;
 * the original host travels in the Host header and, for HTTPS, as the TLS
 * server name the certificate is verified against.
 */
async function pinnedGet(
  url: URL,
  address: string,
  init: UndiciRequestInit,
): Promise<Response> {
  const pinned = new URL(url.href);
  pinned.hostname = isIP(address) === 6 ? `[${address}]` : address;
  const headers = new Headers(init.headers as HeadersInit);
  headers.set("Host", url.host);
  return httpRequest(pinned.href, {
    ...init,
    headers,
    method: "GET",
    redirect: "manual",
    ...(url.protocol === "https:" && {
      tls: { serverName: bareHostname(url) },
    }),
  } as unknown as UndiciRequestInit);
}

async function checkedGet(
  url: URL,
  init: UndiciRequestInit,
): Promise<Response> {
  const addresses = await resolvePublicAddresses(url);
  // Exempt hosts and IP literals involve no lookup that could change.
  if (!addresses || isIP(bareHostname(url))) {
    return httpRequest(url.href, { ...init, method: "GET", redirect: "manual" });
  }
  let lastError: unknown;
  for (const address of addresses) {
    try {
      return await pinnedGet(url, address, init);
    } catch (error) {
      lastError = error;
      if (init.signal?.aborted) break;
    }
  }
  throw lastError;
}

const MAX_REDIRECTS = 5;

/**
 * GET a URL taken from untrusted content (feeds, articles, covers). Each hop,
 * including redirects, is resolved once, checked, and then requested at the
 * checked address, so a DNS answer that changes after the check (rebinding)
 * cannot redirect the connection to an internal host.
 */
export async function publicHttpGet(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    const response = await checkedGet(current, init);
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
      return response;
    }
    await response.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    }
    current = new URL(location, current);
  }
}

export async function httpPost(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  return httpRequest(url, { ...init, method: init.method ?? "POST" });
}

/**
 * Read a response body, aborting once it exceeds `maxBytes`. Checks the
 * declared Content-Length first, then counts streamed bytes, since the header
 * can be missing or wrong.
 */
export async function readBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const tooLarge = () =>
    new Error(`Response body exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB`);

  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw tooLarge();
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, received);
}

export async function httpDelete(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  return httpRequest(url, { ...init, method: "DELETE" });
}
