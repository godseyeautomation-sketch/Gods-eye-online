create table public.workflows (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null default 'Untitled Space',
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.workflows enable row level security;

create policy "Users can view own workflows"
  on public.workflows for select
  using (auth.uid() = user_id);

create policy "Users can insert own workflows"
  on public.workflows for insert
  with check (auth.uid() = user_id);

create policy "Users can update own workflows"
  on public.workflows for update
  using (auth.uid() = user_id);

create policy "Users can delete own workflows"
  on public.workflows for delete
  using (auth.uid() = user_id);

-- auto-update timestamp
create or replace function public.handle_workflow_updated_at()
  returns trigger as $$
  begin
    new.updated_at = now();
    return new;
  end;
$$ language plpgsql;

create trigger on_workflow_updated
  before update on public.workflows
  for each row
  execute procedure public.handle_workflow_updated_at();
