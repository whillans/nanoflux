import { getDedupState, getTokenizerState, type DedupConfig } from "../../config";
import { addItems, getDedupCandidates, getDedupNews } from "../../db/items";
import { TimeUnit } from "../../db/utils";
import { splitTokens, tokensSimilarity } from "../../utils/similarity";
import { titleTokens } from "../../utils/text";
import { getAiConfig } from "../ai/client";
import { applyAiDedup, MAX_CONTENT_CHARS } from "./ai";

type NewItem = Parameters<typeof addItems>[1][number];

/**
 * Stored items that the LLM confirms as the same news. Candidates share a
 * title token, are published within `windowDays`, and score > `minSimilarity`.
 */
async function findDuplicateIds(
  item: NewItem,
  stopwords: ReadonlySet<string>,
  settings: DedupConfig,
): Promise<number[]> {
  const tokens = splitTokens(titleTokens(item.title, stopwords));
  if (tokens.length === 0) return [];
  const tokenSet = new Set(tokens);

  const ranked = getDedupCandidates(item.published_at, settings.windowDays * TimeUnit.DAY)
    .map(({ id, title_tokens }) => ({ id, candidateTokens: splitTokens(title_tokens) }))
    .filter(({ candidateTokens }) => candidateTokens.some((token) => tokenSet.has(token)))
    .map(({ id, candidateTokens }) => ({
      id,
      similarity: tokensSimilarity(tokens, candidateTokens),
    }))
    .filter(({ similarity }) => similarity > settings.minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, settings.maxCandidates);
  if (ranked.length === 0) return [];

  // Load text only for the top candidates, in rank order. The raw prefix is
  // twice the prompt budget since whitespace is collapsed before truncation.
  const newsById = new Map(
    getDedupNews(ranked.map(({ id }) => id), MAX_CONTENT_CHARS * 2)
      .map((news) => [news.id, news]),
  );
  const candidates = ranked.flatMap(({ id }) => newsById.get(id) ?? []);
  if (candidates.length === 0) return [];

  const confirmed = await applyAiDedup(item, candidates);
  const ids = confirmed.map((index) => candidates[index]!.id);
  console.log(
    `[dedup] "${item.title.slice(0, 40)}" candidates=${ranked.map(({ similarity }) => similarity.toFixed(2)).join(",")} duplicates=${ids.join(",") || "none"}`,
  );
  return ids;
}

/**
 * Insert items one at a time so each sees earlier items of the same batch.
 * Passed items go through duplicate detection first; duplicates get `sim_id`
 * pointing at the first-published item of their cluster.
 */
export async function addItemsWithDedup(feedId: number, newItems: NewItem[]): Promise<any[]> {
  if (newItems.length === 0) return [];

  const settings = getDedupState();
  const aiActive = settings.enabled && getAiConfig() !== null;
  if (settings.enabled && !aiActive) {
    console.warn("[dedup] LLM_BASE_URL/LLM_API_KEY/LLM_MODEL_NAME missing; skipping duplicate detection");
  }
  const stopwords = new Set(getTokenizerState().stopwords);

  const inserted: any[] = [];
  for (const item of newItems) {
    const duplicate_ids = aiActive && item.status === "passed"
      ? await findDuplicateIds(item, stopwords, settings)
      : [];
    inserted.push(...addItems(feedId, [{ ...item, duplicate_ids }]));
  }
  return inserted;
}
