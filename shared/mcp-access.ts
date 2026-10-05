import { Elysia, type AnyElysia } from "elysia";
import { getMcpState } from "../config";
import { passwordsEqual, readBearer } from "./admin-auth";
import { isLocalRequest } from "./localhost-only";

/**
 * MCP is local-only by default. Remote access can be enabled at runtime, and
 * always requires the independently configured Bearer token.
 */
export function withMcpAccess(routes: AnyElysia) {
  return new Elysia()
    .onBeforeHandle(({ request, server, set }) => {
      const config = getMcpState();
      const address = server?.requestIP(request)?.address;
      if (!config.remoteAccess) {
        if (isLocalRequest(request, address)) return;
        set.status = 403;
        return { error: "Forbidden" };
      }

      const token = readBearer(request.headers.get("authorization"));
      if (token && passwordsEqual(token, config.authorization)) return;
      set.status = 401;
      set.headers["www-authenticate"] = "Bearer";
      return { error: "Unauthorized" };
    })
    .use(routes);
}
