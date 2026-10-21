import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function apiOrigin(env = process.env) {
  const url = new URL(env.FORTRIP_API_URL || 'https://fortrip.ai');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('FORTRIP_API_URL must use HTTPS (HTTP is allowed only for localhost), without credentials.');
  }
  return url.origin;
}

export async function resolveToken(origin, env = process.env) {
  if (env.FORTRIP_TOKEN?.trim()) return env.FORTRIP_TOKEN.trim();
  const path = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'fortrip', 'credentials.json');
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const token = saved.tokens?.[origin]?.accessToken;
    return typeof token === 'string' && token.trim() ? token.trim() : undefined;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Cannot read Fortrip credentials. Run npx -y fortrip login or set FORTRIP_TOKEN.');
  }
}

export const jsonResult = (data, isError = false) => ({
  ...(isError ? { isError: true } : { structuredContent: data }),
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

export function createApi({ env = process.env, fetchImpl = fetch } = {}) {
  const origin = apiOrigin(env);
  return {
    origin,
    async request(path, body) {
      let token;
      try { token = await resolveToken(origin, env); }
      catch (error) { return { error: { error: error.message } }; }
      if (!token) return { error: { status: 401, error: 'Login required', nextStep: 'Run npx -y fortrip login, then retry. Alternatively set FORTRIP_TOKEN in the MCP process environment.' } };
      let response;
      try {
        response = await fetchImpl(origin + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'fortrip-hotel-mcp/0.1.0', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'manual',
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        return { error: { error: 'Fortrip API request failed or timed out. Check the connection. After a booking timeout, retry the same stay; do not create a different booking automatically.' } };
      }
      let payload;
      try { payload = await response.json(); } catch { return { error: { status: response.status, error: 'Fortrip API returned an unexpected response.' } }; }
      if (response.ok && payload?.success === true && payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return { data: payload.data };
      const retryAfter = Number(response.headers.get('retry-after'));
      return { error: {
        ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : { error: 'Invalid API response' }),
        status: response.status,
        ...(response.status === 401 ? { nextStep: 'Run npx -y fortrip login again or replace FORTRIP_TOKEN.' } : {}),
        ...(response.headers.has('retry-after') && Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}),
      } };
    },
  };
}
