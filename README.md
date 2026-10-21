# Fortrip MCP

An open-source, locally runnable MCP server for hotel search, live room rates,
hotel details and booking payment links through [Fortrip](https://fortrip.ai).
It uses stdio and works with MCP clients that launch local commands.

## Quick start

Requires Node.js 22 or newer, npm, and a Fortrip account for hotel API calls.

```sh
git clone https://github.com/FortripEngineering/fortrip-mcp.git
cd fortrip-mcp
npm ci
npm run build
npx -y fortrip login
```

The login command belongs to the separately maintained
[Fortrip CLI](https://github.com/FortripEngineering/fortrip-cli).
Run it once in a terminal and approve the sign-in in your browser. This server
reads the saved credentials on each call; it does not modify them. Never paste
a token into a chat or an MCP configuration file.

Configure your MCP client using the **absolute** path to this checkout:

```json
{
  "mcpServers": {
    "fortrip-local": {
      "command": "node",
      "args": ["/absolute/path/to/fortrip-mcp/dist/index.js"]
    }
  }
}
```

Use this entry in Claude Desktop's MCP configuration or Cursor's `.cursor/mcp.json`.
If your desktop app cannot find `node`, use its absolute executable path.
The MCP process waits for JSON-RPC on stdin; running `npm start` in a terminal
alone does not open a chat interface.

For Codex, add this to `~/.codex/config.toml`:

```toml
[mcp_servers.fortrip-local]
command = "node"
args = ["/absolute/path/to/fortrip-mcp/dist/index.js"]
```

For Claude Code:

```sh
claude mcp add --transport stdio fortrip-local -- node /absolute/path/to/fortrip-mcp/dist/index.js
```

This repository is runnable from source. An npm release of `fortrip-mcp`
has not been published; use the checkout instructions above. The first npm
release will be published manually; publishing from CI with npm provenance
can come later.

## Tools

| Tool | What it does |
| --- | --- |
| `get_planning_guide` | How to plan flexible dates, budgets, split stays and hotel comparisons; no login required. |
| `search_hotels` | Search by city/name/brand, city code or coordinates, with indicative nightly prices. |
| `get_hotel` | Address, policies, facilities, photos and optional catalogue rooms. |
| `get_rates` | Live rooms and rate plans for up to 15 hotels and 1–15 nights, with meal and cancellation terms. |
| `create_booking` | Create or resume a selected booking and return a private payment link with accepted terms. |

Example prompts:

- “Find a hotel in Tokyo for November 10–12, 2026, for two adults, then compare live rates.”
- “Compare three hotels near this location with breakfast and free cancellation.”
- “Use the room I selected to prepare a payment link, and show me all accepted terms first.”

Search prices are indicative minimums; availability and quotes come from `get_rates`.
`adults` and `childrenAges` are per room and the same for every room: two rooms
for four adults is `rooms: 2, adults: 2`. Provide each child's age. Up to 8
rooms, and up to 8 adults and 8 children per room.
Rates default to CNY and also support USD; `create_booking` charges the amount
and currency it returns (currently USD). `get_rates` defaults to the five
cheapest room types per hotel and can take about 15 seconds.

`create_booking` creates an order but does not charge a card. It returns a
Fortrip page that shows booking terms and continues to Stripe. The assistant
must show amount, currency, the stay, meals, cancellation, confirmation and any
fees, then obtain confirmation before sharing the link. Card details are
entered only on the payment page, never in chat. Links are private; do not
post them in issues or logs. This server does not cancel or modify bookings:
for changes, cancellations, refunds or booking problems, email
info@fortrip.ai with the order link (`orderUrl`), not the payment link. API
access needs a Fortrip account, and hotel purchases have the prices and
conditions shown at checkout.

## Authentication and configuration

| Variable | Purpose |
| --- | --- |
| `FORTRIP_TOKEN` | CI only: a CLI access token (`fth_…`), used instead of saved credentials. Use `npx -y fortrip login` everywhere else. |
| `XDG_CONFIG_HOME` | Optional configuration root; otherwise `~/.config` is used. |
| `FORTRIP_API_URL` | Optional API origin; defaults to `https://fortrip.ai`. HTTPS required except localhost development. |

Saved credentials are read from `$XDG_CONFIG_HOME/fortrip/credentials.json`
(normally `~/.config/fortrip/credentials.json`) and selected by API origin.
They are re-read on each call, so logging in again does not require a restart.
Missing, revoked or invalid credentials produce a tool error asking the user
to sign in again. Do not commit tokens. If you set an explicit token, it will
be sent to the configured API origin; only configure an origin you trust.

The server sends the tool's hotel/traveller inputs and bearer token to Fortrip
over HTTPS. It stores no bookings or traveller data locally. Fortrip performs
authentication, pricing, booking validation and payment handling. Tool results
are returned to your MCP client and its model provider according to that
client's settings. Logs and errors do not intentionally print credentials.

## Relationship to the hosted MCP and CLI

This repository has its own code, tests and release cycle. It implements MCP
over local stdio and calls Fortrip's existing authenticated hotel HTTP APIs.
It is not a second booking backend and does not run the Fortrip website.

The hosted MCP at `https://fortrip.ai/api/mcp` continues to use Clerk OAuth.
Use it directly in clients that support remote OAuth MCP; see the
[hosted MCP setup guide](docs/remote-mcp.md) for configuration examples. CLI tokens cannot
be used as credentials for that hosted MCP endpoint.

- **This repo:** runnable local MCP server, intended for Glama's Server directory.
- **Hosted MCP:** existing [Glama Connector](https://glama.ai/mcp/connectors/ai.fortrip/fortrip-hotels).
- **Fortrip CLI:** separately maintained command-line interface and login utility.

Configure either local or hosted MCP in a given client to avoid duplicate
tool listings. Both access the same Fortrip service; available account data
depends on the account used to log in.

## Docker

Sign in on the host first with `npx -y fortrip login`, then mount the saved
credentials read-only into the container:

```sh
docker build -t fortrip-mcp .
docker run --rm -i \
  --mount "type=bind,src=$HOME/.config/fortrip,dst=/config/fortrip,readonly" \
  -e XDG_CONFIG_HOME=/config \
  fortrip-mcp
```

Sign in before the container first starts, including when an MCP client
launches it: `--mount` refuses to start while the folder is missing, whereas
`-v` would create it owned by root and break a later `npx -y fortrip login`.
If you set `XDG_CONFIG_HOME` on the host, mount `$XDG_CONFIG_HOME/fortrip`
instead. The credentials file is readable only by its owner: on Linux, if your
user ID is not 1000 (the image's `node` user), add `--user "$(id -u):$(id -g)"`.
In CI, pass `-e FORTRIP_TOKEN` instead of the mount. Never put a token in the
Dockerfile or image. The image runs as an unprivileged user; no port is needed.
Without credentials, initialization, tool discovery and the planning guide
still work, while hotel API calls explain how to sign in.

## Development and support

```sh
npm ci
npm run build
npm test
npm pack --dry-run
```

The server is written in TypeScript with strict type checking.
Run `npm run typecheck` to build the server and strictly check the TypeScript tests.
`npm test` compiles the tests into `.test-build/` and runs them against `dist/`.
Both output directories are ignored by Git.
Tests exercise the actual stdio process, tool routing, schema validation,
credential scoping, API failures and payment-link handling using mock API
responses. They do not make live bookings. CI runs on Node.js 22 and 24.
The Dockerfile is provided for directory builds and local container use.

Tool schemas follow the Fortrip HTTP API contract. When that contract changes,
update schemas, descriptions and tests here together. Business rules and
supplier integrations remain on the backend.

Report bugs and request help through
[GitHub Issues](https://github.com/FortripEngineering/fortrip-mcp/issues).
Never include access tokens, private payment URLs, passport details or other
traveller information in a public issue.

## License

[MIT](LICENSE), copyright 2026 FortripEngineering. The planning guide is adapted
from the MIT-licensed Fortrip CLI. This license covers the repository's code
and documentation; using the hosted service is subject to its own terms.
