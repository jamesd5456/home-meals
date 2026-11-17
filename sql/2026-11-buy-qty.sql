-- "How much to buy" overrides for the shopping lists (e.g. plan needs 800 g, you have 400 g at home).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Needs public.household_members from the original setup. Until it is run, quantity edits save on this phone only.

create table if not exists public.meal_buy_qty (
  list_key text not null,
  item_key text not null,
  qty numeric(10,2) not null check (qty >= 0 and qty < 100000),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (list_key, item_key)
);
alter table public.meal_buy_qty enable row level security;
drop policy if exists "household read buy qty" on public.meal_buy_qty;
drop policy if exists "household insert buy qty" on public.meal_buy_qty;
drop policy if exists "household update buy qty" on public.meal_buy_qty;
drop policy if exists "household delete buy qty" on public.meal_buy_qty;
create policy "household read buy qty" on public.meal_buy_qty
  for select to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household insert buy qty" on public.meal_buy_qty
  for insert to authenticated
  with check (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household update buy qty" on public.meal_buy_qty
  for update to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()))
  with check (exists (select 1 from public.household_members m where m.user_id = auth.uid()));
create policy "household delete buy qty" on public.meal_buy_qty
  for delete to authenticated
  using (exists (select 1 from public.household_members m where m.user_id = auth.uid()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_buy_qty') then
    alter publication supabase_realtime add table public.meal_buy_qty;
  end if;
end $$;
