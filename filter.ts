import {
  getFilterState,
  loadAppConfig,
  updateFilterState,
  type FilterConfig,
} from "./config";

export type { FilterConfig };

export async function loadFilters(): Promise<void> {
  await loadAppConfig();
}

export function getFilterConfig(): FilterConfig {
  return getFilterState();
}

/** Whether AI filtering is active (enabled, with a question or criteria set). */
export function hasAiFilter(): boolean {
  const { question, keepCriteria, rejectCriteria, enabled } = getFilterState();
  return (
    enabled &&
    [question, keepCriteria, rejectCriteria].some((text) => text.trim().length > 0)
  );
}

/** Split a comma-separated keyword setting into trimmed, non-empty keywords. */
export function parseKeywords(raw: string): string[] {
  return raw
    .split(/[,，]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

/** Whether title blocklist filtering is active under the shared filter switch. */
export function hasKeywordFilter(): boolean {
  const { blockKeywords, enabled } = getFilterState();
  return enabled && parseKeywords(blockKeywords).length > 0;
}

/** Whether the title allowlist is active under the shared filter switch. */
export function hasAllowKeywords(): boolean {
  const { allowKeywords, enabled } = getFilterState();
  return enabled && parseKeywords(allowKeywords).length > 0;
}

/** Whether source filtering is active under the shared filter switch. */
export function hasSourceFilter(): boolean {
  const { sources, enabled } = getFilterState();
  return enabled && sources.length > 0;
}

export async function updateFilterConfig(partial: {
  question?: string;
  keepCriteria?: string;
  rejectCriteria?: string;
  enabled?: boolean;
  allowKeywords?: string;
  blockKeywords?: string;
  sources?: string[];
}): Promise<FilterConfig> {
  return updateFilterState(partial);
}
