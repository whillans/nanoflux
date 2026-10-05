import { Elysia, t } from "elysia";
import { networkInterfaces } from "node:os";
import {
  generateMcpAuthorization,
  getMcpState,
  updateMcpState,
} from "../config";
import { isLoopbackHost } from "../shared/env";

function getNetworkIp(): string {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  const privateAddress = addresses.find((address) =>
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address),
  );
  const address = privateAddress ?? addresses[0];
  if (!address) throw new Error("No non-loopback IPv4 address found");
  return address;
}

async function resolveMcpEndpoint(request: Request): Promise<string> {
  const url = new URL(request.url);
  if (!isLoopbackHost(url.hostname)) return `${url.origin}/mcp`;

  const networkIp = getNetworkIp();
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${networkIp}${port}/mcp`;
}

function publicMcpConfig() {
  const config = getMcpState();
  return {
    remoteAccess: config.remoteAccess,
    hasAuthorization: config.authorization.length > 0,
    // This route is protected by administrator authentication, so the owner
    // can retrieve the token when configuring an MCP client.
    authorization: config.remoteAccess ? config.authorization : undefined,
  };
}

export const routes = new Elysia({ prefix: "/api/mcp" })
  .get("/", () => ({ code: 0, message: "ok", data: publicMcpConfig() }))
  .get("/endpoint", async ({ request, set }) => {
    try {
      return {
        code: 0,
        message: "ok",
        data: { endpoint: await resolveMcpEndpoint(request) },
      };
    } catch (error) {
      set.status = 502;
      return {
        code: 502,
        message:
          error instanceof Error ? error.message : "Failed to resolve network IP",
      };
    }
  })
  .post("/generate-token", () => ({
    code: 0,
    message: "ok",
    data: { authorization: generateMcpAuthorization() },
  }))
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const updated = await updateMcpState({
          remoteAccess: body.remoteAccess,
          authorization: body.authorization,
        });
        return {
          code: 0,
          message: "ok",
          data: {
            remoteAccess: updated.remoteAccess,
            hasAuthorization: updated.authorization.length > 0,
            authorization: updated.remoteAccess ? updated.authorization : undefined,
          },
        };
      } catch (error) {
        set.status = 400;
        return {
          code: 400,
          message: error instanceof Error ? error.message : "Failed to update MCP config",
        };
      }
    },
    {
      body: t.Object({
        remoteAccess: t.Optional(t.Boolean()),
        authorization: t.Optional(t.String()),
      }),
    },
  );
