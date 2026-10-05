import {
  getFilterConfig,
  getFilterPrompt,
  hasFilterPrompt,
  hasKeywordFilter,
  hasSourceFilter,
} from "../../filter";
import { applyAiFilter } from "./ai";

type ItemFilterResult = {
  status: "passed" | "rejected";
  status_reason: string | null;
};

/**
 * Apply the single AI filter.
 * Disabled or empty prompt skips filtering (`status = passed`, `status_reason` null).
 * Enabled with a prompt returns a rejection status and reason when appropriate.
 */
async function applyItemFilter(
  title: string,
  content: string | null,
): Promise<ItemFilterResult> {
  if (!hasFilterPrompt()) {
    return { status: "passed", status_reason: null };
  }
  const prompt = getFilterPrompt().trim();

  const result = await applyAiFilter(title, content, prompt);
  if (!result.passed) {
    return {
      status: "rejected",
      status_reason: result.reason?.trim() || null,
    };
  }

  return { status: "passed", status_reason: null };
}

function matchingKeyword(title: string): string | null {
  if (!hasKeywordFilter()) return null;
  const keywords = getFilterConfig().keywords
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const normalizedTitle = title.toLocaleLowerCase();
  return (
    keywords.find((keyword) =>
      normalizedTitle.includes(keyword.toLocaleLowerCase()),
    ) ?? null
  );
}

function matchingSource(source: string | undefined): string | null {
  if (!hasSourceFilter() || !source) return null;
  const normalizedSource = source.trim().toLocaleLowerCase();
  return getFilterConfig().sources.includes(normalizedSource)
    ? normalizedSource
    : null;
}

/**
 * Source and title-keyword checks, which need no network or LLM. Returns the
 * rejection for a matching item, or null when the item should go on.
 */
export function ruleRejection(item: {
  title: string;
  source?: string;
}): ItemFilterResult | null {
  const source = matchingSource(item.source);
  if (source) {
    return { status: "rejected", status_reason: `Source filter: ${source}` };
  }
  const keyword = matchingKeyword(item.title);
  if (keyword) {
    return { status: "rejected", status_reason: `Keyword filter: ${keyword}` };
  }
  return null;
}

/** Split items into rule rejections (with their verdict) and items to keep. */
export function partitionByRules<T extends { title: string; source?: string }>(
  items: T[],
): [rejected: (T & ItemFilterResult)[], kept: T[]] {
  const rejected: (T & ItemFilterResult)[] = [];
  const kept: T[] = [];
  for (const item of items) {
    const rule = ruleRejection(item);
    if (rule) rejected.push({ ...item, ...rule });
    else kept.push(item);
  }
  return [rejected, kept];
}

export async function filterItems<
  T extends { title: string; content: string | null; source?: string },
>(items: T[]): Promise<(T & ItemFilterResult)[]> {
  if (items.length === 0) return [];

  const keywordActive = hasKeywordFilter();
  const sourceActive = hasSourceFilter();
  const aiActive = hasFilterPrompt();
  if (!sourceActive && !keywordActive && !aiActive) {
    console.log(
      `[filter] inactive — skip AI for ${items.length} item(s) (status_reason stays null)`,
    );
    return items.map((item) => ({
      ...item,
      status: "passed" as const,
      status_reason: null,
    }));
  }

  console.log(
    `[filter] source=${sourceActive ? "on" : "off"} keyword=${keywordActive ? "on" : "off"} AI=${aiActive ? "on" : "off"} for ${items.length} item(s)`,
  );
  const filtered: (T & ItemFilterResult)[] = [];
  let passed = 0;
  let rejected = 0;
  let keywordRejected = 0;
  let sourceRejected = 0;
  for (const item of items) {
    const rule = ruleRejection(item);
    if (rule) {
      rejected += 1;
      if (rule.status_reason?.startsWith("Source")) sourceRejected += 1;
      else keywordRejected += 1;
      filtered.push({ ...item, ...rule });
      continue;
    }
    const verdict = await applyItemFilter(item.title, item.content);
    if (verdict.status === "rejected") rejected += 1;
    else passed += 1;
    filtered.push({ ...item, ...verdict });
  }
  console.log(
    `[filter] done passed=${passed} rejected=${rejected} sourceRejected=${sourceRejected} keywordRejected=${keywordRejected}`,
  );
  return filtered;
}
