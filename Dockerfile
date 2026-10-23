# For directories that inspect MCP servers by building this image (e.g. Glama):
# runs the Fortrip CLI's local MCP server. Without a sign-in it still answers
# initialize and tools/list; tool calls ask the user to sign in.
FROM node:22-bookworm-slim
LABEL io.modelcontextprotocol.server.name="io.github.FortripEngineering/fortrip"
RUN npm install -g fortrip && npm cache clean --force
USER node
ENTRYPOINT ["fortrip", "mcp"]
