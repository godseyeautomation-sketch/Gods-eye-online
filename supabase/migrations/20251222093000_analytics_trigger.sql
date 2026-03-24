-- Analytics Logging Trigger

CREATE OR REPLACE FUNCTION log_generation_completion()
RETURNS TRIGGER AS $$
DECLARE
    cost DECIMAL(10, 2);
    quality TEXT;
    model TEXT;
BEGIN
    -- Extract metadata (safely handle nulls)
    quality := (NEW.metadata->>'quality');
    model := (NEW.metadata->>'model');

    -- Calculate INR Cost (Matching adminService.ts constants)
    -- Image: ~3.33 INR (1 Credit)
    -- Video: ~66.64 INR (5 Credits)
    
    IF NEW.type = 'video' THEN
        cost := 66.64;
    ELSE
        cost := 3.33;
    END IF;

    -- Insert into usage_analytics
    INSERT INTO public.usage_analytics (
        user_id,
        action_type,
        model_used,
        quality,
        cost_inr,
        metadata
    ) VALUES (
        NEW.user_id,
        NEW.type,
        model,
        COALESCE(quality, 'Standard'),
        cost,
        NEW.metadata
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create Trigger (Run AFTER the generation is successfully created)
DROP TRIGGER IF EXISTS on_generation_completed ON public.user_generations;

CREATE TRIGGER on_generation_completed
    AFTER INSERT ON public.user_generations
    FOR EACH ROW
    EXECUTE FUNCTION log_generation_completion();
