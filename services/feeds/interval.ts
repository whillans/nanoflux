import type Parser from "rss-parser";

const MIN_INTERVAL_MIN = 5;
const MAX_INTERVAL_MIN = 30;

export const DEFAULT_FETCH_INTERVAL_MIN = 15;

const FAILURE_BACKOFF_MAX_MIN = 6 * 60;

/** Retry delay after `failures` consecutive failed fetches: 5, 10, 20, … capped at 6h. */
export function failureBackoffMin(failures: number): number {
  const exponent = Math.min(Math.max(failures, 1) - 1, 16);
  return Math.min(FAILURE_BACKOFF_MAX_MIN, MIN_INTERVAL_MIN * 2 ** exponent);
}

function medianPublishGapSec(feedItems: Parser.Item[]): number | null {
  const now = Date.now();
  const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
  const times = feedItems
    .map((entry) => {
      const d = entry.isoDate || entry.pubDate;
      return d ? Date.parse(d) : NaN;
    })
    .filter((t) => !Number.isNaN(t) && now - t <= maxAgeMs)
    .sort((a, b) => b - a);

  const gaps: number[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    gaps.push(times[i]! - times[i + 1]!);
  }
  if (gaps.length === 0) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const medianMs =
    gaps.length % 2 === 0
      ? (gaps[mid - 1]! + gaps[mid]!) / 2
      : gaps[mid]!;
  return Math.round(medianMs / 1000);
}

function clampIntervalMin(minutes: number): number {
  return Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, minutes));
}

export function nextFetchedAtIso(intervalMin: number): string {
  return new Date(Date.now() + intervalMin * 60_000).toISOString();
}

export function nextFetchIntervalMin(
  currentMin: number,
  newItems: number,
  feedItems: Parser.Item[],
): number {
  const medianGapSec = medianPublishGapSec(feedItems);
  let targetMin = currentMin;

  if (medianGapSec !== null) {
    // Poll at roughly one-third of the typical publish interval.
    targetMin = clampIntervalMin(Math.round(medianGapSec / 3 / 60));
  }

  if (newItems > 0) {
    targetMin = Math.min(
      targetMin,
      clampIntervalMin(
        Math.round(currentMin * (newItems >= 2 ? 0.65 : 0.8)),
      ),
    );
  } else {
    targetMin = Math.max(
      targetMin,
      clampIntervalMin(Math.round(currentMin * 1.25)),
    );
  }

  return clampIntervalMin(targetMin);
}
