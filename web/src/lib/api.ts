import { localeState } from "./locale.svelte";

export type FeedSort = "updated_desc" | "published_desc" | "published_asc";

export type Feed = {
  id: number;
  title: string;
  url: string;
  description: string | null;
  last_published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: number;
  feed_id: number;
  guid: string;
  title: string;
  link: string;
  source: string;
  content: string | null;
  cover: string | null;
  published_at: string;
  is_read: boolean;
  feed_title: string;
  /** Id of the first report this item duplicates; null for a first report. */
  sim_id: number | null;
  /** Visible duplicates of this item when it is a first report. */
  duplicate_count: number;
};

export type ItemsPage = {
  data: Item[];
  nextCursor: string | null;
  hasMore: boolean;
};

type RawItem = Omit<Item, "is_read"> & {
  is_read: boolean | number;
};

type ItemsApiResult = {
  code: number;
  message: string;
  data?: {
    items: RawItem[];
    nextCursor: string | null;
    hasMore: boolean;
  };
};

type ApiResult = {
  code: number;
  message: string;
};

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

function assertApiOk(body: ApiResult): void {
  if (body.code !== 0) {
    throw new Error(body.message || "Request failed");
  }
}

export function normalizeItem(raw: RawItem): Item {
  return {
    ...raw,
    is_read: Boolean(raw.is_read),
  };
}

export type FeedsPage = {
  data: Feed[];
  nextCursor: string | null;
  hasMore: boolean;
};

type FeedsApiResult = {
  code: number;
  message: string;
  data?: {
    feeds: Feed[];
    hasMore: boolean;
    nextCursor: string | null;
  };
};

async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    notifyUnauthorized();
  }
  if (!res.ok) {
    const message =
      (body as { error?: string; message?: string }).error ??
      (body as { message?: string }).message;
    throw new Error(message || `Request failed (${res.status})`);
  }
  return body as T;
}

export async function fetchItemsPage(
  cursor?: string,
  limit = 20,
  isRead?: 0 | 1,
): Promise<ItemsPage> {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (cursor) params.set("cursor", cursor);
  if (isRead === 0 || isRead === 1) params.set("is_read", String(isRead));
  const body = await request<ItemsApiResult>(`/api/items?${params}`);
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load items");
  }
  return {
    data: body.data.items.map(normalizeItem),
    nextCursor: body.data.nextCursor,
    hasMore: body.data.hasMore,
  };
}

export async function fetchFeedsPage(
  cursor?: string,
  limit = 20,
  keyword?: string,
  sort: FeedSort = "updated_desc",
): Promise<FeedsPage> {
  const params = new URLSearchParams({ limit: String(limit), sort });
  if (cursor) params.set("cursor", cursor);
  if (keyword) params.set("keyword", keyword);
  const body = await request<FeedsApiResult>(`/api/feeds?${params}`);
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load feeds");
  }
  return {
    data: body.data.feeds,
    nextCursor: body.data.nextCursor,
    hasMore: body.data.hasMore,
  };
}

export function previewFeed(url: string) {
  const params = new URLSearchParams({ url });
  return request<{ data: { title: string; description: string | null } }>(
    `/api/feeds/meta?${params}`, { 
      method: "POST",
      body: JSON.stringify({ url }),
    }
  );
}

export type WechatAccount = {
  fakeid: string;
  nickname: string;
  alias: string;
  round_head_img: string;
  service_type: number;
  subscribed?: boolean;
  rss_url?: string | null;
};

export async function searchWechatAccounts(
  query: string,
): Promise<WechatAccount[]> {
  const params = new URLSearchParams({ query: query.trim() });
  const body = await request<{
    code: number;
    message: string;
    data?: { accounts: WechatAccount[] };
  }>(`/api/feeds/wechat/accounts?${params}`);
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to search WeChat accounts");
  }
  return body.data.accounts;
}

export async function resolveWechatFeed(account: {
  fakeid: string;
  nickname: string;
  alias?: string;
  head_img?: string;
}): Promise<{ title: string; url: string; description: string | null }> {
  const body = await request<{
    code: number;
    message: string;
    data?: { title: string; url: string; description: string | null };
  }>("/api/feeds/wechat/resolve", {
    method: "POST",
    body: JSON.stringify(account),
  });
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to resolve WeChat feed");
  }
  return body.data;
}

export function createFeed(payload: {
  title: string;
  url: string;
  description: string | null;
}) {
  return request<{ data: Feed }>("/api/feeds/create", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateFeed(
  id: number,
  payload: { 
    title: string; 
    url: string;
    description: string | null },
) {
  return request<{ data: Feed }>(`/api/feeds/${id}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteFeed(id: number) {
  return request<{ success: boolean }>(`/api/feeds/${id}/delete`, {
    method: "POST",
  });
}

export async function downloadFeedsOpml(): Promise<void> {
  const res = await fetch("/api/feeds/export.opml", {
    credentials: "same-origin",
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nanoflux.opml";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadItemsExcel(options: {
  since?: string;
  until?: string;
}): Promise<void> {
  const params = new URLSearchParams();
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  params.set("tz_offset", String(new Date().getTimezoneOffset()));
  params.set("lang", localeState.locale);

  const res = await fetch(`/api/items/export.xlsx?${params}`, {
    credentials: "same-origin",
  });
  if (res.status === 401) notifyUnauthorized();
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "nanoflux-export.xlsx";
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function markAllItemsRead(until: string) {
  if (!until) {
    throw new Error("Missing until timestamp");
  }
  const body = await request<ApiResult>("/api/items/read-all", {
    method: "POST",
    body: JSON.stringify({ until }),
  });
  assertApiOk(body);
}

/** One member of a duplicate cluster; the first report has `sim_id === null`. */
export type ClusterItem = Pick<
  Item,
  "id" | "title" | "link" | "source" | "published_at" | "is_read" | "feed_title" | "sim_id"
>;

/** The first report and duplicates of an item's cluster, newest first. */
export async function fetchItemCluster(id: number): Promise<ClusterItem[]> {
  const body = await request<{
    code: number;
    message: string;
    data?: (Omit<ClusterItem, "is_read"> & { is_read: number | boolean })[];
  }>(`/api/items/${id}/cluster`);
  assertApiOk(body);
  return (body.data ?? []).map((item) => ({ ...item, is_read: Boolean(item.is_read) }));
}

export async function markItemRead(id: number) {
  const body = await request<ApiResult>(`/api/items/${id}/read`, {
    method: "POST",
  });
  assertApiOk(body);
}

export async function blockSource(source: string): Promise<{ deleted: number }> {
  const body = await request<{
    code: number;
    message: string;
    data?: { deleted: number };
  }>("/api/items/block-source", {
    method: "POST",
    body: JSON.stringify({ source }),
  });
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to block source");
  }
  return body.data;
}

export type FilterConfig = {
  prompt: string;
  enabled: boolean;
  keywords: string;
  sources: string[];
};

type FilterApiResult = {
  code: number;
  message: string;
  data?: Partial<FilterConfig>;
};

function normalizeFilterConfig(
  data: Partial<FilterConfig> | undefined,
  defaults?: Partial<FilterConfig>,
): FilterConfig {
  const prompt =
    typeof data?.prompt === "string" ? data.prompt : (defaults?.prompt ?? "");
  const keywords =
    typeof data?.keywords === "string"
      ? data.keywords
      : (defaults?.keywords ?? "");
  const sources = Array.isArray(data?.sources)
    ? data.sources.filter((source): source is string => typeof source === "string")
    : (defaults?.sources ?? []);
  return {
    prompt,
    keywords,
    sources,
    enabled:
      typeof data?.enabled === "boolean"
        ? data.enabled
        : typeof defaults?.enabled === "boolean"
          ? defaults.enabled
          : false,
  };
}

export async function fetchFilter(): Promise<FilterConfig> {
  const body = await request<FilterApiResult>("/api/filter");
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load filter");
  }
  return normalizeFilterConfig(body.data);
}

export function updateFilter(payload: {
  prompt?: string;
  enabled?: boolean;
  keywords?: string;
  sources?: string[];
}) {
  return request<FilterApiResult>("/api/filter", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((body) => {
    assertApiOk(body);
    if (!body.data) {
      throw new Error(body.message || "Failed to update filter");
    }
    return normalizeFilterConfig(body.data, payload);
  });
}

export type TranslateTargetLang = "en" | "zh-Hans" | "zh-Hant";

export const TRANSLATE_TARGET_LANGS: TranslateTargetLang[] = [
  "en",
  "zh-Hans",
  "zh-Hant",
];

function parseTranslateTargetLang(
  value: unknown,
): TranslateTargetLang | null {
  if (value === "zh") return "zh-Hans";
  if (value === "en" || value === "zh-Hans" || value === "zh-Hant") {
    return value;
  }
  return null;
}

export type TranslateConfig = {
  enabled: boolean;
  targetLang: TranslateTargetLang;
};

type TranslateApiResult = {
  code: number;
  message: string;
  data?: Partial<TranslateConfig>;
};

function normalizeTranslateConfig(
  data: Partial<TranslateConfig> | undefined,
  defaults?: Partial<TranslateConfig>,
): TranslateConfig {
  const targetLang: TranslateTargetLang =
    parseTranslateTargetLang(data?.targetLang) ??
    parseTranslateTargetLang(defaults?.targetLang) ??
    "zh-Hans";
  return {
    enabled:
      typeof data?.enabled === "boolean"
        ? data.enabled
        : typeof defaults?.enabled === "boolean"
          ? defaults.enabled
          : false,
    targetLang,
  };
}

export async function fetchTranslate(): Promise<TranslateConfig> {
  const body = await request<TranslateApiResult>("/api/translate");
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load translate config");
  }
  return normalizeTranslateConfig(body.data);
}

export function updateTranslate(payload: {
  enabled?: boolean;
  targetLang?: TranslateTargetLang;
}) {
  return request<TranslateApiResult>("/api/translate", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((body) => {
    assertApiOk(body);
    if (!body.data) {
      throw new Error(body.message || "Failed to update translate config");
    }
    return normalizeTranslateConfig(body.data, payload);
  });
}

export type DedupConfig = {
  enabled: boolean;
  windowDays: number;
  minSimilarity: number;
  maxCandidates: number;
};

type DedupApiResult = {
  code: number;
  message: string;
  data?: DedupConfig;
};

export async function fetchDedup(): Promise<DedupConfig> {
  const body = await request<DedupApiResult>("/api/dedup");
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load dedup config");
  }
  return body.data;
}

export function updateDedup(payload: Partial<DedupConfig>) {
  return request<DedupApiResult>("/api/dedup", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((body) => {
    assertApiOk(body);
    if (!body.data) {
      throw new Error(body.message || "Failed to update dedup config");
    }
    return body.data;
  });
}

export type FeverConfig = {
  enabled: boolean;
  user: string;
  hasPassword: boolean;
};

type FeverApiResult = {
  code: number;
  message: string;
  data?: Partial<FeverConfig>;
};

function normalizeFeverConfig(
  data: Partial<FeverConfig> | undefined,
  defaults?: Partial<FeverConfig>,
): FeverConfig {
  return {
    enabled:
      typeof data?.enabled === "boolean"
        ? data.enabled
        : typeof defaults?.enabled === "boolean"
          ? defaults.enabled
          : false,
    user: typeof data?.user === "string" ? data.user : (defaults?.user ?? ""),
    hasPassword:
      typeof data?.hasPassword === "boolean"
        ? data.hasPassword
        : typeof defaults?.hasPassword === "boolean"
          ? defaults.hasPassword
          : false,
  };
}

export async function fetchFever(): Promise<FeverConfig> {
  const body = await request<FeverApiResult>("/api/fever");
  assertApiOk(body);
  if (!body.data) {
    throw new Error(body.message || "Failed to load fever config");
  }
  return normalizeFeverConfig(body.data);
}

export function updateFever(payload: {
  enabled?: boolean;
  user?: string;
  password?: string;
}) {
  return request<FeverApiResult>("/api/fever", {
    method: "POST",
    body: JSON.stringify(payload),
  }).then((body) => {
    assertApiOk(body);
    if (!body.data) {
      throw new Error(body.message || "Failed to update fever config");
    }
    return normalizeFeverConfig(body.data, {
      enabled: payload.enabled,
      user: payload.user,
      hasPassword: Boolean(payload.password) || undefined,
    });
  });
}

export type McpConfig = {
  remoteAccess: boolean;
  hasAuthorization: boolean;
  authorization?: string;
};

type McpApiResult = {
  code: number;
  message: string;
  data?: Partial<McpConfig>;
};

function normalizeMcpConfig(data: Partial<McpConfig> | undefined): McpConfig {
  return {
    remoteAccess: Boolean(data?.remoteAccess),
    hasAuthorization: Boolean(data?.hasAuthorization),
    authorization: typeof data?.authorization === "string" ? data.authorization : undefined,
  };
}

export async function fetchMcp(): Promise<McpConfig> {
  const body = await request<McpApiResult>("/api/mcp");
  assertApiOk(body);
  return normalizeMcpConfig(body.data);
}

export async function updateMcp(payload: {
  remoteAccess?: boolean;
  authorization?: string;
}): Promise<McpConfig> {
  const body = await request<McpApiResult>("/api/mcp", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  assertApiOk(body);
  return normalizeMcpConfig(body.data);
}

export async function generateMcpToken(): Promise<string> {
  const body = await request<{
    code: number;
    message: string;
    data?: { authorization?: string };
  }>("/api/mcp/generate-token", { method: "POST" });
  assertApiOk(body);
  if (!body.data?.authorization) throw new Error("Failed to generate MCP token");
  return body.data.authorization;
}

export async function fetchMcpEndpoint(): Promise<string> {
  const body = await request<{
    code: number;
    message: string;
    data?: { endpoint?: string };
  }>("/api/mcp/endpoint");
  assertApiOk(body);
  if (!body.data?.endpoint) throw new Error("Failed to resolve MCP endpoint");
  return body.data.endpoint;
}

export type AuthStatus = {
  required: boolean;
  authenticated: boolean;
};

type AuthApiResult = {
  code: number;
  message: string;
  data?: Partial<AuthStatus>;
};

function normalizeAuthStatus(data: Partial<AuthStatus> | undefined): AuthStatus {
  return {
    required: Boolean(data?.required),
    authenticated: Boolean(data?.authenticated),
  };
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const body = await request<AuthApiResult>("/api/auth/status");
  assertApiOk(body);
  return normalizeAuthStatus(body.data);
}

export async function loginAdmin(password: string): Promise<AuthStatus> {
  const body = await request<AuthApiResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  assertApiOk(body);
  return normalizeAuthStatus(body.data);
}

export async function logoutAdmin(): Promise<AuthStatus> {
  const body = await request<AuthApiResult>("/api/auth/logout", {
    method: "POST",
  });
  assertApiOk(body);
  return normalizeAuthStatus(body.data);
}
