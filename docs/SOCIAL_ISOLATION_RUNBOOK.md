# Social Profile Isolation — Rollout Runbook

Fixes the multi-tenant leak where every Gods Eye user was seeing every
other user's connected upload-post.com profile (e.g. `bitan_marketing`
showing up for `godseye.automation@gmail.com`).

## What changed

- New Supabase table `public.social_profile_owners(id, user_id, upload_post_username, created_at)` tracks which Gods Eye user owns each upload-post profile.
- `server.js` + `dev-server.js` no longer blindly proxy `/api/upload-post/users`, `/history`, and `/schedule`. They now filter upload-post.com's response to only the caller's owned profiles (identified via `x-user-id` header, falling back to `user_id` query/body param).
- Ownership is recorded on profile create and removed on profile delete.
- A protected `POST /api/admin/upload-post/wipe` endpoint deletes every profile in the shared upload-post workspace — run once, post-deploy, to clean the slate.

## Rollout steps

### 1. Apply the Supabase migration

1. Open **Supabase Dashboard → your project → SQL Editor → New query**.
2. Paste the contents of [`supabase/social_profile_owners_migration.sql`](../supabase/social_profile_owners_migration.sql) into the editor.
3. Click **Run**. You should see "Success. No rows returned."
4. Verify with:
   ```sql
   SELECT * FROM public.social_profile_owners;  -- should return 0 rows initially
   ```

### 2. Add the admin wipe secret

Pick a long random string (any UUID works) and add it to your environment:

- **Cloud Run:** Console → your service → Edit & deploy new revision → Variables & Secrets → add
  ```
  ADMIN_WIPE_SECRET=<paste a long random string>
  ```
  Then redeploy (the code push will do this automatically once `git push`'d).
- **Local `.env`:** append `ADMIN_WIPE_SECRET=<same string>` (or any string — only used for local wipes).

### 3. Deploy the code (push to main)

The updated `server.js`, `dev-server.js`, `services/uploadPostService.ts`, and `components/brand/SocialAccountsPanel.tsx` ship together. Cloud Build triggers on `git push`.

### 4. Run the wipe once

After the Cloud Run revision is live, run:

```bash
curl -X POST https://gods-eye-online-732048625045.us-central1.run.app/api/admin/upload-post/wipe \
     -H "x-admin-secret: <your ADMIN_WIPE_SECRET>"
```

Expected response shape:

```json
{
  "ok": true,
  "deleted": ["bitan_marketing", "...other leaked profiles..."],
  "failed": []
}
```

All upload-post profiles and the `social_profile_owners` table are now empty. The Accounts dashboard will show "no profiles" for every user.

### 5. Verify end-to-end

1. Log in as user A → Social Dashboard → click **Add Another Profile** → create profile `test_user_a`.
2. Open an incognito window, log in as user B → Social Dashboard → you should see **zero profiles** (not `test_user_a`).
3. In user B's session, create profile `test_user_b`. Confirm user A still only sees `test_user_a`.
4. Delete `test_user_a` as user A — the upload-post workspace and the `social_profile_owners` row are both cleaned up.

## Rollback

If something goes wrong:

- **Data:** the migration is additive — dropping the table via `DROP TABLE public.social_profile_owners;` doesn't affect anything else.
- **Code:** `git revert <commit>` on the rollout commit, push, Cloud Build redeploys.
- The wipe endpoint is idempotent; running it again is a no-op if the workspace is already empty.

## Known limitations / follow-ups

- **`x-user-id` header is trusted.** A malicious user could forge another user's ID and see/delete their profiles. Long-term fix: verify the Supabase JWT server-side and extract `user_id` from that instead of trusting the header. Flagged for a separate security pass.
- **Analytics and JWT-connect endpoints** aren't yet gated by ownership. They use a `:username` path param, which anyone can guess if they know the username. Also for a later hardening pass.
