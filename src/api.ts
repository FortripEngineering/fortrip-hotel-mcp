import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/server';

export type JsonObject = Record<string, unknown>;
export interface ApiOptions { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; }
type ApiResponse = { data: JsonObject; error?: never } | { error: JsonObject; data?: never };
const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
export const pkg: { name: string; version: string } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const loginHint = 'Ask the user to run `npx -y fortrip login` in a terminal and approve the sign-in in the browser, then retry. If this server runs in Docker, they sign in on the host and mount ~/.config/fortrip read-only into the container (see the fortrip-mcp README). Never ask the user to paste a token.';
const envTokenHint = 'The FORTRIP_TOKEN set for this server was rejected; whoever configured the server must replace or remove it. Never ask the user to paste a token.';

export function apiOrigin(env = process.env) {
  let url: URL;
  try { url = new URL(env.FORTRIP_API_URL || 'https://fortrip.ai'); }
  catch { throw new Error('FORTRIP_API_URL is not a valid URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw new Error('FORTRIP_API_URL must use HTTPS (HTTP is allowed only for localhost), without credentials.');
  }
  return url.origin;
}

export async function resolveToken(origin: string, env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (env.FORTRIP_TOKEN?.trim()) return env.FORTRIP_TOKEN.trim();
  const path = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'fortrip', 'credentials.json');
  try {
    const saved: unknown = JSON.parse(await readFile(path, 'utf8'));
    const tokens = isObject(saved) ? saved.tokens : undefined;
    const entry = isObject(tokens) ? tokens[origin] : undefined;
    const token = isObject(entry) ? entry.accessToken : undefined;
    return typeof token === 'string' && token.trim() ? token.trim() : undefined;
  } catch (error) {
    if (isObject(error) && error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read the saved Fortrip login${isObject(error) && typeof error.code === 'string' ? ` (${error.code})` : ''}.`);
  }
}

export const jsonResult = (data: JsonObject, isError = false): CallToolResult => ({
  ...(isError ? { isError: true } : { structuredContent: data }),
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

export function createApi({ env = process.env, fetchImpl = fetch }: ApiOptions = {}) {
  // Checked per call so a bad FORTRIP_API_URL is a readable tool error, not a failed initialize.
  let origin = '', configError = '';
  try { origin = apiOrigin(env); } catch (error) { configError = error instanceof Error ? error.message : 'Invalid FORTRIP_API_URL.'; }
  return {
    origin,
    async request(path: string, body: JsonObject | undefined, signal?: AbortSignal): Promise<ApiResponse> {
      if (configError) return { error: { error: configError } };
      let token;
      try { token = await resolveToken(origin, env); }
      catch (error) { return { error: { error: error instanceof Error ? error.message : 'Cannot read the saved Fortrip login.', nextStep: loginHint } }; }
      if (!token) return { error: { status: 401, error: 'Login required', nextStep: loginHint } };
      let response;
      try {
        response = await fetchImpl(origin + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': `${pkg.name}/${pkg.version}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          redirect: 'manual',
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
        });
      } catch {
        return { error: { error: 'Fortrip API request failed or timed out. Check the connection. After a booking timeout, retry the same stay; do not create a different booking automatically.' } };
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { return { error: { status: response.status, error: 'Fortrip API returned an unexpected response.' } }; }
      if (response.ok && isObject(payload) && payload.success === true && isObject(payload.data)) return { data: payload.data };
      const retryAfter = Number(response.headers.get('retry-after'));
      return { error: {
        ...(isObject(payload) ? payload : { error: 'Invalid API response' }),
        status: response.status,
        ...(response.status === 401 ? { nextStep: env.FORTRIP_TOKEN?.trim() ? envTokenHint : loginHint } : {}),
        ...(response.headers.has('retry-after') && Number.isFinite(retryAfter) ? { retryAfterSeconds: retryAfter } : {}),
      } };
    },
  };
}
