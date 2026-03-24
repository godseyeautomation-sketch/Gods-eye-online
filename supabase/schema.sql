-- Run this in your Supabase Dashboard > SQL Editor

-- 1. Create Profiles Table (Public User Info + Credits)
create table public.profiles (
  id uuid references auth.users on delete cascade not null primary key,
  email text,
  full_name text,
  avatar_url text,
  credits int default 50, -- Free tier stats
  tier text default 'free', -- 'free', 'pro', 'enterprise'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Enable Row Level Security (RLS)
alter table public.profiles enable row level security;

-- 3. Policies: Users can view their own profile
create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);

-- 4. Policies: Users can update their own profile
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- 5. Trigger: Automatically create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. Generations Table (History)
create table public.generations (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users not null,
    type text not null, -- 'image' or 'video'
    prompt text,
    model text,
    url text, -- The result URL (Vertex AI output)
    credits_cost int default 0,
    created_at timestamp with time zone default now()
);

alter table public.generations enable row level security;

create policy "Users can view own generations" on public.generations
  for select using (auth.uid() = user_id);

create policy "Users can insert own generations" on public.generations
  for insert with check (auth.uid() = user_id);
