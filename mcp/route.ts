import { mcp } from "elysia-mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAddFeed } from "./tools/add-feed";
import { registerAddFeedByKeyword } from "./tools/add-feed-by-keyword";
import { registerAddWechatFeed } from "./tools/add-wechat-feed";
import { registerUpdateFeed } from "./tools/update-feed";
import { registerDeleteFeed } from "./tools/delete-feed";
import { registerGetFeeds } from "./tools/get-feeds";
import { registerGetUningestedNews } from "./tools/get-uningested-news";
import { registerGetRejectedNews } from "./tools/get-rejected-news";
import { registerGetFilterConfig } from "./tools/get-filter-config";
import { registerUpdateFilterConfig } from "./tools/update-filter-config";

function registerMcpTools(server: McpServer): void {
  registerAddFeed(server);
  registerAddFeedByKeyword(server);
  registerAddWechatFeed(server);
  registerUpdateFeed(server);
  registerDeleteFeed(server);
  registerGetFeeds(server);
  registerGetUningestedNews(server);
  registerGetRejectedNews(server);
  registerGetFilterConfig(server);
  registerUpdateFilterConfig(server);
}

export const routes = mcp({
  basePath: "/mcp",
  enableJsonResponse: true,
  serverInfo: {
    name: "nanoflux",
    version: "1.0.0",
  },
  capabilities: {
    tools: {},
  },
  setupServer: async (server) => {
    registerMcpTools(server);
  },
});
