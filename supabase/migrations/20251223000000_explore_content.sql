-- Create explore_items table
create type explore_item_type as enum ('hero', 'top_choice', 'visual_effect', 'quick_action');

create table public.explore_items (
    id uuid not null default gen_random_uuid(),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone default now(),
    type explore_item_type not null,
    title text,
    subtitle text,
    image_url text,
    video_url text,
    prompt_template text,
    is_active boolean default true,
    display_order integer default 0,
    metadata jsonb default '{}'::jsonb,
    constraint explore_items_pkey primary key (id)
);

-- Enable RLS
alter table public.explore_items enable row level security;

-- Policies
-- Everyone can read active items
create policy "Explore items are viewable by everyone"
    on public.explore_items for select
    using (true);

-- Only admins can insert/update/delete
create policy "Admins can insert explore items"
    on public.explore_items for insert
    with check (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
            and profiles.tier = 'Admin'
        )
    );

create policy "Admins can update explore items"
    on public.explore_items for update
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
            and profiles.tier = 'Admin'
        )
    );

create policy "Admins can delete explore items"
    on public.explore_items for delete
    using (
        exists (
            select 1 from public.profiles
            where profiles.id = auth.uid()
            and profiles.tier = 'Admin'
        )
    );

-- Seed Data (Optional - mimicking current hardcoded values)
insert into public.explore_items (type, title, subtitle, image_url, display_order, metadata)
values 
    ('hero', 'Unleash Creative Power', 'Get unlimited access to Nano Banana Pro and our new video generation models for one year.', 'https://picsum.photos/1920/1080?random=hero', 0, '{"badge": "PROMO . v2", "tag": "Black Friday -67%"}'::jsonb),
    ('top_choice', 'Gemini 3.0 Pro', 'Best 4K image model ever', 'https://picsum.photos/400/400?random=10', 0, '{"tag": "UNLIMITED"}'::jsonb),
    ('visual_effect', 'Raven Transition', null, 'https://picsum.photos/500/900?random=300', 0, '{"video_url": ""}'::jsonb),
    ('visual_effect', 'Air Bending', null, 'https://picsum.photos/500/900?random=301', 1, '{"video_url": ""}'::jsonb),
    ('visual_effect', 'Animalization', null, 'https://picsum.photos/500/900?random=302', 2, '{"video_url": ""}'::jsonb);
