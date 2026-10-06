import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  hasAiFilter,
  hasKeywordFilter,
  hasSourceFilter,
  updateFilterConfig,
} from "../../filter";

export function registerUpdateFilterConfig(server: McpServer): void {
  server.registerTool(
    "update_filter_config",
    {
      description:
        "Set the news filter for newly fetched articles: source, keyword, and AI filters applied in that order, all controlled by the single `enabled` switch. Source matches are rejected first; titles matching an allow keyword then pass directly; block keyword matches are rejected; the rest go to AI filtering.",
      inputSchema: {
        question: z
          .string()
          .optional()
          .describe(
            "Yes/no question the AI answers about each item, where yes keeps it. Empty string uses the default \"Should this news be kept?\".",
          ),
        keepCriteria: z
          .string()
          .optional()
          .describe("Describes news the AI should keep (the yes outcome)."),
        rejectCriteria: z
          .string()
          .optional()
          .describe(
            "Describes news the AI should reject (the no outcome). AI filtering is skipped when question, keepCriteria, and rejectCriteria are all empty.",
          ),
        enabled: z
          .boolean()
          .optional()
          .describe(
            "Master switch for the source, keyword, and AI filters together. Turning it off keeps every setting and lets all newly fetched items pass.",
          ),
        allowKeywords: z
          .string()
          .optional()
          .describe(
            "Comma-separated title keywords that always pass, skipping the blocklist and AI filtering. Prefer the AI criteria for nuanced filtering.",
          ),
        blockKeywords: z
          .string()
          .optional()
          .describe(
            "Comma-separated title keywords to reject. Prefer the AI criteria for nuanced filtering.",
          ),
        sources: z
          .array(z.string())
          .optional()
          .describe("Source domains to reject before keyword and AI filtering."),
      },
    },
    async ({ question, keepCriteria, rejectCriteria, enabled, allowKeywords, blockKeywords, sources }) => {
      try {
        const updated = await updateFilterConfig({
          question,
          keepCriteria,
          rejectCriteria,
          enabled,
          allowKeywords,
          blockKeywords,
          sources,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  updated: true,
                  question: updated.question,
                  keepCriteria: updated.keepCriteria,
                  rejectCriteria: updated.rejectCriteria,
                  enabled: updated.enabled,
                  allowKeywords: updated.allowKeywords,
                  blockKeywords: updated.blockKeywords,
                  sources: updated.sources,
                  active: hasAiFilter() || hasKeywordFilter() || hasSourceFilter(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update filter config";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ updated: false, error: message }),
            },
          ],
        };
      }
    },
  );
}
