import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a real yyyy-MM-dd calendar date').describe('Calendar date in YYYY-MM-DD format; checkOut must be 1–15 nights after checkIn.');
const currency = z.enum(['CNY', 'USD']).default('CNY').describe('Currency for displayed prices: CNY or USD. Booking charges the currency returned by create_booking.');
const children = z.array(z.number().int().min(0).max(17)).max(8).describe('Age in years (0–17) of each child in one room, up to 8; every room has the same children. Omit or use [] when no children are travelling.');
const rooms = z.number().int().min(1).max(8).describe('Number of rooms, 1–8, not number of guests. adults and childrenAges apply to each room: 2 rooms for 4 adults is rooms 2, adults 2.');
const adults = z.number().int().min(1).max(8).describe('Adults per room, 1–8; the same for every room.');
export const boardCountNote = "boardCount is how many guests per room the meal plan covers: fewer than adults per room means the meals don't cover everyone (BB with boardCount 1 for 2 adults is breakfast for 1 of 2).";
// Unknown keys are refused, not dropped (a misspelled `children` would book a different party), with the hosted server's message.
const strictInput = <T extends z.core.$ZodLooseShape>(shape: T) => z.strictObject(shape, { error: issue => issue.code === 'unrecognized_keys' ? `Unknown argument(s): ${issue.keys.join(', ')}` : 'Expected a JSON object' });
function stay(input: { checkIn: string; checkOut: string }, ctx: z.RefinementCtx) {
  const nights = (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86_400_000;
  if (nights < 1 || nights > 15) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Stay must be between 1 and 15 nights.' });
}
export const searchSchema = strictInput({
  query: z.string().trim().min(1).max(128).optional(),
  cityCode: z.number().int().positive().optional(),
  near: strictInput({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().positive().max(200) }).optional(),
  checkIn: date, checkOut: date, currency,
  starMin: z.number().min(0).max(5).optional(), starMax: z.number().min(0).max(5).optional(),
  facilities: z.array(z.string().trim().min(1).max(64)).min(1).max(10).optional(),
  priceMin: z.number().nonnegative().optional(), priceMax: z.number().positive().optional(),
  sortBy: z.enum(['recommended', 'price-asc', 'price-desc', 'star-desc', 'distance']).default('recommended'),
  page: z.number().int().min(1).max(100).default(1), pageSize: z.number().int().min(1).max(50).default(20),
}).superRefine((input, ctx) => {
  stay(input, ctx);
  if (!input.query && !input.cityCode && !input.near) ctx.addIssue({ code: 'custom', path: ['query'], message: 'Provide query, cityCode or near.' });
  if (input.sortBy === 'distance' && !input.near) ctx.addIssue({ code: 'custom', path: ['sortBy'], message: 'distance requires near.' });
  for (const [min, max] of [['starMin', 'starMax'], ['priceMin', 'priceMax']] as const) {
    if (input[min] !== undefined && input[max] !== undefined && input[min] > input[max]) ctx.addIssue({ code: 'custom', path: [max], message: `${max} must be at least ${min}.` });
  }
  const earliest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (input.checkIn < earliest) ctx.addIssue({ code: 'custom', path: ['checkIn'], message: 'checkIn must not be in the past.' });
});
export const hotelSchema = z.object({ hotelId: z.number().int().positive(), includeRooms: z.boolean().optional() });
export const ratesSchema = strictInput({
  hotelIds: z.array(z.number().int().positive()).min(1).max(15).describe('Catalogue hotel IDs returned by search_hotels; compare up to 15 hotels in one call.'), checkIn: date, checkOut: date,
  rooms, adults,
  childrenAges: children.optional(), nationality: z.string().regex(/^[A-Z]{2}$/).optional().describe('Guest nationality as an uppercase ISO 3166-1 alpha-2 country code, e.g. CN or US; omit when unknown.'), currency,
  bookableOnly: z.boolean().default(true).describe('True keeps only rates with bookable inventory on every night. False also includes rates with unavailable nights; do not present those as bookable.'),
  boardCodes: z.array(z.enum(['RO', 'BB', 'HB', 'FB', 'BL', 'BD', 'HBBL', 'HBLD', 'AI'])).min(1).optional().describe(`Keep any of these meal plans: RO=room only, BB=breakfast, HB=breakfast + dinner, FB=breakfast + lunch + dinner, BL=lunch, BD=dinner, HBBL=breakfast + lunch, HBLD=lunch + dinner, AI=all inclusive. ${boardCountNote} Omit for all meal plans; use returned terms for exact inclusions.`),
  freeCancellation: z.boolean().optional().describe('True keeps rates that can still be cancelled free of charge now. False or omitted applies no cancellation filter; it does not mean non-refundable only. Read each returned deadline and penalty.'), maxRoomsPerHotel: z.number().int().min(1).max(200).default(5).describe('Maximum room types returned per hotel, cheapest first after filtering; default 5. This limits response size, not the rooms being booked.'),
}).superRefine(stay);
export const bookingSchema = strictInput({
  hotelId: z.number().int().positive(), roomId: z.string().min(1).describe('roomId from get_rates'),
  ratePlanCode: z.string().min(1).describe('ratePlanCode from get_rates'), checkIn: date, checkOut: date,
  rooms, adults, childrenAges: children.default([]),
  guests: z.array(strictInput({ firstName: z.string().min(1), lastName: z.string().min(1), roomNo: z.coerce.number().int().min(1).max(8) })).min(1).describe('At least one guest per room; Latin letters as on the passport (transliterate accents: Müller → Mueller); roomNo is 1-based'),
  contactName: z.string().min(1).max(120), contactPhone: z.string().min(3).max(40), contactEmail: z.string().trim().refine(value => value === '' || z.email().safeParse(value).success, 'contactEmail must be an email address').optional().describe('Optional; blank means none'),
  specialRequests: z.string().max(500).optional().describe('English only; not guaranteed'),
}).superRefine(stay);
