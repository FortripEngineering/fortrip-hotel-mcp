import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Expected a real yyyy-MM-dd calendar date');
const currency = z.enum(['CNY', 'USD']).default('CNY');
const children = z.array(z.number().int().min(0).max(17)).max(10);
function stay(input, ctx) {
  const nights = (Date.parse(input.checkOut) - Date.parse(input.checkIn)) / 86_400_000;
  if (nights < 1 || nights > 15) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Stay must be between 1 and 15 nights.' });
}
export const searchSchema = z.object({
  query: z.string().trim().min(1).max(128).optional(),
  cityCode: z.number().int().positive().optional(),
  near: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().positive().max(200) }).strict().optional(),
  checkIn: date, checkOut: date, currency,
  starMin: z.number().min(0).max(5).optional(), starMax: z.number().min(0).max(5).optional(),
  facilities: z.array(z.string().trim().min(1).max(64)).min(1).max(10).optional(),
  priceMin: z.number().nonnegative().optional(), priceMax: z.number().positive().optional(),
  sortBy: z.enum(['recommended', 'price-asc', 'price-desc', 'star-desc', 'distance']).default('recommended'),
  page: z.number().int().min(1).max(100).default(1), pageSize: z.number().int().min(1).max(50).default(20),
}).strict().superRefine((input, ctx) => {
  stay(input, ctx);
  if (!input.query && !input.cityCode && !input.near) ctx.addIssue({ code: 'custom', path: ['query'], message: 'Provide query, cityCode or near.' });
  if (input.sortBy === 'distance' && !input.near) ctx.addIssue({ code: 'custom', path: ['sortBy'], message: 'distance requires near.' });
  for (const [min, max] of [['starMin', 'starMax'], ['priceMin', 'priceMax']]) {
    if (input[min] !== undefined && input[max] !== undefined && input[min] > input[max]) ctx.addIssue({ code: 'custom', path: [max], message: `${max} must be at least ${min}.` });
  }
  const earliest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (input.checkIn < earliest) ctx.addIssue({ code: 'custom', path: ['checkIn'], message: 'checkIn must not be in the past.' });
});
export const hotelSchema = z.object({ hotelId: z.number().int().positive(), includeRooms: z.boolean().optional() }).strict();
export const ratesSchema = z.object({
  hotelIds: z.array(z.number().int().positive()).min(1).max(15), checkIn: date, checkOut: date,
  rooms: z.number().int().min(1).max(9), adults: z.number().int().min(1).max(9).describe('Adults per room'),
  childrenAges: children.optional(), nationality: z.string().regex(/^[A-Z]{2}$/).optional(), currency,
  bookableOnly: z.boolean().default(true),
  boardCodes: z.array(z.enum(['RO', 'BB', 'HB', 'FB', 'BL', 'BD', 'HBBL', 'HBLD', 'AI'])).min(1).optional(),
  freeCancellation: z.boolean().optional(), maxRoomsPerHotel: z.number().int().min(1).max(200).default(5),
}).strict().superRefine(stay);
export const bookingSchema = z.object({
  hotelId: z.number().int().positive(), roomId: z.string().min(1).describe('roomId from get_rates'),
  ratePlanCode: z.string().min(1).describe('ratePlanCode from get_rates'), checkIn: date, checkOut: date,
  rooms: z.number().int().min(1).max(8), adults: z.number().int().min(1).max(8).describe('Adults per room'), childrenAges: children.default([]),
  guests: z.array(z.object({ firstName: z.string().min(1), lastName: z.string().min(1), roomNo: z.number().int().min(1) }).strict()).min(1).describe('At least one guest per room; Latin letters as on passport; roomNo is 1-based'),
  contactName: z.string().min(1).max(120), contactPhone: z.string().min(3).max(40), contactEmail: z.string().email().optional(),
  specialRequests: z.string().max(500).optional().describe('English only; not guaranteed'),
}).strict().superRefine(stay);
