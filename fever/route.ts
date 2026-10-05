import { timingSafeEqual } from "node:crypto";
import { getFeverApiKey } from "../fever";
import {
  FEVER_GROUP_ID,
  FEVER_GROUP_TITLE,
  countFeverItems,
  feverFeedsGroups,
  lastRefreshedOnTime,
  listFeverFeeds,
  listFeverItems,
  listFeverUnreadItemIds,
  markFeverReadState,
} from "../db/fever";
import { checkCredential } from "../shared/admin-auth";
import { clientAddress } from "../shared/localhost-only";

const API_VERSION = 3;

type FeverParams = Record<string, string>;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hasFlag(params: FeverParams, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(params, name);
}

function parsePositiveInt(value: string | undefined): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function isFeverApiQuery(query: Record<string, unknown> | undefined): boolean {
  if (!query) return false;
  return (
    "api" in query ||
    "groups" in query ||
    "feeds" in query ||
    "items" in query ||
    "unread_item_ids" in query ||
    "saved_item_ids" in query ||
    "mark" in query
  );
}

function queryToParams(query: Record<string, unknown> | undefined): FeverParams {
  const params: FeverParams = {};
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params[key] = String(value);
  }
  return params;
}

async function parseBodyParams(request: Request): Promise<FeverParams> {
  if (request.method !== "POST" && request.method !== "PUT") {
    return {};
  }
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const json: unknown = await request.json();
      if (!json || typeof json !== "object" || Array.isArray(json)) return {};
      const params: FeverParams = {};
      for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        params[key] = String(value);
      }
      return params;
    }
    const text = await request.text();
    if (!text) return {};
    if (contentType.includes("multipart/form-data")) {
      return {};
    }
    const form = new URLSearchParams(text);
    const params: FeverParams = {};
    for (const [key, value] of form.entries()) {
      params[key] = value;
    }
    return params;
  } catch {
    return {};
  }
}

function bodyToParams(body: unknown): FeverParams {
  if (!body) return {};
  if (typeof body === "string") {
    const form = new URLSearchParams(body);
    const params: FeverParams = {};
    for (const [key, value] of form.entries()) {
      params[key] = value;
    }
    return params;
  }
  if (typeof body === "object" && !Array.isArray(body)) {
    const params: FeverParams = {};
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      params[key] = String(value);
    }
    return params;
  }
  return {};
}

function applyFeverMark(params: FeverParams): void {
  if (!hasFlag(params, "mark") || !hasFlag(params, "as")) return;
  markFeverReadState({
    mark: params.mark,
    as: params.as,
    id: parsePositiveInt(params.id),
    before: parsePositiveInt(params.before),
  });
}

function buildAuthenticatedPayload(params: FeverParams): Record<string, unknown> {
  applyFeverMark(params);

  const payload: Record<string, unknown> = {
    api_version: API_VERSION,
    auth: 1,
    last_refreshed_on_time: lastRefreshedOnTime(),
  };

  if (hasFlag(params, "groups")) {
    payload.groups = [{ id: FEVER_GROUP_ID, title: FEVER_GROUP_TITLE }];
    payload.feeds_groups = feverFeedsGroups();
  }

  if (hasFlag(params, "feeds")) {
    payload.feeds = listFeverFeeds();
    payload.feeds_groups = feverFeedsGroups();
  }

  if (hasFlag(params, "items")) {
    payload.items = listFeverItems({
      sinceId: parsePositiveInt(params.since_id),
      maxId: parsePositiveInt(params.max_id),
      withIds: params.with_ids,
    });
    payload.total_items = countFeverItems();
  }

  if (hasFlag(params, "unread_item_ids")) {
    payload.unread_item_ids = listFeverUnreadItemIds();
  }

  if (hasFlag(params, "saved_item_ids")) {
    payload.saved_item_ids = "";
  }

  return payload;
}

export async function handleFeverRequest(ctx: {
  request: Request;
  query: Record<string, unknown>;
  body?: unknown;
  set: { status?: number | string; headers: Record<string, unknown> };
  server?: { requestIP(request: Request): { address: string } | null } | null;
}): Promise<Record<string, unknown>> {
  ctx.set.headers["content-type"] = "application/json; charset=utf-8";

  const params = {
    ...queryToParams(ctx.query),
    ...bodyToParams(ctx.body),
    ...(await parseBodyParams(ctx.request)),
  };

  const expected = getFeverApiKey();
  const provided = (params.api_key ?? "").trim().toLowerCase();
  // Nothing to guess at without a key in the request or one configured.
  if (expected === null || provided.length === 0) {
    return { api_version: API_VERSION, auth: 0 };
  }

  const client = clientAddress(
    ctx.request,
    ctx.server?.requestIP(ctx.request)?.address,
  );
  const result = checkCredential("fever", client, safeEqual(provided, expected));
  if (result !== "ok") {
    if (result === "blocked") ctx.set.status = 429;
    return { api_version: API_VERSION, auth: 0 };
  }

  return buildAuthenticatedPayload(params);
}
