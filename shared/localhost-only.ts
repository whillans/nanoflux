import { Elysia, type AnyElysia } from "elysia";

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

/**
 * Whether a request comes from this machine. A same-host reverse proxy
 * connects from loopback for every client, so a request carrying proxy
 * headers is never treated as local. The headers can only make this stricter.
 */
export function isLocalRequest(
  request: Request,
  address: string | undefined,
): boolean {
  if (!isLocalhostAddress(address)) return false;
  return !PROXY_HEADERS.some((header) => request.headers.has(header));
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
