import test, { type TestContext } from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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

test('stdio process lists five tools and serves guide without credentials', async t => {
  const config = await temp(t);
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: { XDG_CONFIG_HOME: config, FORTRIP_TOKEN: '' }, stderr: 'pipe' }));
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(x => x.name).sort(), ['create_booking', 'get_hotel', 'get_planning_guide', 'get_rates', 'search_hotels']);
  assert.match(firstText(await client.callTool({ name: 'get_planning_guide', arguments: {} })), /live rate/);
  const auth = await client.callTool({ name: 'get_hotel', arguments: { hotelId: 1 } });
  assert.equal(auth.isError, true);
  assert.equal(JSON.parse(firstText(auth)).status, 401);
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
  assert.equal(requests[0].redirect, 'manual');
  assert.equal((await requests[2].json()).maxRoomsPerHotel, 5);
  assert.equal((await requests[0].json()).currency, 'CNY');
  for (const args of [{ ...dates }, { query: 'Tokyo', ...dates, checkOut: '2099-01-30' }, { query: 'Tokyo', ...dates, checkIn: '2099-02-30' }]) {
    assert.equal((await client.callTool({ name: 'search_hotels', arguments: args })).isError, true);
  }
  assert.equal(requests.length, 3);
});

test('booking returns short absolute payment link and confirmation instructions', async t => {
  let request: Request | undefined;
  const client = await connect(t, { env: { FORTRIP_TOKEN: 'fth_test' }, fetchImpl: async (url, options) => { request = new Request(url, options); return success({ amount: 100, currency: 'USD', terms: { meals: 'Breakfast' }, paymentUrl: 'https://checkout.stripe.com/long#fragment', statusUrl: '/booking/status?secret=test', orderUrl: '/orders/1' }); } });
  const result = await client.callTool({ name: 'create_booking', arguments: { hotelId: 123, roomId: 'r', ratePlanCode: 'rate', ...dates, rooms: 1, adults: 1, guests: [{ firstName: 'Test', lastName: 'Guest', roomNo: 1 }], contactName: 'Test Guest', contactPhone: '+12025550123' } });
  assert.ok(request);
  const booking = z.object({ paymentUrl: z.string(), nextStep: z.string(), terms: z.object({ meals: z.string() }) }).parse(result.structuredContent);
  assert.equal(request.url, 'https://fortrip.ai/api/huizhi/bookings');
  assert.equal(booking.paymentUrl, 'https://fortrip.ai/booking/status?secret=test');
  assert.match(booking.nextStep, /confirm/);
  assert.equal(booking.terms.meals, 'Breakfast');
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
