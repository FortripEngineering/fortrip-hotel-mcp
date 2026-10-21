# Remote MCP

| Setting | Value |
|---|---|
| Endpoint | `https://fortrip.ai/api/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth sign-in with a Fortrip account |
| Glama Connector | [Fortrip](https://glama.ai/mcp/connectors/ai.fortrip/fortrip-hotels) |

The remote service does not require installing the local server or Node.js. Use a
client that supports Streamable HTTP and MCP OAuth, then complete its browser
sign-in and authorization flow. CLI device-login tokens (`fth_...`) and
`FORTRIP_TOKEN` are for the CLI HTTP API and do not authenticate this MCP
endpoint. There is currently no `fortrip mcp` stdio subcommand.

### Claude Code

```bash
claude mcp add --transport http fortrip https://fortrip.ai/api/mcp
```

Run `/mcp` inside Claude Code, select `fortrip`, and follow the
authentication prompts. For project configuration, merge
[`examples/claude-code.mcp.json`](../examples/claude-code.mcp.json) into `.mcp.json`.

### Cursor

Merge this into `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json`
for your personal configuration:

```json
{
  "mcpServers": {
    "fortrip": {
      "url": "https://fortrip.ai/api/mcp"
    }
  }
}
```

Restart Cursor if needed, then open its MCP settings and complete the OAuth
sign-in when prompted. A copy is in
[`examples/cursor.mcp.json`](../examples/cursor.mcp.json).

### Codex

```bash
codex mcp add fortrip --url https://fortrip.ai/api/mcp
codex mcp login fortrip
```

Alternatively, merge [`examples/codex.config.toml`](../examples/codex.config.toml)
into `~/.codex/config.toml` or your project's `.codex/config.toml`, then run
the login command. Use `codex mcp list` or `/mcp` in Codex to check the server.

### Available tools

| Tool | Purpose |
|---|---|
| `get_planning_guide` | Guidance for flexible dates, budgets, split stays and multiple destinations |
| `search_hotels` | Find hotels by text, city or coordinates, with indicative prices |
| `get_hotel` | Read static hotel details, facilities, policies and photos |
| `get_rates` | Get live rooms, rates, meal plans and cancellation terms |
| `create_booking` | Create or resume an unpaid order and return its payment link |

Example request: "Find hotels in Bangkok for November 10–12, 2026, for two
adults. Compare live rates including breakfast and free cancellation."

For flexible plans, call `get_planning_guide` first. Search prices are
indicative; use `get_rates` for live quotes. After the user selects a rate,
collect the required guest details and call `create_booking`. Show the
returned amount, currency and booking terms, and get the user's confirmation
before sharing the payment link. The user completes payment in their browser;
the MCP tool does not charge a card. These tools do not modify or cancel
existing bookings.

### Troubleshooting and support

- A `401` response before OAuth sign-in is expected. Authenticate through
  your client rather than copying a CLI token into MCP headers.
- If OAuth registration or the callback fails, check your client's MCP logs
  and report the client name, version and error at
  [GitHub Issues](https://github.com/FortripEngineering/fortrip-mcp/issues).
  Do not include tokens, guest details or payment links.
- If your client cannot perform MCP OAuth, use the [local MCP server](../README.md) or [Fortrip CLI](https://github.com/FortripEngineering/fortrip-cli).

Client setup references: [Claude Code](https://code.claude.com/docs/en/mcp),
[Cursor](https://prod.cursor.com/help/customization/mcp),
[Codex](https://developers.openai.com/codex/mcp).
