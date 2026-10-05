import { noul } from "system-one-adapter";
import { getAiConfig, systemOne } from "../ai/client";

const MAX_CONTENT_CHARS = 3000;
/** Probability that the news matches the criteria, at or above which it is kept. */
const PASS_THRESHOLD = 0.5;

type AiFilterResult = {
  passed: boolean;
  reason: string | null;
};

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

  try {
    const { pass } = await systemOne(
      { title, content: bodyContent || "(empty)" },
      {
        pass: noul(
          ["Does the news match the user criteria?", "", "Criteria:", trimmedPrompt].join("\n"),
        ),
      },
    );

    const passed = pass.noul >= PASS_THRESHOLD;
    return {
      passed,
      reason: passed ? null : `AI filter: match probability ${pass.noul.toFixed(2)}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ai-filter] ${message}`);
    return passThrough();
  }
}
