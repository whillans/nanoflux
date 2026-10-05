import { Elysia, type AnyElysia } from "elysia";
import { isLoopbackHost } from "./env";

const LOCALHOST_ADDRESSES = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);

/** Headers a reverse proxy or tunnel adds on behalf of the real client. */
const PROXY_HEADERS = ["forwarded", "x-forwarded-for", "x-real-ip"];

export function isLocalhostAddress(address: string | undefined): boolean {
  if (!address) return false;
  if (LOCALHOST_ADDRESSES.has(address)) return true;
  if (address.startsWith("::ffff:")) {
    return address === "::ffff:127.0.0.1";
  }
  return false;
}

/** Hostname of a `Host` header value or an `Origin`, if it names this machine. */
function isLoopbackAuthority(value: string, isOrigin: boolean): boolean {
  try {
    const url = new URL(isOrigin ? value : `http://${value}`);
    // A Host header is `host[:port]` only; userinfo or a path would let the
    // parsed hostname differ from the name the client actually used.
    if (!isOrigin && /[/\\@?#]/.test(value)) return false;
    return isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a request comes from this machine. A same-host reverse proxy
 * connects from loopback for every client, so a request carrying proxy
 * headers is never treated as local. The headers can only make this stricter.
 *
 * A loopback peer is not enough on its own: a web page open in a local browser
 * also connects from loopback, and DNS rebinding lets it do so same-origin. So
 * the request must be addressed to a loopback name (`Host`), and if a browser
 * sent it (`Origin`), the page must itself be served from this machine.
 */
export function isLocalRequest(
  request: Request,
  address: string | undefined,
): boolean {
  if (!isLocalhostAddress(address)) return false;
  if (PROXY_HEADERS.some((header) => request.headers.has(header))) return false;

  const host = request.headers.get("host");
  if (!host || !isLoopbackAuthority(host, false)) return false;
  const origin = request.headers.get("origin");
  return origin === null || isLoopbackAuthority(origin, true);
}

const CLIENT_KEY_MAX_LENGTH = 64;

/** The client a proxy says it is forwarding for: the entry it appended last. */
function forwardedClient(headers: Headers): string | undefined {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (forwardedFor) return forwardedFor;
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get("forwarded")?.split(",").at(-1);
  return forwarded?.match(/(?:^|;)\s*for=\s*"?([^";]+)"?/i)?.[1]?.trim() || undefined;
}

/**
 * The address to attribute a request to, e.g. for rate limiting. Proxy headers
 * are believed only when the peer is loopback, i.e. a same-host reverse proxy;
 * a client connecting directly cannot pick its own address by sending them.
 */
export function clientAddress(
  request: Request,
  address: string | undefined,
): string {
  if (!address) return "unknown";
  if (!isLocalhostAddress(address)) return address;
  const client = forwardedClient(request.headers);
  return client ? client.slice(0, CLIENT_KEY_MAX_LENGTH).toLowerCase() : address;
}

/** Apply localhost restriction to `routes` (Elysia named plugins do not inherit parent hooks). */
export function withLocalhostOnly(routes: AnyElysia) {
  return new Elysia().onBeforeHandle(({ request, server, set }) => {
    const address = server?.requestIP(request)?.address;
    if (!isLocalRequest(request, address)) {
      set.status = 403;
      return { error: "Forbidden" };
    }
  }).use(routes);
}
