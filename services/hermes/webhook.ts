import { createHmac, randomUUID } from "node:crypto";
import { getHermesState } from "../../config";
import { htmlToPlainText } from "../../utils/html";
import { httpPost } from "../http-fetcher";

const REQUEST_TIMEOUT_MS = 10_000;
/** Hermes caps bodies at 1 MB by default; 10 items with this summary stay far below. */
const SUMMARY_MAX_CHARS = 1000;

export type HermesItem = {
  id: number;
  title: string;
  link: string;
  source: string;
  cover: string | null;
  published_at: string;
  content: string | null;
  status: string;
  sim_id: number | null;
};

type HermesPayload = {
  event_type: string;
  feed?: { id: number; title: string };
  items: {
    id: number;
    title: string;
    link: string;
    source: string;
    cover: string | null;
    published_at: string;
    summary: string;
  }[];
};

// Deliveries run one at a time so a busy tick does not trip the Hermes
// per-route rate limit (30 requests/minute by default) in a burst.
let queue: Promise<void> = Promise.resolve();

/**
 * Generic V2 signature: HMAC-SHA256 hex of `<timestamp>.<body>`, with the
 * timestamp in Unix seconds. Hermes rejects timestamps more than 300 s off.
 */
function signatureHeaders(secret: string, body: string): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return {
    "X-Webhook-Timestamp": timestamp,
    "X-Webhook-Signature-V2": signature,
  };
}

async function deliver(url: string, secret: string, payload: HermesPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const response = await httpPost(url, {
    body,
    headers: {
      "Content-Type": "application/json",
      // Hermes skips a repeated delivery id for an hour.
      "X-Request-ID": randomUUID(),
      ...signatureHeaders(secret, body),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
}

function toPayloadItem(item: HermesItem): HermesPayload["items"][number] {
  return {
    id: item.id,
    title: item.title,
    link: item.link,
    source: item.source,
    cover: item.cover,
    published_at: item.published_at,
    summary: item.content ? htmlToPlainText(item.content).slice(0, SUMMARY_MAX_CHARS) : "",
  };
}

/**
 * Queue newly stored items for Hermes. Only passed first reports are sent;
 * rejected items and duplicates of an earlier report are skipped. Never
 * throws: a failed delivery is logged and the fetch carries on.
 */
export function pushItemsToHermes(feed: { id: number; title: string }, items: HermesItem[]): void {
  const { enabled, url, secret } = getHermesState();
  if (!enabled || !url || !secret) return;

  const fresh = items.filter((item) => item.status === "passed" && item.sim_id === null);
  if (fresh.length === 0) return;

  const payload: HermesPayload = {
    event_type: "nanoflux.items.created",
    feed: { id: feed.id, title: feed.title },
    items: fresh.map(toPayloadItem),
  };
  queue = queue.then(async () => {
    try {
      await deliver(url, secret, payload);
      console.log(`[hermes] ${feed.title}: pushed ${fresh.length} item(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[hermes] ${feed.title}: push failed: ${message}`);
    }
  });
}

/** Send a test event with the saved settings; throws when delivery fails. */
export async function sendHermesTest(): Promise<void> {
  const { url, secret } = getHermesState();
  if (!url || !secret) {
    throw new Error("Save a Hermes webhook URL and secret first");
  }
  await deliver(url, secret, {
    event_type: "nanoflux.test",
    items: [
      {
        id: 0,
        title: "NanoFlux webhook test",
        link: "https://example.com/",
        source: "example.com",
        cover: null,
        published_at: new Date().toISOString(),
        summary: "This is a test event sent from NanoFlux settings.",
      },
    ],
  });
}
