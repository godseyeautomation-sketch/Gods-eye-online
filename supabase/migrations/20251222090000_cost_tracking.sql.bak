-- Cost Tracking System

-- 1. Create Function to Deduct Credits
CREATE OR REPLACE FUNCTION handle_generation_cost()
RETURNS TRIGGER AS $$
DECLARE
    user_tier TEXT;
    user_credits INTEGER;
    cost INTEGER;
BEGIN
    -- Get user profile info
    SELECT tier, credits INTO user_tier, user_credits
    FROM public.profiles
    WHERE id = NEW.user_id;

    -- Admins have unlimited credits
    IF user_tier = 'admin' THEN
        RETURN NEW;
    END IF;

    -- Determine Cost based on generation type
    IF NEW.type = 'video' THEN
        cost := 5;
    ELSE
        -- Image, Character (if generative), etc.
        -- Assuming 'character' type in user_generations refers to the *generation* of a character aspect, 
        -- but if it's just saving a created character, it might be free. 
        -- Based on plan: Image = 1.
        cost := 1;
    END IF;

    -- Check Balance
    IF user_credits < cost THEN
        RAISE EXCEPTION 'Insufficient credits. Required: %, Available: %', cost, user_credits;
    END IF;

    -- Deduct Credits
    UPDATE public.profiles
    SET credits = credits - cost
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create Trigger on user_generations
DROP TRIGGER IF EXISTS on_generation_created ON public.user_generations;

CREATE TRIGGER on_generation_created
    BEFORE INSERT ON public.user_generations
    FOR EACH ROW
    EXECUTE FUNCTION handle_generation_cost();
