import { z } from "zod";
import { chatCompletionJson, getAiConfig } from "../ai/client";

const MAX_CONTENT_CHARS = 3000;

type AiFilterResult = {
  passed: boolean;
  reason: string | null;
};

const VerdictSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
});

/** Fail-open: keep the item when LLM is unavailable or unparseable. */
function passThrough(): AiFilterResult {
  return { passed: true, reason: null };
}

export async function applyAiFilter(
  title: string,
  content: string | null,
  prompt: string,
): Promise<AiFilterResult> {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    return passThrough();
  }

  if (!getAiConfig()) {
    console.warn(
      "[ai-filter] prompt configured but LLM_BASE_URL/LLM_API_KEY/LLM_MODEL_NAME missing; skipping",
    );
    return passThrough();
  }

  const bodyContent = (content ?? "").slice(0, MAX_CONTENT_CHARS);
  const userMessage = [
    "Criteria:",
    trimmedPrompt,
    "",
    `Title: ${title}`,
    "",
    "Content:",
    bodyContent || "(empty)",
  ].join("\n");

  try {
    const verdict = await chatCompletionJson(
      'You are a news relevance filter. Decide whether the news matches the user criteria. Reply with JSON only: {"pass": boolean, "reason": string}.',
      userMessage,
      VerdictSchema,
      "news_filter_verdict",
    );

    return {
      passed: verdict.pass,
      reason: verdict.reason.trim() || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-filter] ${message}`);
    return passThrough();
  }
}
