-- Freezer inventory and grocery spend tracker for the Home Meals site.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Needs public.household_members from the original setup (the two-person allowlist).
-- Table names start with meal_ so they can't clash with anything on another site in the same project.

create table if not exists public.meal_freezer (
  id uuid primary key default gen_random_uuid(),
  item text not null check (char_length(item) between 1 and 120),
  portions integer not null default 1 check (portions between 0 and 50),
  made_on date not null default current_date,
  recipe_key text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.meal_freezer enable row level security;
drop policy if exists "household read freezer" on public.meal_freezer;
drop policy if exists "household insert freezer" on public.meal_freezer;
drop policy if exists "household update freezer" on public.meal_freezer;
drop policy if exists "household delete freezer" on public.meal_freezer;
create policy "household read freezer" on public.meal_freezer
  for select to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household insert freezer" on public.meal_freezer
  for insert to authenticated
  with check (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household update freezer" on public.meal_freezer
  for update to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()))
  with check (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household delete freezer" on public.meal_freezer
  for delete to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));

create table if not exists public.meal_spend (
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  store text not null default 'Woolworths' check (char_length(store) between 1 and 40),
  amount numeric(8,2) not null check (amount > 0 and amount < 5000),
  note text check (note is null or char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.meal_spend enable row level security;
drop policy if exists "household read spend" on public.meal_spend;
drop policy if exists "household insert spend" on public.meal_spend;
drop policy if exists "household delete spend" on public.meal_spend;
create policy "household read spend" on public.meal_spend
  for select to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household insert spend" on public.meal_spend
  for insert to authenticated
  with check (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household delete spend" on public.meal_spend
  for delete to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));

-- Live sync between phones (only adds a table that isn't already published).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_freezer') then
    alter publication supabase_realtime add table public.meal_freezer;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_spend') then
    alter publication supabase_realtime add table public.meal_spend;
  end if;
end $$;
