-- Add BYOK permission flag to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS can_use_byok BOOLEAN DEFAULT false;

-- Add index for performance (optional but good practice)
CREATE INDEX IF NOT EXISTS idx_profiles_can_use_byok ON public.profiles(can_use_byok);
