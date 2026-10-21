import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { type ApiOptions, type JsonObject, createApi, jsonResult, pkg } from './api.js';
import { searchSchema, hotelSchema, ratesSchema, bookingSchema } from './schemas.js';

const guide = readFileSync(new URL('../guides/planning.md', import.meta.url), 'utf8');
const instructions = `Fortrip hotel search, live rates and booking payment links.

Call order: search_hotels → (optional) get_hotel → get_rates → create_booking.

For flexible dates, a budget, split stays, several destinations or "find me the best", call get_planning_guide before searching and follow it.

Rules:
1. Call create_booking only for a rate the user picked. Before you give the user paymentUrl, show them the booking's amount and currency, the stay (hotel, room, dates, rooms and guests) and its terms (meal plan, cancellation rules, instant or delayed confirmation, pay-at-hotel fees), end that reply by asking them to confirm, and wait for their explicit confirmation. Then give them paymentUrl exactly as returned. paymentUrl works like a payment credential: anyone holding it can pay. Never pass it to anyone but the user.
2. Never ask for, accept or pass on payment card details; payment happens only on the payment page.
3. search_hotels prices are indicative minimums. Quote get_rates to the user, not the search price.
4. search_hotels and get_rates take currency, CNY (default) or USD: pick the one that suits the user, inferred from their language or location. Prices are converted at Stripe's exchange rate, or a fixed fallback rate when Stripe is unavailable (fx says which). create_booking charges the amount and currency it returns (currently USD). A converted price is a reference; the charge is what create_booking returns. Never present them as the same price.
5. adults and childrenAges are per room and the same for every room: 2 rooms for 4 adults is rooms 2, adults 2. Give every child's age (0–17). Limits: 1–8 rooms, 1–8 adults and up to 8 children per room, 1–15 nights, up to 15 hotels per get_rates call.
6. Guest names must be Latin letters as on the passport (transliterate accents: Müller → Mueller). Facility names in search_hotels must match the catalogue exactly (e.g. "Swimming pool", "Parking"); near-synonyms match nothing.
7. The nationality given to get_rates is not sent with the booking, so a nationality-restricted rate may change or be refused at booking.
8. paymentUrl and statusUrl are the same Fortrip page: before payment it recaps the booking and continues to Stripe; after payment it shows the booking status. These tools don't change or cancel bookings: for changes, cancellations, refunds or booking problems, the user emails info@fortrip.ai with the orderUrl (never paymentUrl or statusUrl).
9. Sign-in happens in the browser: if a tool says login is required, ask the user to run \`npx -y fortrip login\` in a terminal and approve it in the browser. Never ask the user to paste a token into the chat or a config file.`;
const nextStep = 'Show the user amount, currency, the stay and every item in terms (meals, cancellation, confirmation, pay-at-hotel fees), then end your reply by asking them to confirm. Only after they say yes, give them paymentUrl exactly as returned. Never share the link with anyone else.';
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const absolute = (value: unknown, origin: string): unknown => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? origin + value : value;

export function createServer(options: ApiOptions = {}) {
  const api = createApi(options);
  const server = new McpServer({ name: pkg.name, version: pkg.version }, { instructions });
  const call = async (path: string, body: JsonObject | undefined, signal: AbortSignal, booking = false) => {
    const result = await api.request(path, body, signal);
    const data = result.error || result.data;
    if (booking) {
      // Older API versions answer site-relative links; the status page is shorter and safer to relay than Stripe's URL.
      for (const key of ['paymentUrl', 'orderUrl', 'statusUrl']) if (key in data) data[key] = absolute(data[key], api.origin);
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
    title: 'Search hotels', description: 'Find hotels by query (name, brand or city), cityCode or near coordinates for checkIn/checkOut. Prices are indicative nightly floors in CNY (default) or USD: quote get_rates, not search prices. Facilities must match catalogue names. Searches matching more than 30,000 hotels are refused with 422; narrow them. Use get_planning_guide for complex trips.',
    inputSchema: searchSchema, annotations: readOnly,
  }, (input, ctx) => call('/api/huizhi/search', input, ctx.mcpReq.signal));
  server.registerTool('get_hotel', {
    title: 'Get hotel details', description: 'Static catalogue facts for hotelId: address, contact, description, policies, check-in/out times, facilities and photos. includeRooms adds catalogue rooms. No live prices or availability.',
    inputSchema: hotelSchema, annotations: readOnly,
  }, ({ hotelId, includeRooms }, ctx) => call(`/api/huizhi/hotels/${hotelId}${includeRooms ? '?include=rooms' : ''}`, undefined, ctx.mcpReq.signal));
  server.registerTool('get_rates', {
    title: 'Get live rates', description: 'Live rooms and rate plans for 1–15 hotelIds and a stay of 1–15 nights. Specify rooms, plus adults and childrenAges per room (the same for every room); provide every child age. Prices in CNY (default) or USD. Returns roomId/ratePlanCode for create_booking and meal/cancellation terms. Defaults to the 5 cheapest room types per hotel. Takes about 15 seconds; query a few hotels per call. Use search_hotels first to find IDs, get_hotel for static policies/photos, and get_planning_guide for flexible trips. Use this tool to verify availability and quote live prices before booking. Requires Fortrip login; 429 errors include retry guidance.',
    inputSchema: ratesSchema, annotations: readOnly,
  }, (input, ctx) => call('/api/huizhi/rates', input, ctx.mcpReq.signal));
  server.registerTool('create_booking', {
    title: 'Create booking payment link', description: 'Create or resume a booking for a user-selected rate from get_rates. Provide guests and contact details. Returns amount, currency, stay, accepted terms and a private paymentUrl. Show amount, currency, stay and terms and ask for confirmation before sharing paymentUrl exactly. Nothing is charged until the user pays on the payment page; never ask for card details. Same user and stay resumes the same order; paid stays return 409 with orderUrl. Does not cancel or modify bookings: for that the user emails info@fortrip.ai with orderUrl.',
    inputSchema: bookingSchema, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, (input, ctx) => call('/api/huizhi/bookings', input, ctx.mcpReq.signal, true));
  return server;
}
