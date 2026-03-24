-- Update handle_generation_cost to support external providers (BYOK)

CREATE OR REPLACE FUNCTION handle_generation_cost()
RETURNS TRIGGER AS $$
DECLARE
    user_tier TEXT;
    user_credits INTEGER;
    cost INTEGER;
    provider TEXT;
BEGIN
    -- Check for external provider (BYOK)
    provider := (NEW.metadata->>'provider');
    IF provider = 'external' THEN
        RETURN NEW; -- Skip cost check and deduction
    END IF;

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
