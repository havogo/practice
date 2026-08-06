-- Run once in the Supabase SQL editor.

create table if not exists public.records (
  id          text primary key,
  owner       uuid not null references auth.users (id) on delete cascade,
  store       text not null,
  record_id   text not null,
  updated_at  timestamptz not null,          -- when the record was edited (device clock)
  synced_at   timestamptz not null default now(),  -- when it reached the server
  deleted     boolean not null default false,
  payload     jsonb not null
);

-- Devices page on synced_at, which comes from one clock — the server's. Paging
-- on updated_at would lose records written by a device whose clock runs slow.
create or replace function public.touch_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.synced_at = now();
  return new;
end;
$$;

drop trigger if exists records_touch_synced_at on public.records;
create trigger records_touch_synced_at
  before insert or update on public.records
  for each row execute function public.touch_synced_at();

create index if not exists records_owner_synced_idx
  on public.records (owner, synced_at);

-- Row-level security decides which rows; these grants decide whether the
-- signed-in role may touch the table at all. Supabase usually applies them by
-- default — stating them explicitly avoids a confusing "permission denied".
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.records to authenticated;

alter table public.records enable row level security;

-- Each account reads and writes only its own rows.
drop policy if exists "own rows" on public.records;
create policy "own rows" on public.records
  for all
  using (auth.uid() = owner)
  with check (auth.uid() = owner);