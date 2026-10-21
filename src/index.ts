#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { apiOrigin } from './api.js';
import { createServer } from './server.js';

try { apiOrigin(); } catch (error) { console.error(`fortrip-mcp: ${error instanceof Error ? error.message : error} Hotel tools will fail until it is fixed.`); }
const handle = serveStdio(() => createServer());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void handle.close().finally(() => process.exit(0)); });
}
