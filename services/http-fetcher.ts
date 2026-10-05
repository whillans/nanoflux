import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import type { RequestInit as UndiciRequestInit } from "undici";

const dispatcher = new EnvHttpProxyAgent();

async function httpRequest(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  return undiciFetch(url, { ...init, dispatcher }) as unknown as Response;
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
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
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

/**
 * Reject URLs that are not http(s) or whose host resolves to a non-public
 * address. Every resolved address must be public, so a DNS answer mixing
 * public and private records cannot slip through.
 */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Blocked URL scheme: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (allowedPrivateHosts().has(host)) return;

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
}

const MAX_REDIRECTS = 5;

/**
 * GET a URL taken from untrusted content (feeds, articles, covers). Each hop,
 * including redirects, is resolved and checked before the request is sent.
 */
export async function publicHttpGet(
  url: string,
  init: UndiciRequestInit = {},
): Promise<Response> {
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(current);
    const response = await httpRequest(current.href, {
      ...init,
      method: "GET",
      redirect: "manual",
    });
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
