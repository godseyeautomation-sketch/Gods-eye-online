-- Allow Admins to UPDATE any profile (for banning, BYOK toggling, etc.)
CREATE POLICY "Admins can update all profiles"
  ON public.profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_check 
      WHERE admin_check.id = auth.uid() 
      AND (admin_check.is_admin = true OR admin_check.tier = 'admin') 
    )
  );

-- Ensure Admins can also SELECT all profiles (if not already allowed)
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS admin_check 
      WHERE admin_check.id = auth.uid() 
      AND (admin_check.is_admin = true OR admin_check.tier = 'admin')
    )
  );
