/**
 * Apify Instagram Scraper Service
 *
 * Scrapes real Instagram profile data (followers, posts, engagement, top content)
 * using Apify's Instagram Profile Scraper actor.
 *
 * Cost: ~$0.01-0.05 per profile scraped (uses Apify free tier $5 credit)
 */

function getToken() { return process.env.APIFY_TOKEN; }

const ACTOR_ID = 'apify~instagram-profile-scraper';

/**
 * Scrape one or more Instagram profiles.
 * @param {string[]} usernames - Array of Instagram usernames (no @)
 * @param {number} postsLimit - Number of recent posts to fetch per profile (default 12)
 * @returns {Promise<Object[]>} Array of profile data objects
 */
async function scrapeInstagramProfiles(usernames, postsLimit = 12) {
  const token = getToken();
  if (!token) throw new Error('APIFY_TOKEN not configured');
  if (!usernames.length) return [];

  const cleanUsernames = usernames.map(u => u.replace('@', '').trim()).filter(Boolean);
  console.log(`[Apify] Scraping ${cleanUsernames.length} Instagram profiles: ${cleanUsernames.join(', ')}`);

  // Start the actor run
  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: cleanUsernames,
        resultsLimit: postsLimit,
      }),
    }
  );

  if (!startRes.ok) throw new Error(`Apify start failed: ${startRes.status} ${await startRes.text()}`);
  const startData = await startRes.json();
  const runId = startData.data?.id;
  if (!runId) throw new Error('Apify did not return a run ID');

  console.log(`[Apify] Run started: ${runId}`);

  // Poll for completion (max 2 minutes)
  const maxWait = 120000;
  const pollInterval = 5000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise(r => setTimeout(r, pollInterval));

    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    const statusData = await statusRes.json();
    const status = statusData.data?.status;

    if (status === 'SUCCEEDED') {
      // Fetch results
      const dataRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}`
      );
      const results = await dataRes.json();
      console.log(`[Apify] Scrape complete: ${results.length} profiles`);
      return results;
    } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify run ${status}: ${runId}`);
    }
    // Still running — continue polling
  }

  throw new Error('Apify scrape timed out after 2 minutes');
}

/**
 * Extract clean stats from Apify's raw profile data.
 * @param {Object} raw - Raw Apify profile object
 * @returns {Object} Cleaned profile stats
 */
function extractProfileStats(raw) {
  const posts = raw.latestPosts || [];
  const totalLikes = posts.reduce((s, p) => s + (p.likesCount || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.commentsCount || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const engagementRate = raw.followersCount
    ? ((totalLikes + totalComments) / posts.length / raw.followersCount * 100).toFixed(2)
    : '0';

  return {
    username: raw.username,
    full_name: raw.fullName || '',
    bio: raw.biography || '',
    followers: raw.followersCount || 0,
    following: raw.followsCount || 0,
    posts_count: raw.postsCount || 0,
    is_business: raw.isBusinessAccount || false,
    business_category: raw.businessCategoryName || '',
    verified: raw.verified || false,
    profile_pic: raw.profilePicUrlHD || raw.profilePicUrl || '',
    external_url: raw.externalUrl || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    top_posts: posts.slice(0, 10).map(p => ({
      type: p.type || 'Image',
      likes: p.likesCount || 0,
      comments: p.commentsCount || 0,
      caption: (p.caption || '').slice(0, 200),
      timestamp: p.timestamp,
      url: p.url || '',
      video_views: p.videoViewCount || null,
    })),
    content_types: {
      videos: posts.filter(p => p.type === 'Video').length,
      images: posts.filter(p => p.type === 'Image').length,
      carousels: posts.filter(p => p.type === 'Sidecar').length,
    },
  };
}

export { scrapeInstagramProfiles, extractProfileStats };
