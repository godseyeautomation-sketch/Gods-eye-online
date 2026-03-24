-- Brand Profiles Table
create table public.brand_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  tagline text not null default '',
  industry text not null default '',
  audience text not null default '',
  tone text[] not null default '{}',
  colors text[] not null default '{}',
  visual_style text not null default '',
  keywords text[] not null default '{}',
  avoid text[] not null default '{}',
  example_images text[] not null default '{}',
  product_images text[] not null default '{}',
  lifestyle_images text[] not null default '{}',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id) -- one brand per user for now
);

alter table public.brand_profiles enable row level security;
create policy "Users can view own brand" on public.brand_profiles for select using (auth.uid() = user_id);
create policy "Users can insert own brand" on public.brand_profiles for insert with check (auth.uid() = user_id);
create policy "Users can update own brand" on public.brand_profiles for update using (auth.uid() = user_id);
create policy "Users can delete own brand" on public.brand_profiles for delete using (auth.uid() = user_id);

-- Content Slots Table
create table public.content_slots (
  id uuid default gen_random_uuid() primary key,
  brand_id uuid references public.brand_profiles on delete cascade not null,
  user_id uuid references auth.users on delete cascade not null,
  slot_date date not null,
  format text not null check (format in ('post', 'story', 'reel')),
  status text not null default 'empty' check (status in ('empty', 'ideated', 'briefed', 'generated', 'approved')),
  idea text not null default '',
  brief jsonb,
  generated_image text,
  approved boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(brand_id, slot_date, format)
);

alter table public.content_slots enable row level security;
create policy "Users can view own slots" on public.content_slots for select using (auth.uid() = user_id);
create policy "Users can insert own slots" on public.content_slots for insert with check (auth.uid() = user_id);
create policy "Users can update own slots" on public.content_slots for update using (auth.uid() = user_id);
create policy "Users can delete own slots" on public.content_slots for delete using (auth.uid() = user_id);

-- Auto-update timestamps
create or replace function public.handle_brand_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger handle_updated_at before update on public.brand_profiles
  for each row execute procedure public.moddatetime (updated_at);

-- Update Schema: Add 'products' column if missing
ALTER TABLE public.brand_profiles
ADD COLUMN IF NOT EXISTS products jsonb DEFAULT '[]';

create trigger on_slot_updated
  before update on public.content_slots
  for each row execute procedure public.handle_brand_updated_at();
