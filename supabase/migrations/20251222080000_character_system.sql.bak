-- Character System Tables

-- 1. Characters Table
CREATE TABLE IF NOT EXISTS public.characters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    thumbnail_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Character Images Table (for gallery/training images)
CREATE TABLE IF NOT EXISTS public.character_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Enable RLS
ALTER TABLE public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_images ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Characters
CREATE POLICY "Users can view own characters" ON public.characters
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own characters" ON public.characters
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own characters" ON public.characters
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own characters" ON public.characters
    FOR DELETE USING (auth.uid() = user_id);

-- Character Images
CREATE POLICY "Users can view own character images" ON public.character_images
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.characters
            WHERE characters.id = character_images.character_id
            AND characters.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert own character images" ON public.character_images
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.characters
            WHERE characters.id = character_images.character_id
            AND characters.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own character images" ON public.character_images
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.characters
            WHERE characters.id = character_images.character_id
            AND characters.user_id = auth.uid()
        )
    );

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON public.characters(user_id);
CREATE INDEX IF NOT EXISTS idx_character_images_character_id ON public.character_images(character_id);
