import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createApi, jsonResult } from './api.js';
import { searchSchema, hotelSchema, ratesSchema, bookingSchema } from './schemas.js';

const guide = readFileSync(new URL('../guides/planning.md', import.meta.url), 'utf8');
const nextStep = 'Show the user amount, currency and every item in terms (meals, cancellation, confirmation, pay-at-hotel fees), then ask them to confirm. Only after they say yes, give them paymentUrl exactly as returned. Never share the link with anyone else.';
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const absolute = (value, origin) => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? origin + value : value;

export function createServer(options = {}) {
  const api = createApi(options);
  const server = new McpServer({ name: 'fortrip-hotel-mcp', version: '0.1.0' }, {
    instructions: 'Use get_planning_guide for complex trips. Search prices are indicative; quote live get_rates results. Create a booking only for a rate selected by the user. Present accepted terms and obtain confirmation before sharing the private payment link. Payment happens on Fortrip/Stripe, never in this server.',
  });
  const call = async (path, body, booking = false) => {
    const result = await api.request(path, body);
    const data = result.error || result.data;
    if (booking) {
      for (const key of ['orderUrl', 'statusUrl']) if (key in data) data[key] = absolute(data[key], api.origin);
      if (!result.error) {
        data.paymentUrl = data.statusUrl || data.paymentUrl;
        data.nextStep = nextStep;
      }
    }
    return jsonResult(data, Boolean(result.error));
  };
  server.registerTool('get_planning_guide', {
    title: 'Get hotel planning guide', description: 'Read before planning flexible dates, budget trips, split stays, multiple destinations or best-hotel comparisons. Explains what to ask, live-rate evidence and how to rank options.',
    inputSchema: z.object({}).strict(), annotations: { ...readOnly, openWorldHint: false },
  }, async () => ({ content: [{ type: 'text', text: guide }] }));
  server.registerTool('search_hotels', {
    title: 'Search hotels', description: 'Find hotels by query (name, brand or city), cityCode or near coordinates for checkIn/checkOut. Prices are indicative nightly floors in CNY (default) or USD: quote get_rates, not search prices. Facilities must match catalogue names. Narrow searches refused with 422. Use get_planning_guide for complex trips.',
    inputSchema: searchSchema, annotations: readOnly,
  }, input => call('/api/huizhi/search', input));
  server.registerTool('get_hotel', {
    title: 'Get hotel details', description: 'Static catalogue facts for hotelId: address, contact, description, policies, check-in/out times, facilities and photos. includeRooms adds catalogue rooms. No live prices or availability.',
    inputSchema: hotelSchema, annotations: readOnly,
  }, ({ hotelId, includeRooms }) => call(`/api/huizhi/hotels/${hotelId}${includeRooms ? '?include=rooms' : ''}`));
  server.registerTool('get_rates', {
    title: 'Get live rates', description: 'Live rooms and rate plans for 1–15 hotelIds and a stay of 1–15 nights. Specify rooms and adults per room; provide every child age. Prices in CNY (default) or USD. Returns roomId/ratePlanCode for create_booking and meal/cancellation terms. Defaults to 5 cheapest rooms per hotel. Takes about 15 seconds; query a few hotels per call.',
    inputSchema: ratesSchema, annotations: readOnly,
  }, input => call('/api/huizhi/rates', input));
  server.registerTool('create_booking', {
    title: 'Create booking payment link', description: 'Create or resume a booking for a user-selected rate from get_rates. Provide guests and contact details. Returns amount, currency, accepted terms and a private paymentUrl. Show terms and ask for confirmation before sharing paymentUrl exactly. Nothing is charged until the user pays on Fortrip/Stripe. Same user and stay resumes the same order; paid stays return 409. Does not cancel or modify bookings.',
    inputSchema: bookingSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, input => call('/api/huizhi/bookings', input, true));
  return server;
}
