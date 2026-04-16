/**
 * Apify Multi-Platform Social Media Scraper Service
 *
 * Scrapes real profile data (followers, posts, engagement, top content)
 * from Instagram, TikTok, Facebook, YouTube, X/Twitter, and LinkedIn
 * using platform-specific Apify actors.
 *
 * Pinterest and Threads don't have reliable actors — use Gemini web search for those.
 *
 * Cost: ~$0.01-0.10 per profile scraped (uses Apify free tier $5 credit)
 */

function getToken() { return process.env.APIFY_TOKEN; }

const ACTORS = {
  instagram: 'apify~instagram-profile-scraper',
  tiktok: 'clockworks~tiktok-profile-scraper',
  facebook: 'apify~facebook-pages-scraper',
  youtube: 'streamers~youtube-channel-scraper',
  twitter: 'apidojo~twitter-user-scraper',
  linkedin: 'curious_coder~linkedin-profile-scraper',
};

// Legacy alias
const ACTOR_ID = ACTORS.instagram;

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

// ══════════════════════════════════════════════════════════════════════════════
// Generic Apify actor runner (start → poll → fetch results)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Start an Apify actor, poll for completion, and return dataset items.
 * @param {string} actorId - Apify actor ID (e.g. 'clockworks~tiktok-profile-scraper')
 * @param {Object} input - Actor-specific input payload
 * @param {string} label - Logging label (e.g. 'TikTok')
 * @returns {Promise<Object[]>} Array of result items
 */
async function runApifyActor(actorId, input, label = 'Apify') {
  const token = getToken();
  if (!token) throw new Error('APIFY_TOKEN not configured');

  console.log(`[Apify/${label}] Starting actor ${actorId}...`);

  const startRes = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  if (!startRes.ok) throw new Error(`Apify/${label} start failed: ${startRes.status} ${await startRes.text()}`);
  const startData = await startRes.json();
  const runId = startData.data?.id;
  if (!runId) throw new Error(`Apify/${label} did not return a run ID`);

  console.log(`[Apify/${label}] Run started: ${runId}`);

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
      const dataRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}`
      );
      const results = await dataRes.json();
      console.log(`[Apify/${label}] Complete: ${results.length} items`);
      return results;
    } else if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      throw new Error(`Apify/${label} run ${status}: ${runId}`);
    }
    // Still running — continue polling
  }

  throw new Error(`Apify/${label} scrape timed out after 2 minutes`);
}

// ══════════════════════════════════════════════════════════════════════════════
// TikTok Scraper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape one or more TikTok profiles.
 * @param {string[]} usernames - Array of TikTok usernames (no @)
 * @returns {Promise<Object[]>} Array of profile data objects
 */
async function scrapeTikTokProfiles(usernames) {
  if (!usernames.length) return [];
  const clean = usernames.map(u => u.replace('@', '').trim()).filter(Boolean);
  const profiles = clean.map(u => `https://www.tiktok.com/@${u}`);
  console.log(`[Apify/TikTok] Scraping ${clean.length} profiles: ${clean.join(', ')}`);
  return runApifyActor(ACTORS.tiktok, { profiles }, 'TikTok');
}

/**
 * Extract clean stats from TikTok scraper output.
 */
function extractTikTokStats(raw) {
  const posts = raw.latestPosts || raw.latestVideos || raw.videos || [];
  const totalLikes = posts.reduce((s, p) => s + (p.diggCount || p.likesCount || p.likes || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.commentCount || p.commentsCount || p.comments || 0), 0);
  const totalViews = posts.reduce((s, p) => s + (p.playCount || p.viewCount || p.views || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const avgViews = posts.length ? Math.round(totalViews / posts.length) : 0;
  const followers = raw.fans || raw.followersCount || raw.followers || 0;
  const engagementRate = followers
    ? ((totalLikes + totalComments) / posts.length / followers * 100).toFixed(2)
    : '0';

  return {
    platform: 'tiktok',
    username: raw.uniqueId || raw.username || raw.nickName || '',
    followers,
    following: raw.following || raw.followingCount || 0,
    posts_count: raw.videoCount || raw.postsCount || posts.length || 0,
    bio: raw.signature || raw.bio || raw.biography || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    avg_views: avgViews,
    verified: raw.verified || false,
    total_likes: raw.heart || raw.totalLikes || totalLikes,
    top_posts: posts.slice(0, 10).map(p => ({
      type: 'Video',
      likes: p.diggCount || p.likesCount || p.likes || 0,
      comments: p.commentCount || p.commentsCount || p.comments || 0,
      caption: (p.text || p.desc || p.caption || '').slice(0, 200),
      url: p.webVideoUrl || p.url || '',
      video_views: p.playCount || p.viewCount || p.views || 0,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Facebook Scraper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape one or more Facebook pages.
 * @param {string[]} pageNames - Array of Facebook page names or URLs
 * @returns {Promise<Object[]>} Array of page data objects
 */
async function scrapeFacebookPages(pageNames) {
  if (!pageNames.length) return [];
  const clean = pageNames.map(p => p.trim()).filter(Boolean);
  const startUrls = clean.map(p => ({
    url: p.startsWith('http') ? p : `https://www.facebook.com/${p}`,
  }));
  console.log(`[Apify/Facebook] Scraping ${clean.length} pages: ${clean.join(', ')}`);
  return runApifyActor(ACTORS.facebook, { startUrls }, 'Facebook');
}

/**
 * Extract clean stats from Facebook scraper output.
 */
function extractFacebookStats(raw) {
  const posts = raw.posts || raw.latestPosts || [];
  const totalLikes = posts.reduce((s, p) => s + (p.likes || p.likesCount || p.reactions || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || p.commentsCount || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const followers = raw.likes || raw.followersCount || raw.followers || 0;
  const engagementRate = followers
    ? ((totalLikes + totalComments) / Math.max(posts.length, 1) / followers * 100).toFixed(2)
    : '0';

  return {
    platform: 'facebook',
    username: raw.title || raw.name || raw.pageName || '',
    followers,
    following: 0, // Facebook pages don't follow others
    posts_count: raw.postsCount || posts.length || 0,
    bio: raw.about || raw.description || raw.bio || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    verified: raw.verified || raw.isVerified || false,
    page_likes: raw.likes || 0,
    categories: raw.categories || raw.category || '',
    top_posts: posts.slice(0, 10).map(p => ({
      type: p.type || p.postType || 'Post',
      likes: p.likes || p.likesCount || p.reactions || 0,
      comments: p.comments || p.commentsCount || 0,
      caption: (p.text || p.message || p.caption || '').slice(0, 200),
      url: p.url || p.postUrl || '',
      video_views: p.videoViewCount || p.views || null,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// YouTube Scraper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape one or more YouTube channels.
 * @param {string[]} handles - Array of YouTube handles (e.g. 'nike' or '@nike')
 * @returns {Promise<Object[]>} Array of channel data objects
 */
async function scrapeYouTubeChannels(handles) {
  if (!handles.length) return [];
  const clean = handles.map(h => h.replace('@', '').trim()).filter(Boolean);
  const channelUrls = clean.map(h => `https://www.youtube.com/@${h}`);
  console.log(`[Apify/YouTube] Scraping ${clean.length} channels: ${clean.join(', ')}`);
  return runApifyActor(ACTORS.youtube, { channelUrls }, 'YouTube');
}

/**
 * Extract clean stats from YouTube scraper output.
 */
function extractYouTubeStats(raw) {
  const videos = raw.latestVideos || raw.videos || raw.recentVideos || [];
  const totalViews = videos.reduce((s, v) => s + (v.viewCount || v.views || 0), 0);
  const totalLikes = videos.reduce((s, v) => s + (v.likes || v.likesCount || 0), 0);
  const totalComments = videos.reduce((s, v) => s + (v.commentsCount || v.comments || 0), 0);
  const avgViews = videos.length ? Math.round(totalViews / videos.length) : 0;
  const avgLikes = videos.length ? Math.round(totalLikes / videos.length) : 0;
  const avgComments = videos.length ? Math.round(totalComments / videos.length) : 0;
  const subscribers = raw.subscriberCount || raw.subscribers || raw.numberOfSubscribers || 0;
  const engagementRate = subscribers
    ? ((totalLikes + totalComments) / Math.max(videos.length, 1) / subscribers * 100).toFixed(2)
    : '0';

  return {
    platform: 'youtube',
    username: raw.channelName || raw.title || raw.name || '',
    followers: subscribers,
    following: 0, // YouTube channels don't follow
    posts_count: raw.videoCount || raw.videosCount || videos.length || 0,
    bio: raw.description || raw.about || raw.channelDescription || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    avg_views: avgViews,
    verified: raw.verified || raw.isVerified || false,
    total_views: raw.viewCount || raw.totalViews || totalViews,
    top_posts: videos.slice(0, 10).map(v => ({
      type: 'Video',
      likes: v.likes || v.likesCount || 0,
      comments: v.commentsCount || v.comments || 0,
      caption: (v.title || v.text || '').slice(0, 200),
      url: v.url || v.videoUrl || '',
      video_views: v.viewCount || v.views || 0,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// X/Twitter Scraper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape one or more X/Twitter profiles.
 * @param {string[]} handles - Array of Twitter/X handles (no @)
 * @returns {Promise<Object[]>} Array of profile data objects
 */
async function scrapeTwitterProfiles(handles) {
  if (!handles.length) return [];
  const clean = handles.map(h => h.replace('@', '').trim()).filter(Boolean);
  console.log(`[Apify/Twitter] Scraping ${clean.length} profiles: ${clean.join(', ')}`);
  return runApifyActor(ACTORS.twitter, { handles: clean }, 'Twitter');
}

/**
 * Extract clean stats from X/Twitter scraper output.
 */
function extractTwitterStats(raw) {
  const tweets = raw.tweets || raw.latestTweets || raw.recentTweets || [];
  const totalLikes = tweets.reduce((s, t) => s + (t.likeCount || t.likes || t.favoriteCount || 0), 0);
  const totalComments = tweets.reduce((s, t) => s + (t.replyCount || t.replies || t.comments || 0), 0);
  const totalRetweets = tweets.reduce((s, t) => s + (t.retweetCount || t.retweets || 0), 0);
  const avgLikes = tweets.length ? Math.round(totalLikes / tweets.length) : 0;
  const avgComments = tweets.length ? Math.round(totalComments / tweets.length) : 0;
  const avgRetweets = tweets.length ? Math.round(totalRetweets / tweets.length) : 0;
  const followers = raw.followersCount || raw.followers || raw.public_metrics?.followers_count || 0;
  const engagementRate = followers
    ? ((totalLikes + totalComments + totalRetweets) / Math.max(tweets.length, 1) / followers * 100).toFixed(2)
    : '0';

  return {
    platform: 'twitter',
    username: raw.username || raw.screenName || raw.screen_name || '',
    followers,
    following: raw.followingCount || raw.friendsCount || raw.public_metrics?.following_count || 0,
    posts_count: raw.statusesCount || raw.tweetsCount || raw.public_metrics?.tweet_count || tweets.length || 0,
    bio: raw.description || raw.bio || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    avg_retweets: avgRetweets,
    verified: raw.verified || raw.isBlueVerified || false,
    top_posts: tweets.slice(0, 10).map(t => ({
      type: t.mediaType || (t.media?.length ? 'Media' : 'Text'),
      likes: t.likeCount || t.likes || t.favoriteCount || 0,
      comments: t.replyCount || t.replies || t.comments || 0,
      caption: (t.text || t.fullText || t.full_text || '').slice(0, 200),
      url: t.url || t.tweetUrl || '',
      video_views: t.viewCount || t.views || null,
      retweets: t.retweetCount || t.retweets || 0,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// LinkedIn Scraper
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape one or more LinkedIn company profiles.
 * @param {string[]} urls - Array of LinkedIn company URLs or slugs
 * @returns {Promise<Object[]>} Array of company data objects
 */
async function scrapeLinkedInCompanies(urls) {
  if (!urls.length) return [];
  const clean = urls.map(u => u.trim()).filter(Boolean);
  const fullUrls = clean.map(u =>
    u.startsWith('http') ? u : `https://www.linkedin.com/company/${u}`
  );
  console.log(`[Apify/LinkedIn] Scraping ${clean.length} companies: ${clean.join(', ')}`);
  return runApifyActor(ACTORS.linkedin, { urls: fullUrls }, 'LinkedIn');
}

/**
 * Extract clean stats from LinkedIn scraper output.
 */
function extractLinkedInStats(raw) {
  const posts = raw.posts || raw.updates || raw.recentPosts || [];
  const totalLikes = posts.reduce((s, p) => s + (p.likes || p.likesCount || p.numLikes || 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments || p.commentsCount || p.numComments || 0), 0);
  const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
  const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
  const followers = raw.followersCount || raw.followerCount || raw.followers || 0;
  const engagementRate = followers
    ? ((totalLikes + totalComments) / Math.max(posts.length, 1) / followers * 100).toFixed(2)
    : '0';

  return {
    platform: 'linkedin',
    username: raw.companyName || raw.name || raw.title || '',
    followers,
    following: 0, // LinkedIn companies don't follow
    posts_count: posts.length || 0,
    bio: raw.description || raw.about || raw.tagline || '',
    engagement_rate: `${engagementRate}%`,
    avg_likes: avgLikes,
    avg_comments: avgComments,
    verified: raw.verified || false,
    employees: raw.employeeCount || raw.staffCount || raw.employeesOnLinkedIn || 0,
    industry: raw.industry || raw.industries?.[0] || '',
    top_posts: posts.slice(0, 10).map(p => ({
      type: p.type || 'Post',
      likes: p.likes || p.likesCount || p.numLikes || 0,
      comments: p.comments || p.commentsCount || p.numComments || 0,
      caption: (p.text || p.commentary || p.title || '').slice(0, 200),
      url: p.url || p.postUrl || '',
      video_views: p.views || p.videoViews || null,
    })),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Master: scrapeAllPlatforms — run all scrapers in parallel
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scrape all available platforms for a brand and its competitors in parallel.
 *
 * @param {Object} brand - Brand object with platform handles
 * @param {Object[]} competitors - Array of competitor objects with platform handles
 * @returns {Promise<Object>} Map of { platformName: { brand: {...}, competitors: {...} } }
 */
async function scrapeAllPlatforms(brand, competitors = []) {
  const token = getToken();
  if (!token) throw new Error('APIFY_TOKEN not configured');

  // Gather handles per platform
  const platformHandles = {
    instagram: {
      brand: brand.instagram_handle?.replace('@', '') || '',
      competitors: competitors.map(c => (c.instagram || c.handle || '').replace('@', '')).filter(Boolean),
    },
    tiktok: {
      brand: brand.tiktok_handle?.replace('@', '') || '',
      competitors: competitors.map(c => (c.tiktok || '').replace('@', '')).filter(Boolean),
    },
    facebook: {
      brand: brand.facebook_handle || '',
      competitors: competitors.map(c => c.facebook || '').filter(Boolean),
    },
    youtube: {
      brand: brand.youtube_handle?.replace('@', '') || '',
      competitors: competitors.map(c => (c.youtube || '').replace('@', '')).filter(Boolean),
    },
    twitter: {
      brand: brand.x_handle?.replace('@', '') || brand.twitter_handle?.replace('@', '') || '',
      competitors: competitors.map(c => (c.x || c.twitter || '').replace('@', '')).filter(Boolean),
    },
    linkedin: {
      brand: brand.linkedin_handle || '',
      competitors: competitors.map(c => c.linkedin || '').filter(Boolean),
    },
  };

  // Map of platform → { scrapeFn, extractFn }
  const platformConfig = {
    instagram: {
      scrape: (handles) => scrapeInstagramProfiles(handles, 12),
      extract: extractProfileStats,
      buildHandles: (h) => h, // just usernames
    },
    tiktok: {
      scrape: scrapeTikTokProfiles,
      extract: extractTikTokStats,
      buildHandles: (h) => h,
    },
    facebook: {
      scrape: scrapeFacebookPages,
      extract: extractFacebookStats,
      buildHandles: (h) => h,
    },
    youtube: {
      scrape: scrapeYouTubeChannels,
      extract: extractYouTubeStats,
      buildHandles: (h) => h,
    },
    twitter: {
      scrape: scrapeTwitterProfiles,
      extract: extractTwitterStats,
      buildHandles: (h) => h,
    },
    linkedin: {
      scrape: scrapeLinkedInCompanies,
      extract: extractLinkedInStats,
      buildHandles: (h) => h,
    },
  };

  // Build per-platform scrape tasks (only for platforms that have at least one handle)
  const tasks = [];
  for (const [platform, handles] of Object.entries(platformHandles)) {
    const allHandles = [handles.brand, ...handles.competitors].filter(Boolean);
    if (!allHandles.length) continue;

    const config = platformConfig[platform];
    tasks.push({
      platform,
      promise: config.scrape(allHandles)
        .then(rawResults => {
          const extracted = {};
          for (const raw of rawResults) {
            const stats = config.extract(raw);
            const key = (stats.username || '').toLowerCase() || `item-${Object.keys(extracted).length}`;
            extracted[key] = stats;
          }
          return { platform, data: extracted };
        })
        .catch(err => {
          console.warn(`[Apify] ${platform} scrape failed (skipping): ${err.message}`);
          return { platform, data: {}, error: err.message };
        }),
    });
  }

  console.log(`[Apify] Running ${tasks.length} platform scrapers in parallel...`);
  const results = await Promise.allSettled(tasks.map(t => t.promise));

  const allData = {};
  for (const result of results) {
    const value = result.status === 'fulfilled' ? result.value : result.reason;
    if (value?.platform) {
      allData[value.platform] = value.data || {};
      if (value.error) {
        allData[value.platform]._error = value.error;
      }
    }
  }

  const platformCount = Object.keys(allData).filter(k => Object.keys(allData[k]).length > 0 || !allData[k]._error).length;
  console.log(`[Apify] All scrapers complete. Got data for ${platformCount} platforms.`);
  return allData;
}

export {
  scrapeInstagramProfiles,
  extractProfileStats,
  scrapeTikTokProfiles,
  extractTikTokStats,
  scrapeFacebookPages,
  extractFacebookStats,
  scrapeYouTubeChannels,
  extractYouTubeStats,
  scrapeTwitterProfiles,
  extractTwitterStats,
  scrapeLinkedInCompanies,
  extractLinkedInStats,
  scrapeAllPlatforms,
};
