import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { takeUningestedItems } from "../../db/items";

export function registerGetUningestedNews(server: McpServer): void {
  server.registerTool(
    "get_uningested_news",
    {
      description:
        "Fetch the next batch of passed first-report news (not a duplicate of an earlier item) from the last 3 days that has not been returned before, in ascending item_id order. Takes no parameters: the server remembers the last item returned. When hasMore is true, call again to fetch the next batch until hasMore is false.",
      inputSchema: {},
    },

    async () => {

      try {

        const { items: returned, hasMore } = takeUningestedItems();

        const message = hasMore
          ? "More news remain. Call get_uningested_news again."
          : "No more news for now.";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                items: returned.map((item) => ({
                  id: item.id,
                  title: item.title,
                  link: item.link,
                  content: item.content ?? null,
                  published_at: item.published_at,
                  feed_title: item.feed_title,
                })),
                hasMore,
                message,
              }),
            },
          ],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get news";
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: message }) },
          ],
        };
      }
    },
  );
}
