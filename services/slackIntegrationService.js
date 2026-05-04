/**
 * Slack Integration Service
 *
 * Per-brand Slack workspace connection via OAuth ("Add to Slack" button).
 * No more single shared SLACK_BOT_TOKEN env var — each brand stores its own
 * bot token in Supabase (table: brand_slack_integrations) so multiple users
 * with multiple Slack workspaces can each connect their own.
 *
 * Setup (one-time, owner of the Slack App):
 *   1. Create a Slack App at https://api.slack.com/apps
 *   2. Add scopes: chat:write, files:write, channels:read, channels:join
 *   3. Add redirect URL: <APP_BASE_URL>/api/slack/oauth/callback
 *   4. Copy Client ID, Client Secret, Signing Secret into Cloud Run env vars:
 *        SLACK_CLIENT_ID
 *        SLACK_CLIENT_SECRET
 *        SLACK_SIGNING_SECRET
 *   5. Distribution mode: start in single-workspace, switch to public review
 *      when ready to launch.
 *
 * Once those env vars are set, the "Add to Slack" button on the brand
 * settings page lights up and the OAuth dance works end-to-end.
 */

const SLACK_OAUTH_AUTHORIZE = 'https://slack.com/oauth/v2/authorize';
const SLACK_OAUTH_ACCESS = 'https://slack.com/api/oauth.v2.access';

function getClientId() { return process.env.SLACK_CLIENT_ID || ''; }
function getClientSecret() { return process.env.SLACK_CLIENT_SECRET || ''; }
function getRedirectUri() {
  const base = process.env.APP_BASE_URL || 'https://gods-eye-online-732048625045.us-central1.run.app';
  return `${base.replace(/\/$/, '')}/api/slack/oauth/callback`;
}

export function isSlackOAuthConfigured() {
  return !!(getClientId() && getClientSecret());
}

/** Build the install URL we redirect users to when they click "Add to Slack". */
export function buildInstallUrl(brandId, userId) {
  const params = new URLSearchParams({
    client_id: getClientId(),
    // `incoming-webhook` triggers Slack's channel-picker during OAuth and
    // returns the chosen channel in `data.incoming_webhook` — without it we
    // get a token but no channel id, and Review silently falls back to
    // dashboard-only mode.
    scope: 'chat:write,chat:write.public,files:write,channels:read,channels:join,im:write,incoming-webhook',
    user_scope: '',
    redirect_uri: getRedirectUri(),
    // state encodes brand+user so the callback knows where to attach the token
    state: Buffer.from(JSON.stringify({ brandId, userId, ts: Date.now() })).toString('base64url'),
  });
  return `${SLACK_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/** Decode the `state` param the callback receives. */
export function decodeState(stateB64) {
  try {
    return JSON.parse(Buffer.from(stateB64, 'base64url').toString('utf-8'));
  } catch { return null; }
}

/** Exchange the OAuth `code` for an access token + workspace metadata. */
export async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    code,
    redirect_uri: getRedirectUri(),
  });
  const res = await fetch(SLACK_OAUTH_ACCESS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Slack OAuth failed: ${data.error || 'unknown'}`);
  return {
    bot_token: data.access_token,
    bot_user_id: data.bot_user_id,
    authed_user_id: data.authed_user?.id,
    slack_team_id: data.team?.id,
    slack_team_name: data.team?.name,
    slack_channel_id: data.incoming_webhook?.channel_id,
    slack_channel_name: data.incoming_webhook?.channel,
    scopes: (data.scope || '').split(',').filter(Boolean),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase persistence helpers
// ─────────────────────────────────────────────────────────────────────────────

async function supabaseRest(tablePath, method = 'GET', body = null) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const opts = {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${url}/rest/v1/${tablePath}`, opts);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** Persist the OAuth result so the Review agent can use this brand's token. */
export async function saveBrandSlackIntegration(userId, brandId, oauth) {
  return supabaseRest('brand_slack_integrations', 'POST', {
    user_id: userId,
    brand_id: brandId,
    slack_team_id: oauth.slack_team_id,
    slack_team_name: oauth.slack_team_name,
    slack_channel_id: oauth.slack_channel_id,
    slack_channel_name: oauth.slack_channel_name,
    bot_token: oauth.bot_token,
    bot_user_id: oauth.bot_user_id,
    authed_user_id: oauth.authed_user_id,
    scopes: oauth.scopes,
    installed_at: new Date().toISOString(),
  });
}

/** Look up the most-recent integration row for a brand. */
export async function getBrandSlackIntegration(brandId) {
  if (!brandId) return null;
  const rows = await supabaseRest(
    `brand_slack_integrations?brand_id=eq.${encodeURIComponent(brandId)}&order=installed_at.desc&limit=1`
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function deleteBrandSlackIntegration(brandId) {
  await supabaseRest(`brand_slack_integrations?brand_id=eq.${encodeURIComponent(brandId)}`, 'DELETE');
}

/**
 * Backwards-compat: returns either the brand's per-workspace bot token
 * + channel id (if a row exists), or the legacy env-var token + channel
 * (single-workspace fallback). Review agent calls this instead of the env
 * vars directly.
 */
export async function resolveSlackForBrand(brandId) {
  const row = await getBrandSlackIntegration(brandId);
  if (row && row.bot_token) {
    let channel = row.slack_channel_id;
    // Fallback for older integrations that were saved without
    // `incoming-webhook` scope (no channel id captured at OAuth time).
    // Auto-pick the first public channel the bot is a member of.
    if (!channel) {
      try {
        channel = await pickFirstAccessibleChannel(row.bot_token);
        if (channel) {
          console.log(`[Slack] Resolved fallback channel ${channel} for brand ${brandId}`);
        }
      } catch (err) {
        console.warn('[Slack] channel fallback failed:', err.message);
      }
    }
    return {
      token: row.bot_token,
      channel,
      teamName: row.slack_team_name,
      perBrand: true,
    };
  }
  // Legacy fallback — env-var-driven, single workspace
  return {
    token: process.env.SLACK_BOT_TOKEN || '',
    channel: process.env.SLACK_CHANNEL_ID || '',
    teamName: null,
    perBrand: false,
  };
}

/**
 * Last-resort channel resolver: ask Slack for the list of public channels
 * the bot can post in and return the first one. Used when an integration
 * row exists but has no slack_channel_id (e.g. older OAuth flow before
 * incoming-webhook scope was added).
 */
async function pickFirstAccessibleChannel(botToken) {
  if (!botToken) return null;
  const res = await fetch(
    'https://slack.com/api/conversations.list?types=public_channel&exclude_archived=true&limit=200',
    { headers: { Authorization: `Bearer ${botToken}` } }
  );
  const data = await res.json().catch(() => null);
  if (!data?.ok || !Array.isArray(data.channels)) return null;
  // Prefer #general/#random/#social if available, else first channel
  const preferred = ['general', 'random', 'social', 'marketing'];
  for (const name of preferred) {
    const hit = data.channels.find(c => c.name === name && !c.is_archived);
    if (hit) return hit.id;
  }
  return data.channels[0]?.id || null;
}
