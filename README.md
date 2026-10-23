# Fortrip MCP has moved

The local Fortrip MCP server is now part of the Fortrip CLI:
**[FortripEngineering/fortrip](https://github.com/FortripEngineering/fortrip)**.
This repository and the `fortrip-mcp` npm package are no longer maintained,
and the old server no longer works against Fortrip.

Fortrip gives AI agents hotel search, live room rates and booking with a
payment link.

## Use the hosted server (no install)

Clients that support remote MCP servers with OAuth can connect directly:

```
https://fortrip.ai/api/mcp
```

Sign in to Fortrip in the browser when the client asks. In Claude Code:

```bash
claude mcp add --transport http fortrip https://fortrip.ai/api/mcp
```

## Or run it locally with the Fortrip CLI

Requires Node.js 22 or newer. Sign in once:

```bash
npx -y fortrip login
```

Then add the server to your client. Claude Desktop and Cursor:

```json
{
  "mcpServers": {
    "fortrip": {
      "command": "npx",
      "args": ["-y", "fortrip", "mcp"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add fortrip -- npx -y fortrip mcp
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.fortrip]
command = "npx"
args = ["-y", "fortrip", "mcp"]
```

If you used `fortrip-mcp`, replace `["-y", "fortrip-mcp"]` with
`["-y", "fortrip", "mcp"]` in your client's configuration.

More: the [CLI and MCP server documentation](https://github.com/FortripEngineering/fortrip/tree/main/packages/cli#readme)
and [fortrip.ai/agents](https://fortrip.ai/agents).
