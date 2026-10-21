#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

const handle = serveStdio(() => createServer());
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void handle.close(); });
}
