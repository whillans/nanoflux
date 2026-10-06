import { join } from "node:path";
import { Elysia } from "elysia";
import {
  isLoopbackHost,
  requireAdminPassword,
  resolveHost,
  resolvePort,
  resolveTls,
  type TlsFiles,
} from "./shared/env";
import { withMcpAccess } from "./shared/mcp-access";
import { applySecurityHeaders } from "./shared/security-headers";
import { createAuthRoutes, withAdminAuth } from "./api/auth";
import { buildWebManifest } from "./shared/manifest";
import { DEFAULT_LOCALE, parseLocale, type Locale } from "./shared/locale";
import { closeDatabase } from "./db/database";
import { routes as itemsRoutes } from "./api/items";
import { routes as feedsRoutes } from "./api/feeds";
import { routes as filterRoutes } from "./api/filter";
import { routes as translateRoutes } from "./api/translate";
import { routes as dedupRoutes } from "./api/dedup";
import { routes as feverRoutes } from "./api/fever";
import { routes as mcpConfigRoutes } from "./api/mcp";
import {
  handleFeverRequest,
  isFeverApiQuery,
} from "./fever/route";
import { routes as mcpRoutes } from "./mcp/route";
import { isFeverEnabled } from "./fever";
import {
  startScheduler,
  stopScheduler,
} from "./services/scheduler";
import { httpGet } from "./services/http-fetcher";
import { getFilterConfig } from "./filter";
import { getTranslateConfig } from "./translate";
import { getDedupState, getTokenizerState, loadAppConfig } from "./config";
import { syncTitleTokens } from "./db/items";

const PUBLIC_DIR = join(import.meta.dir, "public");
const GOOGLE_CONNECTIVITY_URL = "https://www.google.com/generate_204";
const GOOGLE_CONNECTIVITY_TIMEOUT_MS = 10_000;
/**
 * Bun's default is 128 MB. Legitimate bodies are small JSON payloads; 32 KB
 * leaves room for about 4,000 CJK characters escaped as `\uXXXX` (24 KB).
 */
const MAX_REQUEST_BODY_BYTES = 32 * 1024;
const indexHtml = () => Bun.file(join(PUBLIC_DIR, "index.html"));
const serviceWorker = () => Bun.file(join(PUBLIC_DIR, "sw.js"));

/**
 * A missing file must be a plain 404: returning the `Bun.file` anyway throws
 * ENOENT, and the error names the absolute path it tried to open.
 */
async function staticFile(
  dir: string,
  name: string,
  set: { status?: number | string },
) {
  const file = Bun.file(join(PUBLIC_DIR, dir, name));
  if (!(await file.exists())) {
    set.status = 404;
    return "Not Found";
  }
  return file;
}

async function ensureGoogleConnectivity(): Promise<void> {
  try {
    const response = await httpGet(GOOGLE_CONNECTIVITY_URL, {
      signal: AbortSignal.timeout(GOOGLE_CONNECTIVITY_TIMEOUT_MS),
    });
    if (response.status !== 204) {
      throw new Error(`unexpected HTTP status ${response.status}`);
    }
    console.log("Google connectivity check passed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Google is not accessible: ${message}`);
    process.exit(1);
  }
}

function manifestLocale(query: Record<string, string | undefined>): Locale {
  return parseLocale(query.locale ?? query.lang) ?? DEFAULT_LOCALE;
}

let adminPassword: string;
try {
  adminPassword = requireAdminPassword();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

await ensureGoogleConnectivity();
try {
  await loadAppConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[config] ${message}`);
  console.error("[config] Fix or remove config.json and restart; it was not modified.");
  process.exit(1);
}
{
  const { prompt, enabled, keywords, sources } = getFilterConfig();
  console.log(
    `[filter] config loaded enabled=${enabled} promptChars=${prompt.trim().length} keywordChars=${keywords.trim().length} sources=${sources.length}`,
  );
}
{
  const { enabled, targetLang } = getTranslateConfig();
  console.log(
    `[translate] config loaded enabled=${enabled} targetLang=${targetLang}`,
  );
}
{
  const { enabled, windowDays, minSimilarity, maxCandidates } = getDedupState();
  console.log(
    `[dedup] config loaded enabled=${enabled} windowDays=${windowDays} minSimilarity=${minSimilarity} maxCandidates=${maxCandidates}`,
  );
}
console.log(`[fever] config loaded enabled=${isFeverEnabled()}`);
{
  const { stopwords } = getTokenizerState();
  const { updated, full } = syncTitleTokens();
  console.log(
    `[tokenizer] config loaded stopwords=${stopwords.length} titleTokensUpdated=${updated}${full ? " (full resync)" : ""}`,
  );
}

const BIND_HOST = resolveHost();

const adminAuth = {
  required: true,
  password: adminPassword,
};

const restRoutes = new Elysia()
  .use(itemsRoutes)
  .use(feedsRoutes)
  .use(filterRoutes)
  .use(translateRoutes)
  .use(dedupRoutes)
  .use(feverRoutes)
  .use(mcpConfigRoutes);

const protectedBackendRoutes = new Elysia()
  .use(withAdminAuth(restRoutes, adminAuth))
  .use(withMcpAccess(mcpRoutes));

async function feverGet(ctx: {
  request: Request;
  query: Record<string, string | undefined>;
  set: { status?: number | string; headers: Record<string, unknown> };
  server?: { requestIP(request: Request): { address: string } | null } | null;
}) {
  if (!isFeverApiQuery(ctx.query)) {
    return indexHtml();
  }
  return handleFeverRequest(ctx);
}

async function feverPost(ctx: {
  request: Request;
  query: Record<string, string | undefined>;
  body?: unknown;
  set: { status?: number | string; headers: Record<string, unknown> };
  server?: { requestIP(request: Request): { address: string } | null } | null;
}) {
  return handleFeverRequest(ctx);
}

const publicRoutes = new Elysia()
  .onParse(async ({ request }, contentType) => {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(await request.text()));
    }
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const params: Record<string, string> = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") params[key] = value;
      }
      return params;
    }
  })
  .get("/", indexHtml)
  .get("/feeds", indexHtml)
  .get("/settings", indexHtml)
  .get("/filter", indexHtml)
  .get("/filters", ({ redirect }) => redirect("/settings"))
  .get("/translate", indexHtml)
  .get("/dedup", indexHtml)
  .get("/export", indexHtml)
  .get("/fever", feverGet)
  .get("/fever/", feverGet)
  .get("/mcp-settings", indexHtml)
  .post("/fever", feverPost)
  .post("/fever/", feverPost)
  .get("/manifest.webmanifest", ({ query, set }) => {
    set.headers["content-type"] = "application/manifest+json; charset=utf-8";
    return JSON.stringify(buildWebManifest(manifestLocale(query)));
  })
  .get("/sw.js", serviceWorker)
  .get("/icons/*", ({ params, set }) => staticFile("icons", params["*"], set))
  .get("/assets/*", ({ params, set }) => staticFile("assets", params["*"], set))
  .use(createAuthRoutes(adminAuth))
  .use(protectedBackendRoutes);

const app = new Elysia()
  .onRequest(applySecurityHeaders)
  // Elysia answers an unhandled exception with its message, which can carry
  // filesystem paths or upstream details; log it and reply generically.
  .onError({ as: "global" }, ({ code, error, request, set }) => {
    if (code !== "UNKNOWN" && code !== "INTERNAL_SERVER_ERROR") return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[http] ${request.method} ${new URL(request.url).pathname} failed: ${message}`,
    );
    set.status = 500;
    return { code: 500, message: "Internal Server Error" };
  })
  .use(publicRoutes);

const port = resolvePort();
let tlsFiles: TlsFiles | null;
try {
  tlsFiles = resolveTls();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[listen] ${message}`);
  process.exit(1);
}
try {
  app.listen({
    port,
    hostname: BIND_HOST,
    // Bun's development error page embeds the error message and stack, i.e.
    // filesystem paths, in the response; never serve it.
    development: false,
    // Bodies are read before any credential is checked, so the cap is what an
    // anonymous client can make the server buffer per request.
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    ...(tlsFiles && {
      tls: {
        cert: Bun.file(tlsFiles.certFile),
        key: Bun.file(tlsFiles.keyFile),
      },
    }),
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[listen] failed on ${BIND_HOST}:${port} — another NanoFlux instance may already be running: ${message}`,
  );
  process.exit(1);
}

if (!app.server) {
  console.error(`[listen] failed on ${BIND_HOST}:${port} — server did not start`);
  process.exit(1);
}

console.log(
  `Listening on ${tlsFiles ? "https" : "http"}://${BIND_HOST}:${app.server.port}/ (operator UI/REST require ADMIN_PASSWORD; MCP: local-only unless remote access is enabled in Settings)`,
);
if (!tlsFiles && !isLoopbackHost(BIND_HOST)) {
  console.warn(
    `[listen] HOST=${BIND_HOST} accepts connections from other machines over plain HTTP: the admin password, session cookie, and MCP token travel unencrypted. Set TLS_CERT_FILE and TLS_KEY_FILE to serve HTTPS, put an HTTPS reverse proxy in front, or unset HOST to listen on 127.0.0.1 only.`,
  );
}

// Start cron only after we own the listen port, so a failed bind cannot leave
// orphan fetchers writing to the same SQLite database.
try {
  await startScheduler();
} catch (error) {
  console.error("[scheduler]", error);
  process.exit(1);
}

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) {
    process.exit(1);
    return;
  }
  shuttingDown = true;
  console.log(`\n${signal} received, shutting down...`);

  await stopScheduler();
  await app.stop();
  closeDatabase();

  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
