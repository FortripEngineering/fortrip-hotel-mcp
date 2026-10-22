#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { apiOrigin } from './api.js';
import { createServer } from './server.js';

try { apiOrigin(); } catch (error) { console.error(`fortrip-mcp: ${error instanceof Error ? error.message : error} Hotel tools will fail until it is fixed.`); }
const handle = serveStdio(() => createServer());
for (const signal of ['SIGINT', 'SIGTERM']) {
  // close() aborts in-flight calls, so the process exits once stdout drains; the timer only backs that up.
  process.once(signal, () => { void handle.close().finally(() => { setTimeout(() => process.exit(0), 3_000).unref(); }); });
}
