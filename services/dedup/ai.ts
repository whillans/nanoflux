import { z } from "zod";
import { chatCompletionJson, getAiConfig } from "../ai/client";

export const MAX_CONTENT_CHARS = 300;

export type DedupNews = {
  title: string;
  content: string | null;
  published_at: string;
};

function describe(news: DedupNews): string {
  const snippet = (news.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS);
  return [
    `Title: ${news.title}`,
    `Published: ${news.published_at}`,
    `Summary: ${snippet || "(empty)"}`,
  ].join("\n");
}

const DuplicatesSchema = z.object({
  duplicates: z.array(z.number()),
});

/** Keep 1-based candidate numbers that are integers within range, deduplicated. */
function normalizeDuplicates(values: number[], count: number): number[] {
  return [
    ...new Set(
      values.filter((value) => Number.isInteger(value) && value >= 1 && value <= count),
    ),
  ];
}

/**
 * Ask the LLM which candidates report the same news as `news`.
 * Returns 0-based candidate indexes. Fail-open: errors mean no duplicates.
 */
export async function applyAiDedup(
  news: DedupNews,
  candidates: DedupNews[],
): Promise<number[]> {
  if (candidates.length === 0 || !getAiConfig()) return [];

  const userMessage = [
    "New news:",
    describe(news),
    "",
    "Candidates:",
    ...candidates.map((candidate, index) => `[${index + 1}]\n${describe(candidate)}`),
  ].join("\n");

  try {
    const { duplicates } = await chatCompletionJson(
      "You are a news deduplicator. A candidate is a duplicate when it reports the same event or story as the new news, " +
        "even if worded differently, translated, or from another outlet. Related but different events are not duplicates. " +
        'Reply with JSON only: {"duplicates": number[]} listing the candidate numbers that are duplicates (empty when none).',
      userMessage,
      DuplicatesSchema,
      "news_dedup_verdict",
    );
    return normalizeDuplicates(duplicates, candidates.length).map((value) => value - 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-dedup] ${message}`);
    return [];
  }
}
