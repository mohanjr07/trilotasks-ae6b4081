-- Create assets table
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_name text not null,
  asset_type text not null default 'Other',
  serial_number text,
  holder_name text,
  holder_id uuid references public.profiles(id) on delete set null,
  status text not null default 'available' check (status in ('available', 'assigned', 'maintenance', 'retired')),
  notes text,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS
alter table public.assets enable row level security;

-- Admins and managers can do everything
create policy "admins_managers_all_assets"
  on public.assets for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'manager')
    )
  );

-- All authenticated users can read assets
create policy "authenticated_read_assets"
  on public.assets for select
  using (auth.uid() is not null);

-- Auto-update updated_at
create or replace function public.handle_assets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assets_updated_at
  before update on public.assets
  for each row execute procedure public.handle_assets_updated_at();
