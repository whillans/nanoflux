import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getFilterConfig,
  hasAiFilter,
  hasKeywordFilter,
  hasSourceFilter,
} from "../../filter";

export function registerGetFilterConfig(server: McpServer): void {
  server.registerTool(
    "get_filter_config",
    {
      description:
        "Get the news filter configuration: source, keyword, and AI filters applied in that order, all controlled by the single `enabled` switch. Sources are rejected first; titles matching an allow keyword then pass directly; block keyword matches are rejected; the rest go to AI filtering. `active` is true when the switch is on and at least one of the three filters is configured.",
    },
    async () => {
      try {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...getFilterConfig(),
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
          error instanceof Error ? error.message : "Failed to get filter config";
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: message }) },
          ],
        };
      }
    },
  );
}
