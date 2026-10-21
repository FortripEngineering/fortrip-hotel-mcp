# Planning a hotel stay

Read this when the request is more than one hotel for fixed dates: flexible
dates, a budget, split stays, several destinations, or "find me the best".
The server instructions (call order, confirming terms before giving
paymentUrl) still apply; this covers what to ask, how to compare and how to
present.

## What to collect

Keep track of: dates (or the flexible window), nights, destination(s), rooms
and guests per room, room constraints (beds, connecting rooms, accessibility),
budget, and what the user said matters most (cheapest, most flexible, closest
to X). `adults` and `childrenAges` apply to every room: two rooms for four
adults is `rooms: 2, adults: 2`.

Ask only for what changes which hotels qualify or how they rank. If children
come along, ask each child's age; `get_rates` and `create_booking` need it. Don't ask for
trip type or style: infer it from the conversation or leave it general.

## Evidence

- A `search_hotels` price is a floor. Never call a search result available or
  bookable.
- Use `get_hotel` only when a stated preference needs evidence (a pool, a
  policy, room size).
- A hotel is available only once `get_rates` returned a live option for it.
- Anything the tools didn't return, such as reviews, style, price trends or
  exchange rates, is unknown. Say so instead of filling it in.

## Ranking

1. Drop options that break a hard constraint (dates, guests, budget cap,
   required facility).
2. Keep only options with a live rate.
3. Order by the user's stated main goal. Goals they didn't state don't count.
4. Use other preferences only to break ties.

Use the cheapest comparable live room as the baseline unless the user fixed
the room type. Show at most three plans, each with its price difference from
the baseline and what it trades off (meal plan, cancellation, location,
instant confirmation). Keep hotel names as returned and dates in the user's
notation.

For a split stay or several destinations, price each leg with its own
`get_rates` call and add up the legs. Each leg is a separate `create_booking` call and a
separate payment link.

## Stop and say so

- `get_rates` covers up to 15 hotels per call and takes about 15 seconds. If the
  request needs more hotels or date combinations than a few calls can cover,
  narrow it with the user, or present the result as a comparison of the
  hotels you priced, not the best overall.
- Urgency is not consent: call `create_booking` only for a rate the user
  picked, and give them paymentUrl only after they have seen its amount,
  currency, stay and terms and confirmed.
