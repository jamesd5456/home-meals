# home-meals

A shared meal plan, recipe cards and shopping lists. Static site served by GitHub Pages.

- `data/` holds the plan, recipes and shopping lists as JSON.
- `js/config.js` holds the Supabase URL and anon key. Ticks, notes, extras, the freezer list and spend log sync between phones through Supabase, behind a login for two people.
- `js/logic.js` holds the pure logic (spending fortnights, night runs, freezer cover). Run `npm test` to check it.
- `sql/` holds the database scripts. Run `sql/2026-11-freezer-and-spend.sql` once in the Supabase SQL editor to switch on the Freezer and Spend pages. Until then those pages show a setup message and everything else works.
- Keep personal details (names, dates of birth, rosters, health history) out of this repo, because it is public.

## Pages

- **Today**: tonight's dinner with your shift, baby version, prep jobs, tomorrow, and a night run banner.
- **Plan**, **Recipes**: the calendar and recipe cards.
- **Shopping**: tick items, mark "Have it" for things already at home, and unticked items carry over to the next list.
- **Freezer**: what's in the freezer, and whether it covers the next run of night shifts.
- **Spend**: shop totals against the fortnight budget (`FORTNIGHT_BUDGET` in `js/config.js`).
