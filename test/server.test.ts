import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../dist/server.js';
import { type ApiOptions, type JsonObject, apiOrigin, resolveToken } from '../dist/api.js';

async function connect(t: TestContext, options: ApiOptions) {
  const server = createServer(options);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
async function temp(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'fortrip-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
function firstText(result: unknown): string {
  const parsed = z.object({ content: z.array(z.object({ type: z.literal('text'), text: z.string() })).min(1) }).parse(result);
  return parsed.content[0].text;
}

const dates = { checkIn: '2099-01-01', checkOut: '2099-01-03' };
const success = (data: JsonObject) => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
const failure = (status: number, body: JsonObject) => new Response(JSON.stringify({ success: false, ...body }), { status, headers: { 'content-type': 'application/json' } });
const bookingArgs = { hotelId: 123, roomId: 'r', ratePlanCode: 'rate', ...dates, rooms: 1, adults: 1, guests: [{ firstName: 'Test', lastName: 'Guest', roomNo: 1 }], contactName: 'Test Guest', contactPhone: '+12025550123' };
const errorBody = (result: unknown): JsonObject => z.record(z.string(), z.unknown()).parse(JSON.parse(firstText(result)));
function assertLoginHint(nextStep: unknown) {
  assert.equal(typeof nextStep, 'string');
  for (const pattern of [/npx -y fortrip login/, /in a terminal/, /browser/, /Docker/, /Never ask the user to paste a token/]) assert.match(String(nextStep), pattern);
  assert.doesNotMatch(String(nextStep), /FORTRIP_TOKEN/);
}

test('stdio process lists five tools and serves guide without credentials', async t => {
  const config = await temp(t);
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { XDG_CONFIG_HOME: config, FORTRIP_TOKEN: '' }, stderr: 'pipe' }));
  t.after(() => client.close());
  const pkg = z.object({ name: z.string(), version: z.string() }).parse(JSON.parse(await readFile('package.json', 'utf8')));
  assert.equal(client.getServerVersion()?.name, pkg.name);
  assert.equal(client.getServerVersion()?.version, pkg.version);
  assert.deepEqual((await client.listTools()).tools.map(x => x.name).sort(), ['create_booking', 'get_hotel', 'get_planning_guide', 'get_rates', 'search_hotels']);
  assert.match(firstText(await client.callTool({ name: 'get_planning_guide', arguments: {} })), /live rate/);
  const auth = await client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } });
  assert.equal(auth.isError, true);
  assert.equal(errorBody(auth).status, 401);
  assertLoginHint(errorBody(auth).nextStep);
});

test('credentials are scoped to origin, read on each call, and env takes priority', async t => {
  const dir = await temp(t);
  await mkdir(join(dir, 'fortrip'));
  const file = join(dir, 'fortrip/credentials.json');
  await writeFile(file, JSON.stringify({ tokens: { 'https://fortrip.ai': { accessToken: 'fth_saved' } } }));
  assert.equal(await resolveToken('https://fortrip.ai', { XDG_CONFIG_HOME: dir }), 'fth_saved');
  assert.equal(await resolveToken('https://example.org', { XDG_CONFIG_HOME: dir }), undefined);
  assert.equal(await resolveToken('https://fortrip.ai', { XDG_CONFIG_HOME: dir, FORTRIP_TOKEN: ' fth_env ' }), 'fth_env');
  await writeFile(file, JSON.stringify({ tokens: { 'https://fortrip.ai': { accessToken: 'fth_refreshed' } } }));
  assert.equal(await resolveToken('https://fortrip.ai', { XDG_CONFIG_HOME: dir }), 'fth_refreshed');
  assert.throws(() => apiOrigin({ FORTRIP_API_URL: 'http://example.org' }));
  assert.throws(() => apiOrigin({ FORTRIP_API_URL: 'https://user:pass@example.org' }));
});

test('tools route to HTTP APIs with defaults and bearer auth; invalid input makes no request', async t => {
  const requests: Request[] = [];
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async (url, options) => { requests.push(new Request(url, options)); return success({ hotels: [] }); } });
  await client.callTool({ name: 'search_hotels', arguments: { query: 'Tokyo', ...dates } });
  await client.callTool({ name: 'get_hotel', arguments: { hotelId: 123, includeRooms: true } });
  await client.callTool({ name: 'get_rates', arguments: { hotelIds: [123], ...dates, rooms: 1, adults: 2 } });
  assert.deepEqual(requests.map(x => x.url), ['https://fortrip.ai/api/huizhi/search', 'https://fortrip.ai/api/huizhi/hotels/123?include=rooms', 'https://fortrip.ai/api/huizhi/rates']);
  assert.equal(requests[1].method, 'GET');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer fth_test');
  assert.match(requests[0].headers.get('user-agent') ?? '', /^fortrip-mcp\/\d+\.\d+\.\d+/);
  assert.equal(requests[0].redirect, 'manual');
  assert.equal((await requests[2].json()).maxRoomsPerHotel, 5);
  assert.equal((await requests[0].json()).currency, 'CNY');
  for (const args of [{ ...dates }, { query: 'Tokyo', ...dates, checkOut: '2099-01-30' }, { query: 'Tokyo', ...dates, checkIn: '2099-02-30' }]) {
    assert.equal((await client.callTool({ name: 'search_hotels', arguments: args })).isError, true);
  }
  assert.equal(requests.length, 3);
});

test('booking returns the absolute status page as paymentUrl for old and new API answers', async t => {
  const stay = { hotelId: 123, hotelName: 'Test Hotel', roomName: 'Double', checkIn: dates.checkIn, checkOut: dates.checkOut, nights: 2, rooms: 1, adultsPerRoom: 1, childrenAgesPerRoom: [] };
  const answers: Record<string, JsonObject> = {
    // Older API: site-relative links and paymentUrl is the Stripe Checkout URL.
    relative: { agentOrderId: 'A1', amount: 100, currency: 'USD', terms: { boardCode: 'BB', boardCount: 1 }, paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_a1#fragment', statusUrl: '/booking-status?session_id=cs_test_a1', orderUrl: '/orders/A1' },
    absolute: { agentOrderId: 'A1', amount: 100, currency: 'USD', terms: { boardCode: 'BB', boardCount: 1 }, paymentUrl: 'https://fortrip.ai/booking-status?session_id=cs_test_a1', statusUrl: 'https://fortrip.ai/booking-status?session_id=cs_test_a1', orderUrl: 'https://fortrip.ai/orders/A1', stay },
    // No Checkout Session: there is no status page, so the Stripe URL stays.
    noSession: { agentOrderId: 'A1', amount: 100, currency: 'USD', terms: null, paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_a1#fragment', orderUrl: '/orders/A1' },
    // A site-relative paymentUrl is made absolute; a protocol-relative URL is already absolute and stays as is.
    relativePayment: { agentOrderId: 'A1', amount: 100, currency: 'USD', terms: null, paymentUrl: '/booking-status?session_id=cs_test_a1', orderUrl: '//orders.example.com/A1' },
  };
  let mode = 'relative';
  const requests: Request[] = [];
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async (url, options) => { requests.push(new Request(url, options)); return success(structuredClone(answers[mode])); } });
  const book = async (args: JsonObject = bookingArgs) => z.record(z.string(), z.unknown()).parse((await client.callTool({ name: 'create_booking', arguments: args })).structuredContent);

  const relative = await book();
  assert.equal(requests[0].url, 'https://fortrip.ai/api/huizhi/bookings');
  assert.equal(relative.paymentUrl, 'https://fortrip.ai/booking-status?session_id=cs_test_a1');
  assert.equal(relative.statusUrl, 'https://fortrip.ai/booking-status?session_id=cs_test_a1');
  assert.equal(relative.orderUrl, 'https://fortrip.ai/orders/A1');
  assert.match(String(relative.nextStep), /confirm/);
  assert.match(String(relative.nextStep), /stay/);
  assert.deepEqual(relative.terms, { boardCode: 'BB', boardCount: 1 });
  // The older API answers no stay: it is built from the request so the user can still be shown one.
  assert.deepEqual(relative.stay, { hotelId: 123, hotelName: null, roomName: null, checkIn: '2099-01-01', checkOut: '2099-01-03', nights: 2, rooms: 1, adultsPerRoom: 1, childrenAgesPerRoom: [] });

  mode = 'absolute';
  const absolute = await book();
  assert.equal(absolute.paymentUrl, 'https://fortrip.ai/booking-status?session_id=cs_test_a1');
  assert.equal(absolute.orderUrl, 'https://fortrip.ai/orders/A1');
  assert.deepEqual(absolute.stay, stay);

  mode = 'noSession';
  const fallback = await book();
  assert.equal(fallback.paymentUrl, 'https://checkout.stripe.com/c/pay/cs_test_a1#fragment');
  assert.equal(fallback.orderUrl, 'https://fortrip.ai/orders/A1');
  assert.equal('statusUrl' in fallback, false);
  const family = await book({ ...bookingArgs, checkOut: '2099-01-06', rooms: 2, adults: 2, childrenAges: [5], guests: [{ firstName: 'Test', lastName: 'Guest', roomNo: 1 }, { firstName: 'Other', lastName: 'Guest', roomNo: 2 }] });
  assert.deepEqual(family.stay, { hotelId: 123, hotelName: null, roomName: null, checkIn: '2099-01-01', checkOut: '2099-01-06', nights: 5, rooms: 2, adultsPerRoom: 2, childrenAgesPerRoom: [5] });

  mode = 'relativePayment';
  const relativePayment = await book();
  assert.equal(relativePayment.paymentUrl, 'https://fortrip.ai/booking-status?session_id=cs_test_a1');
  assert.equal(relativePayment.orderUrl, '//orders.example.com/A1');
});

test('booking errors pass reason through, absolutize 409 links and carry no payment step', async t => {
  const answers: Record<string, Response> = {
    relative409: failure(409, { error: 'This stay already has a paid or completed booking.', agentOrderId: 'A1', orderUrl: '/orders/A1', statusUrl: '/booking-status?session_id=cs_test_a1' }),
    absolute409: failure(409, { error: 'This stay already has a paid or completed booking.', reason: 'already_booked', agentOrderId: 'A1', orderUrl: 'https://fortrip.ai/orders/A1', statusUrl: 'https://fortrip.ai/booking-status?session_id=cs_test_a1' }),
    changed: failure(409, { error: 'The price or terms changed.', reason: 'price_or_terms_changed', changes: [{ field: 'amount' }] }),
    unavailable: failure(503, { error: 'Hotel booking is temporarily unavailable.', reason: 'supplier_unavailable', retryable: true }),
  };
  let mode = 'relative409';
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async () => answers[mode].clone() });
  const book = async () => {
    const result = await client.callTool({ name: 'create_booking', arguments: bookingArgs });
    assert.equal(result.isError, true);
    const body = errorBody(result);
    assert.equal('paymentUrl' in body, false);
    assert.equal('nextStep' in body, false);
    return body;
  };

  const relative = await book();
  assert.equal(relative.status, 409);
  assert.equal(relative.orderUrl, 'https://fortrip.ai/orders/A1');
  assert.equal(relative.statusUrl, 'https://fortrip.ai/booking-status?session_id=cs_test_a1');
  mode = 'absolute409';
  const absolute = await book();
  assert.equal(absolute.reason, 'already_booked');
  assert.equal(absolute.orderUrl, 'https://fortrip.ai/orders/A1');
  mode = 'changed';
  const changed = await book();
  assert.equal(changed.reason, 'price_or_terms_changed');
  assert.deepEqual(changed.changes, [{ field: 'amount' }]);
  mode = 'unavailable';
  const unavailable = await book();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.reason, 'supplier_unavailable');
  assert.equal(unavailable.retryable, true);
});

test('per-room occupancy limits are enforced before any request', async t => {
  const requests: Request[] = [];
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async (url, options) => { requests.push(new Request(url, options)); return success({}); } });
  const rates = { hotelIds: [123], ...dates, rooms: 1, adults: 1 };
  const tooMany = [{ rooms: 9 }, { adults: 9 }, { childrenAges: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { childrenAges: [18] }, { rooms: 0 }];
  for (const args of tooMany) {
    assert.equal((await client.callTool({ name: 'get_rates', arguments: { ...rates, ...args } })).isError, true, JSON.stringify(args));
    assert.equal((await client.callTool({ name: 'create_booking', arguments: { ...bookingArgs, ...args } })).isError, true, JSON.stringify(args));
  }
  assert.equal(requests.length, 0);
  const max = { rooms: 8, adults: 8, childrenAges: [0, 1, 2, 3, 4, 5, 6, 17] };
  assert.equal((await client.callTool({ name: 'get_rates', arguments: { ...rates, ...max } })).isError, undefined);
  assert.equal((await client.callTool({ name: 'create_booking', arguments: { ...bookingArgs, ...max } })).isError, undefined);
  assert.deepEqual(await requests[1].json().then(body => z.object({ rooms: z.number(), adults: z.number(), childrenAges: z.array(z.number()) }).parse(body)), max);
});

test('tool descriptions state the meal codes, per-room occupancy and search limit', async t => {
  const client = await connect(t, { env: {} });
  const { tools } = await client.listTools();
  const tool = (name: string) => tools.find(x => x.name === name);
  const describe = (name: string, key: string) => z.object({ description: z.string() }).parse(tool(name)?.inputSchema.properties?.[key]).description;
  const meals = describe('get_rates', 'boardCodes');
  for (const pair of ['RO=room only', 'BB=breakfast,', 'HB=breakfast + dinner,', 'FB=breakfast + lunch + dinner,', 'BL=lunch,', 'BD=dinner,', 'HBBL=breakfast + lunch,', 'HBLD=lunch + dinner,', 'AI=all inclusive', 'boardCount']) assert.ok(meals.includes(pair), pair);
  for (const name of ['get_rates', 'create_booking']) {
    assert.match(describe(name, 'rooms'), /2 rooms for 4 adults is rooms 2, adults 2/);
    assert.match(describe(name, 'adults'), /per room/);
    assert.match(describe(name, 'childrenAges'), /every room/);
  }
  assert.match(tool('search_hotels')?.description ?? '', /more than 30,000 hotels are refused with 422; narrow them/);
});

test('unknown keys: create_booking and search reject them, get_hotel ignores them like the hosted server', async t => {
  const requests: Request[] = [];
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async (url, options) => { requests.push(new Request(url, options)); return success({}); } });
  const booking = await client.callTool({ name: 'create_booking', arguments: { ...bookingArgs, children: [5] } });
  assert.equal(booking.isError, true);
  assert.match(firstText(booking), /children/);
  assert.equal((await client.callTool({ name: 'search_hotels', arguments: { query: 'Tokyo', ...dates, stars: 4 } })).isError, true);
  assert.equal(requests.length, 0);
  assert.equal((await client.callTool({ name: 'get_hotel', arguments: { hotelId: 1, include: 'rooms' } })).isError, undefined);
  assert.deepEqual(requests.map(x => x.url), ['https://fortrip.ai/api/huizhi/hotels/1']);
});

test('login hints address the user and never ask for a token', async t => {
  const dir = await temp(t);
  await mkdir(join(dir, 'fortrip'));
  const file = join(dir, 'fortrip/credentials.json');
  await writeFile(file, JSON.stringify({ tokens: { 'https://fortrip.ai': { accessToken: 'fth_revoked' } } }));
  const fetchImpl = async () => failure(401, { error: 'Unauthorized' });
  const saved = await connect(t, { env: { XDG_CONFIG_HOME: dir }, fetchImpl });
  const revoked = errorBody(await saved.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } }));
  assert.equal(revoked.status, 401);
  assertLoginHint(revoked.nextStep);

  const fromEnv = await connect(t, { env: { XDG_CONFIG_HOME: dir, FORTRIP_TOKEN: 'fth_env' }, fetchImpl });
  const rejected = errorBody(await fromEnv.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } }));
  assert.match(String(rejected.nextStep), /FORTRIP_TOKEN set for this server was rejected/);
  assert.match(String(rejected.nextStep), /must remove it .*then ask the user to run `npx -y fortrip login`/);
  assert.match(String(rejected.nextStep), /Never ask the user to paste a token/);

  await writeFile(file, '{not json');
  const unreadable = errorBody(await saved.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } }));
  assert.match(String(unreadable.error), /Cannot read the saved Fortrip login/);
  assertLoginHint(unreadable.nextStep);
});

test('an unreadable credentials file gets a permissions hint, not a sign-in hint', { skip: process.getuid?.() === 0 && 'root reads any file' }, async t => {
  const dir = await temp(t);
  await mkdir(join(dir, 'fortrip'));
  const file = join(dir, 'fortrip/credentials.json');
  await writeFile(file, JSON.stringify({ tokens: { 'https://fortrip.ai': { accessToken: 'fth_saved' } } }));
  await chmod(file, 0o000);
  let fetched = 0;
  const client = await connect(t, { env: { XDG_CONFIG_HOME: dir }, fetchImpl: async () => { fetched++; return success({}); } });
  const denied = errorBody(await client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } }));
  assert.match(String(denied.error), /Cannot read the saved Fortrip login \(EACCES\)/);
  assert.match(String(denied.nextStep), /file permissions, so signing in again will not help/);
  assert.match(String(denied.nextStep), /--user "\$\(id -u\):\$\(id -g\)"/);
  assert.match(String(denied.nextStep), /Never ask the user to paste a token/);
  assert.equal(fetched, 0);
});

test('invalid FORTRIP_API_URL is a tool error, not a failed initialize', async t => {
  let fetched = 0;
  for (const [url, message] of [['not a url', /FORTRIP_API_URL is not a valid URL/], ['http://example.org', /must use HTTPS/]] as const) {
    const client = await connect(t, { env: { FORTRIP_API_URL: url, FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async () => { fetched++; return success({}); } });
    assert.equal((await client.listTools()).tools.length, 5);
    assert.match(firstText(await client.callTool({ name: 'get_planning_guide', arguments: {} })), /live rate/);
    const result = await client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } });
    assert.equal(result.isError, true);
    assert.match(String(errorBody(result).error), message);
  }
  assert.equal(fetched, 0);
});

test('a cancelled tool call aborts its API request', async t => {
  let started!: () => void;
  const fetchStarted = new Promise<void>(resolve => { started = resolve; });
  let aborted!: () => void;
  const fetchAborted = new Promise<void>(resolve => { aborted = resolve; });
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: (_url, options) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { aborted(); reject(new Error('aborted')); });
    started();
  }) });
  const controller = new AbortController();
  const pending = client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } }, { signal: controller.signal });
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending);
  await Promise.race([fetchAborted, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('API request still open 2 s after cancellation')), 2_000).unref())]);
});

test('stdio process exits promptly on SIGTERM during a pending API request', async t => {
  let seen!: () => void;
  const requestSeen = new Promise<void>(resolve => { seen = resolve; });
  const api = createHttpServer(() => { seen(); });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => { api.closeAllConnections(); api.close(); });
  const config = await temp(t);
  const child = spawn(process.execPath, ['dist/index.js'], { env: { PATH: process.env.PATH, XDG_CONFIG_HOME: config, FORTRIP_TOKEN: 'fth_test', FORTRIP_API_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGKILL'); });
  const send = (message: JsonObject) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'get_hotel', arguments: { hotelId: 1 } } });
  await requestSeen;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const [code] = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still running 5 s after SIGTERM')), 5_000).unref())]);
  assert.equal(code, 0);
});

test('SIGTERM does not truncate a large response that is still being written', async t => {
  const description = 'x'.repeat(2_000_000);
  const api = createHttpServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ success: true, data: { hotelId: 1, description } })); });
  api.listen(0, '127.0.0.1');
  await once(api, 'listening');
  t.after(() => { api.closeAllConnections(); api.close(); });
  const config = await temp(t);
  const child = spawn(process.execPath, ['dist/index.js'], { env: { PATH: process.env.PATH, XDG_CONFIG_HOME: config, FORTRIP_TOKEN: 'fth_test', FORTRIP_API_URL: `http://127.0.0.1:${(api.address() as AddressInfo).port}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill('SIGKILL'); });
  let output = '';
  let signalled = false;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output += chunk;
    // As soon as the tool result starts arriving, stop reading so the rest stays queued in the
    // child's stdout, signal it, and read on a little later.
    if (!signalled && output.indexOf('\n') !== -1 && output.length > output.indexOf('\n') + 1) {
      signalled = true;
      child.stdout.pause();
      child.kill('SIGTERM');
      setTimeout(() => child.stdout.resume(), 300);
    }
  });
  const done = Promise.all([once(child, 'exit'), once(child.stdout, 'end')]);
  const send = (message: JsonObject) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'get_hotel', arguments: { hotelId: 1 } } });
  const [[code]] = await Promise.race([done, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still running 10 s after SIGTERM')), 10_000).unref())]);
  assert.equal(signalled, true);
  assert.equal(code, 0);
  const result = z.object({ id: z.literal(2), result: z.object({ structuredContent: z.object({ description: z.string() }) }) }).parse(JSON.parse(output.trim().split('\n')[1]));
  assert.equal(result.result.structuredContent.description.length, description.length);
});

test('API failures stay tool errors; retry-after is preserved and transport errors hide secrets', async t => {
  let mode = 'rate-limit';
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_secret' }, fetchImpl: async () => {
    if (mode === 'network') throw new Error('secret fth_secret');
    if (mode === 'html') return new Response('<html>error</html>', { status: 502 });
    return new Response(JSON.stringify({ success: false, error: 'Slow down' }), { status: 429, headers: { 'retry-after': '12' } });
  } });
  const call = () => client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } });
  assert.equal(JSON.parse(firstText(await call())).retryAfterSeconds, 12);
  mode = 'network';
  const failed = await call();
  assert.equal(failed.isError, true);
  assert.doesNotMatch(JSON.stringify(failed), /fth_secret/);
  mode = 'html';
  assert.equal(JSON.parse(firstText(await call())).status, 502);
  assert.equal((await client.listTools()).tools.length, 5);
});
