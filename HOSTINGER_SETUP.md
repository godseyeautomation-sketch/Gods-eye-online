# Hostinger Storage Setup Instructions

## Step 1: Upload PHP Handler to Hostinger

1. Connect to your Hostinger FTP:
   - Host: `72.62.85.219`
   - Username: `u784649776`
   - Password: `Outreach@9`
   - Port: `21`

2. Upload `hostinger-upload-handler.php` to:
   ```
   /public_html/upload-handler.php
   ```

3. Create the media directory:
   ```
   /public_html/media/
   ```

4. Set permissions:
   ```
   chmod 755 /public_html/upload-handler.php
   chmod 755 /public_html/upload-handler.php
   chmod 777 /public_html/media/
   ```

5. **Enable CORS (Critical for Static Files)**:
   Upload the provided `.htaccess` file to:
   ```
   /public_html/.htaccess
   ```
   *This ensures images can be viewed/downloaded by the app.*

## Step 2: Apply Database Migration

Run the SQL from `supabase/migrations/20251222071410_user_storage_system.sql` in your Supabase SQL Editor:

1. Go to: https://supabase.com/dashboard/project/cuiyqesuvvwlgmbhlvly/sql/new
2. Paste the entire migration SQL
3. Click "Run"

## Step 3: Deploy Edge Function

```bash
cd klint-studio
npx supabase functions deploy hostinger-upload --project-ref cuiyqesuvvwlgmbhlvly --no-verify-jwt
```

## Step 4: Update Edge Function with Hostinger URL

In `supabase/functions/hostinger-upload/index.ts`, update line 35-39 with the actual upload endpoint:

```typescript
const response = await fetch('https://orchid-hawk-883968.hostingersite.com/upload-handler.php', {
  method: 'POST',
  body: formData
})
```

## Step 5: Test the System

1. Generate an image using the app
2. Check Supabase logs
3. Verify file appears in `/public_html/media/`
4. Check storage quota in database

## Troubleshooting

- **FTP Connection Failed**: Verify credentials and firewall settings
- **Upload Failed**: Check PHP file permissions (755)
- **Quota Not Updating**: Check database triggers are enabled
- **Auto-deletion Not Working**: Verify RLS policies allow service role access
