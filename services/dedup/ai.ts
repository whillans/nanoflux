import { noul, type NoulQuestion } from "system-one-adapter";
import { getAiConfig, systemOne } from "../ai/client";

export const MAX_CONTENT_CHARS = 300;
/** Probability of reporting the same news above which a candidate is a duplicate. */
const DUPLICATE_THRESHOLD = 0.5;

export type DedupNews = {
  title: string;
  content: string | null;
  published_at: string;
};

function describe(news: DedupNews) {
  const snippet = (news.content ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT_CHARS);
  return {
    title: news.title,
    published: news.published_at,
    summary: snippet || "(empty)",
  };
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

  // One yes/no question per candidate, keyed like the candidate in the state.
  const labels = candidates.map((_, index) => `candidate_${index + 1}`);
  const questions: Record<string, NoulQuestion> = {};
  const candidateState: Record<string, ReturnType<typeof describe>> = {};
  candidates.forEach((candidate, index) => {
    const label = labels[index]!;
    candidateState[label] = describe(candidate);
    questions[label] = noul(
      `Does ${label} report the same event or story as new_news, ` +
        "even if worded differently, translated, or from another outlet?",
      {
        true: "Reports the same event or story.",
        false: "Unrelated, or related but about a different event.",
      },
    );
  });

  try {
    const answers = await systemOne(
      { new_news: describe(news), candidates: candidateState },
      questions,
    );
    return labels
      .map((_, index) => index)
      .filter((index) => (answers[labels[index]!]?.noul ?? 0) > DUPLICATE_THRESHOLD);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-dedup] ${message}`);
    return [];
  }
}
