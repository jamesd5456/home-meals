# home-meals

A shared meal plan, recipe cards and shopping lists. Static site served by GitHub Pages.

- `data/` holds the plan, recipes, shopping lists and the store layout (`store-layout.json`) as JSON.
- `js/config.js` holds the Supabase URL and anon key. Ticks, notes, extras, the freezer list and spend log sync between phones through Supabase, behind a login for two people.
- `js/logic.js` holds the pure logic (spending fortnights, night runs, freezer cover). Run `npm test` to check it.
- `sql/` holds the database scripts. Run `sql/2026-11-freezer-and-spend.sql` once in the Supabase SQL editor to switch on the Freezer and Spend pages. Until then those pages show a setup message and everything else works.
- Keep personal details (names, dates of birth, rosters, health history) out of this repo, because it is public.

## Pages

- **Today**: tonight's dinner with your shift, baby version, prep jobs, tomorrow, and a night run banner.
- **Plan**, **Recipes**: the calendar and recipe cards.
- **Shopping**: one list of everything still needed, not split into weeks. Double-tap an item to tick it off (a single tap does nothing, so a stray touch while scrolling can't tick anything). Ticked items sit in a "Ticked off" section at the bottom, newest tick first, and the "Clear ticked-off items" button removes them all at once (it syncs between phones through the existing ticks table, so no extra SQL). Edit how much to buy (type 400 if the plan says 800 g and you have half). Items are grouped in store-walk order from `data/store-layout.json`. Every ingredient for the week's meals is on the list, each in its aisle, with an asterisk on anything that might be at home. Shopping is on the Sunday before each Mon to Sun cooking week. Extras you add are sorted into the list by aisle. Run `sql/2026-11-buy-qty.sql` once so amount edits sync between phones.
- **Freezer**: what's in the freezer, and whether it covers the next run of night shifts.
- **Spend**: shop totals against the fortnight budget (`FORTNIGHT_BUDGET` in `js/config.js`).
