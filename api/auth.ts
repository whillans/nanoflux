import { Elysia, t, type AnyElysia } from "elysia";
import {
  authenticateRequest,
  checkCredential,
  createSessionToken,
  isSecureRequest,
  passwordsEqual,
  readSessionCookie,
  revokeSessionToken,
  sessionCookieHeader,
} from "../shared/admin-auth";
import { clientAddress } from "../shared/localhost-only";

export type AdminAuthOptions = {
  required: boolean;
  password: string;
};

export function withAdminAuth(routes: AnyElysia, options: AdminAuthOptions) {
  if (!options.required) return routes;
  return new Elysia()
    .onBeforeHandle(({ request, server, set }) => {
      const client = clientAddress(request, server?.requestIP(request)?.address);
      const result = authenticateRequest(request, options.password, client);
      if (result === "ok") return;
      if (result === "blocked") {
        set.status = 429;
        return { code: 429, message: "Too many failed attempts" };
      }
      set.status = 401;
      return { code: 401, message: "Unauthorized" };
    })
    .use(routes);
}

export function createAuthRoutes(options: AdminAuthOptions) {
  return new Elysia({ prefix: "/api/auth" })
    .get("/status", ({ request, server }) => {
      if (!options.required) {
        return { code: 0, message: "ok", data: { required: false, authenticated: true } };
      }
      const client = clientAddress(request, server?.requestIP(request)?.address);
      return {
        code: 0,
        message: "ok",
        data: {
          required: true,
          authenticated:
            authenticateRequest(request, options.password, client) === "ok",
        },
      };
    })
    .post(
      "/login",
      ({ request, body, server, set }) => {
        if (!options.required) {
          return { code: 0, message: "ok", data: { required: false, authenticated: true } };
        }

        const client = clientAddress(request, server?.requestIP(request)?.address);
        const password = typeof body?.password === "string" ? body.password : "";
        const result = checkCredential(
          "admin",
          client,
          passwordsEqual(password, options.password),
        );
        if (result === "blocked") {
          set.status = 429;
          return { code: 429, message: "Too many login attempts" };
        }
        if (result !== "ok") {
          set.status = 401;
          return { code: 401, message: "Invalid password" };
        }

        set.headers["set-cookie"] = sessionCookieHeader(
          createSessionToken(),
          isSecureRequest(request),
        );
        return { code: 0, message: "ok", data: { required: true, authenticated: true } };
      },
      {
        body: t.Object({
          password: t.String(),
        }),
      },
    )
    .post("/logout", ({ request, set }) => {
      revokeSessionToken(readSessionCookie(request));
      set.headers["set-cookie"] = sessionCookieHeader(null, isSecureRequest(request));
      return {
        code: 0,
        message: "ok",
        data: {
          required: options.required,
          authenticated: !options.required,
        },
      };
    });
}
