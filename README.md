# NanoFlux

A local news subscription and delivery service for AI agents.

NanoFlux continuously fetches RSS / Atom feeds, Google News keyword feeds, and WeChat official accounts. It enriches articles with full text, cover images, and source information; can optionally filter items with keywords and an LLM; and can translate titles. Collected news is available to agents through **MCP**, and to people through a REST API, a Fever-compatible endpoint, and a lightweight web console.

![NanoFlux news list](screenshots/newslist.png)

## Use Cases

- Build a continuously updated news source for agents instead of searching from scratch every time
- Filter news by topic and translate titles into Chinese or English
- Read the same news store with Fever clients such as Reeder
- Push headlines or daily digests to a Telegram channel

`is_read` tracks whether a person has read an item. It is independent of the MCP tools.

## Highlights

- RSS / Atom feed management, OPML export, Google News keyword feeds, and WeChat official-account feeds
- Adaptive polling, GUID deduplication, Google News canonical-link resolution, full-text extraction, and cover-image extraction
- Filtering by source domain, title keyword, and LLM prompt; optional title translation
- MCP tools for feed management, unconsumed news, filter settings, and Telegram delivery
- REST API and a password-protected web console
- Fever API 3 compatibility for feeds, articles, unread items, and read state
- SQLite persistence, Excel export, PWA support, light/dark themes, and English / Simplified Chinese / Traditional Chinese UI

## Quick Start

### Prerequisites

- [Bun 1.3.14](https://bun.sh)
- Access to Google (checked at startup and required for Google News feeds)

### Install and Run

```bash
bun install

# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Edit `.env` and set a strong password at minimum:

```env
PORT=3000
ADMIN_PASSWORD=ChangeMe!123
```

```bash
bun start
```

Once started:

- Console: `http://localhost:3000`
- MCP: `http://localhost:3000/mcp`
- Fever: `http://localhost:3000/fever` (enable it first in Settings)

`ADMIN_PASSWORD` must be at least 8 characters and include letters, numbers, and symbols. It protects the console and REST API. MCP accepts local clients only by default and does not use this password.

### Common Commands

| Command | Purpose |
| --- | --- |
| `bun start` | Build the frontend and start the service |
| `bun run dev` | Watch and run the frontend and backend for development |
| `bun run build:web` | Build frontend assets to `public/` only |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:push` | Push the database schema |
| `bun run db:studio` | Open Drizzle Studio |

Database migrations run automatically when the service starts.

## How to Use It

### Web Console

Sign in with `ADMIN_PASSWORD` to:

- Add, preview, edit, or remove RSS feeds, and subscribe to Google News by keyword
- Configure filtering, title translation, Fever credentials, and display preferences
- Browse unread or all news, block a source, and export to Excel

New feeds are fetched immediately; there is no need to wait for the next scheduler run.

### MCP

Add NanoFlux to an MCP client such as Cursor or Claude Desktop:

```json
{
  "mcpServers": {
    "nanoflux": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

To use MCP from another machine, open **Settings > MCP** and select **Allow remote access**. NanoFlux generates and displays a high-entropy Authorization token without changing the active configuration. Review or copy it, then click **Save** to enable remote access and make that token active. Remote clients must send:

```http
Authorization: Bearer <your MCP token>
```

The token is separate from `ADMIN_PASSWORD`; local MCP clients do not need it while remote access is disabled.

Behind a reverse proxy or tunnel, every client reaches NanoFlux from the proxy's address, which is often `127.0.0.1`. NanoFlux therefore treats any request carrying `Forwarded`, `X-Forwarded-For`, or `X-Real-IP` as remote. Make sure the proxy sends one of these headers (for nginx, add `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), and enable remote access with a token for clients that come through it.

A typical agent workflow is to create feeds with `add_feed`, `add_feed_by_keyword`, or `add_wechat_feed`; optionally set criteria with `update_filter_config`; then call `get_uningested_news` on a schedule. It takes no parameters and returns up to 50 passed first-report items (not duplicates of an earlier item) from the last three days that it has not returned before, ordered by `item_id` ascending. The server remembers the last item returned, so if it returns `hasMore: true`, simply call it again until it returns `false`.

| Tool | Description |
| --- | --- |
| `add_feed` | Add an RSS feed; metadata is fetched automatically when omitted |
| `add_feed_by_keyword` | Create a Google News feed for a keyword from the last three days |
| `add_wechat_feed` | Search for and subscribe to a WeChat official account; pass `fakeid` when multiple matches exist |
| `get_feeds` | List feeds, optionally filter by title keyword, and page with `nextCursor`; ordered by `updated_at DESC`, then `id DESC` |
| `update_feed` / `delete_feed` | Update or delete a feed |
| `get_uningested_news` | Get the next 50 passed first-report news items from the last three days not returned before, in ascending `item_id` order; the cursor is kept on the server |
| `get_filter_config` / `update_filter_config` | Read or update filter settings |
| `get_current_time` | Get the server's current UTC time |
| `send_telegram_message` | Send a headline, URL, and optional HTML content |
| `send_telegram_digest` | Send an HTML daily digest |

News items include `id`, `title`, `link`, `content`, `published_at`, and `feed_title`. Rejected and deleted items are not returned.

### Fever Clients

Enable Fever under **Settings → Fever**, then configure your client with:

- URL: `http://<host>:<port>/fever`
- Username and password: the Fever credentials saved in Settings

Fever read state maps to `is_read`. Starring is not currently supported.

## Configuration

### `.env`

Create `.env` from `.env.example`. These variables are read when the process starts.

| Variable | Required | Description |
| --- | --- | --- |
| `PORT` | Yes | HTTP port; the example uses `3000` |
| `HOST` | No | Listen address; defaults to `0.0.0.0` (all interfaces). Set `127.0.0.1` to accept local connections only |
| `ADMIN_PASSWORD` | Yes | Password for the console and REST API |
| `DB_PATH` | No | SQLite path; defaults to `data.sqlite` |
| `LLM_BASE_URL` | No | OpenAI-compatible API base URL |
| `LLM_API_KEY` | No | LLM API key |
| `LLM_MODEL_NAME` | No | Model name, such as `gpt-4o-mini` |
| `WECHATRSS_API_KEY` / `WECHATRSS_API_SECRET` | No | Credentials for WeChat official-account feeds |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token |
| `TELEGRAM_CHANNEL_ID` | No | Channel username (`@channel`) or numeric ID |
| `FETCH_ALLOW_PRIVATE_HOSTS` | No | Comma-separated hostnames or IPs exempt from the private-address block, such as a LAN RSSHub |

Feed, article, and cover requests are refused when a URL, or any redirect it follows, resolves to a loopback, private, link-local, or other non-public address. This keeps feed content from steering NanoFlux at internal services or cloud metadata endpoints.

Outbound HTTP requests support the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` variables:

```env
HTTPS_PROXY=http://127.0.0.1:9080
NO_PROXY=localhost,127.0.0.1
```

### `config.json`

`config.json` is created and updated by the console, REST API, or MCP. It is ignored by Git and contains settings that can be changed at runtime. Missing sections and fields take their defaults; if the file is not valid JSON or a field has the wrong type, NanoFlux refuses to start and reports the problem instead of overwriting the file:

```json
{
  "filter": {
    "enabled": true,
    "prompt": "Keep only news directly related to asset-management regulation, product launches, or institutional fund flows.",
    "keywords": "sponsored, giveaway, celebrity gossip",
    "sources": ["example.com"]
  },
  "translate": {
    "enabled": true,
    "prompt": "Translate news titles accurately and naturally.",
    "targetLang": "zh-Hans"
  },
  "fever": {
    "enabled": true,
    "user": "reeder",
    "password": "ChangeMe!123"
  },
  "mcp": {
    "remoteAccess": false,
    "authorization": ""
  }
}
```

- When `filter.enabled` is on, source domains, title keywords, and then the LLM prompt are evaluated in that order. Domain and keyword matches do not call the LLM, and are checked before the article page is fetched, so rejected items are never scraped. Google News items are matched by their `<source>` publisher domain before the Google link is resolved.
- `translate.targetLang` supports `en`, `zh-Hans`, and `zh-Hant`.
- Turning translation on with an empty `translate.prompt` fills in a default prompt.
- If the LLM is not configured or a request fails, items that do not match a domain or keyword still pass through; translation failures preserve the original title.
- Filtering and translation apply only to newly fetched news; existing items are not reprocessed.
- Fever requires a username and a strong password when enabled. Passwords are never returned by public configuration endpoints.
- MCP remote access is disabled by default. Selecting remote access generates a bearer token; it only becomes active after saving. The current token is available to authenticated administrators through the MCP settings endpoint.

## Fetching and Data Rules

- The scheduler checks due feeds every minute. A run handles at most three due feeds and ten new items per feed; remaining backlog is retried in about a minute.
- Feed intervals adapt to publishing frequency (roughly 5–60 minutes).
- When an RSS summary is too short, NanoFlux attempts to fetch and extract the full article. Images come from RSS media fields first, then article metadata or body images.
- Only items with `status = "passed"` appear in MCP, REST, the console, and exports. LLM-rejected items remain as `rejected` to prevent re-ingestion; manually removed items are `deleted`.
- Items older than 90 days are permanently removed.

## REST API

All REST endpoints except `/api/auth/*` require either a session cookie created by login or this request header:

```http
Authorization: Bearer <ADMIN_PASSWORD>
```

JSON responses use `{ "code": 0, "message": "", "data": ... }`; download endpoints are the exception.

| Group | Endpoint | Purpose |
| --- | --- | --- |
| Auth | `GET /api/auth/status` | Get authentication status |
| Auth | `POST /api/auth/login`, `POST /api/auth/logout` | Sign in and sign out |
| Feeds | `GET /api/feeds`, `GET /api/feeds/:id` | List feeds and get feed details |
| Feeds | `POST /api/feeds/create`, `POST /api/feeds/:id`, `POST /api/feeds/:id/delete` | Create, update, or delete a feed |
| Feeds | `POST /api/feeds/meta`, `GET /api/feeds/export.opml` | Preview feed metadata and export OPML |
| WeChat | `GET /api/feeds/wechat/accounts`, `POST /api/feeds/wechat/resolve` | Search for and subscribe to official accounts |
| Items | `GET /api/items`, `GET /api/items/export.xlsx` | List news and export Excel |
| Items | `POST /api/items/:id/read`, `POST /api/items/read-all` | Mark items as read |
| Items | `POST /api/items/block-source` | Block a source and hide current visible news from it |
| Settings | `GET` / `POST /api/filter` | Filter settings |
| Settings | `GET` / `POST /api/translate` | Translation settings |
| Settings | `GET` / `POST /api/fever` | Fever configuration, not the Fever protocol itself |

List endpoints support `cursor` and `limit` (default 20, maximum 50). `GET /api/items` also accepts `is_read=0|1`, `since`, `until`, or `unit` plus `count` for time filtering. Excel export supports `since`, `until`, `tz_offset`, and `lang`.

## Background Mode and Autostart

| Platform | Start | Stop |
| --- | --- | --- |
| macOS / Linux | `./start.sh` | `./stop.sh` |
| Windows | `start.bat` | `stop.bat` |

The scripts install dependencies when needed and run NanoFlux in the background. Logs are written to `logs/`.

To start with the operating system:

- macOS / Linux: make the scripts executable and run `./install-service.sh`; remove the service with `./uninstall-service.sh`. Linux uses a systemd user service and macOS uses a LaunchAgent.
- Windows: run `install-service.bat` as Administrator (it uses NSSM); remove it with `uninstall-service.bat`.

## Project Structure

```text
api/         REST routes and authentication
db/          Drizzle schema and data access
fever/       Fever protocol implementation
mcp/         MCP route and tools
services/    Fetching, parsing, filtering, translation, scheduling, and Telegram
web/         Svelte 5 web console
drizzle/     SQLite migrations
public/      Built static assets
```

## Stack

Bun, Elysia, Svelte 5, Tailwind CSS, SQLite / Drizzle ORM, MCP, rss-parser, Mozilla Readability, and OpenAI-compatible LLM APIs.

## License

[MIT](LICENSE)
