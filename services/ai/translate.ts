import { chatCompletion } from "./client";

/**
 * Translate `text` into `targetLang` (a language name, e.g. "Simplified
 * Chinese") with the configured LLM. Throws when the LLM is not configured or
 * the request fails.
 */
export async function translate(
  text: string,
  targetLang: string,
): Promise<string> {
  if (!text.trim()) return text;

  const system =
    `You are a translator. Translate the user's text into ${targetLang} accurately and naturally. ` +
    "Keep brand names, tickers, and numbers unchanged; use the established local name for well-known people, places, and organizations. " +
    "Reply with the translation only — no quotes, labels, or explanation.";

  return chatCompletion(system, text);
}
