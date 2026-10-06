import { chatCompletion } from "./client";

/** The system prompt sent for a translation into `targetLang`. */
export function translateSystemPrompt(targetLang: string): string {
  return (
    `You are a translator. Translate the user's text into ${targetLang} accurately and naturally. ` +
    "Keep brand names, tickers, and numbers unchanged; use the established local name for well-known people, places, and organizations. " +
    "Reply with the translation only — no quotes, labels, or explanation."
  );
}

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

  return chatCompletion(translateSystemPrompt(targetLang), text);
}
