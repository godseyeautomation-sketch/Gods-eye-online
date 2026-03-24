-- Make the current user an admin (Replace with specific email if needed, or update the specific ID found in the dashboard)
UPDATE public.profiles
SET is_admin = true
WHERE email = 'bitan@outreachpro.io'; -- Using the email from the screenshot
