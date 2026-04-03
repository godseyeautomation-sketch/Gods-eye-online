/**
 * Gods Eye Studio — MCP SSE Server
 *
 * Exposes the full platform as an MCP server so external clients
 * (Claude Desktop, Cursor, etc.) can use Gods Eye tools.
 *
 * Usage:
 *   import { mountMcpEndpoints } from './services/mcpServer.js';
 *   mountMcpEndpoints(app, { port: 8080 });
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ── Tool Declarations (MCP JSON Schema format) ─────────────────────────────

const MCP_TOOLS = [
  // ── Image ──
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt. Choose the best model and aspect ratio for the use case.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed image description. Be specific about style, lighting, composition, colors.' },
        model: { type: 'string', description: 'Image model. Options: gemini-3.1-flash-image-preview (default), gemini-3-pro-image-preview, gemini-2.5-flash-image, seedream-v4.5, flux-2-ultra, gpt-image-1.5, gpt-image-1, reve-1, z-image-turbo' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 4:5, 21:9, 3:2, 2:3' },
        quality: { type: 'string', description: 'Quality: 1K, 2K, or 4K. Only for Gemini models. Default: 2K' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: 'Generate a video from a text prompt. Long-running operation (30-120s).',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed video description including motion, camera angles, mood.' },
        aspect_ratio: { type: 'string', description: '16:9 (landscape) or 9:16 (vertical/stories)' },
        video_model: { type: 'string', description: 'Video model: kling-3-pro, veo-3.1-fast, veo-3.1, veo-3-fast, veo-3, kling-3, kling-2.6, wan-2.6, hailuo-2.3, sora-2' },
        image_url: { type: 'string', description: 'Optional image URL to animate (image-to-video)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edit an existing image with inpainting.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image to edit' },
        edit_prompt: { type: 'string', description: 'What to change in the image' },
      },
      required: ['image_url', 'edit_prompt'],
    },
  },
  {
    name: 'analyze_image',
    description: 'Analyze or describe an image.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: { type: 'string', description: 'URL of the image to analyze' },
        question: { type: 'string', description: 'Specific question about the image' },
      },
      required: ['image_url'],
    },
  },

  // ── Brand ──
  {
    name: 'scan_brand_website',
    description: 'Scan a website URL to extract brand DNA: colors, fonts, tone, style, products.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Website URL to scan' },
      },
      required: ['url'],
    },
  },
  {
    name: 'save_brand_profile',
    description: 'Save a brand profile to the database.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Brand name' },
        tagline: { type: 'string', description: 'Brand tagline' },
        industry: { type: 'string', description: 'Industry/niche' },
        audience: { type: 'string', description: 'Target audience' },
        tone: { type: 'string', description: 'Comma-separated brand tone words' },
        colors: { type: 'string', description: 'Comma-separated brand colors (hex)' },
        visual_style: { type: 'string', description: 'Visual style description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_brands',
    description: 'List all saved brand profiles for the user.',
    inputSchema: { type: 'object', properties: {} },
  },

  // ── Content ──
  {
    name: 'generate_content_calendar',
    description: 'Generate a full month of social media content slots with briefs and image prompts.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_name: { type: 'string', description: 'Brand name' },
        month: { type: 'number', description: 'Month number (1-12)' },
        year: { type: 'number', description: 'Year (e.g. 2026)' },
        posts_per_week: { type: 'number', description: 'Posts per week (default 3)' },
      },
      required: ['brand_name'],
    },
  },
  {
    name: 'generate_content_brief',
    description: 'Generate a single content brief with hook, caption, hashtags, and image prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_name: { type: 'string', description: 'Brand name' },
        topic: { type: 'string', description: 'Content topic or theme' },
        format: { type: 'string', description: 'Content format: post, story, or reel' },
      },
      required: ['brand_name', 'topic'],
    },
  },

  // ── Search ──
  {
    name: 'search_web',
    description: 'Search the web for real-time information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },

  // ── Social Media Publishing ──
  {
    name: 'publish_content',
    description: 'Publish content to social media platforms. Supports scheduling.',
    inputSchema: {
      type: 'object',
      properties: {
        caption: { type: 'string', description: 'Post caption/text' },
        platforms: { type: 'string', description: 'Comma-separated: instagram, tiktok, x, facebook, linkedin, youtube, threads, pinterest, bluesky, reddit' },
        media_url: { type: 'string', description: 'URL of image/video to post (optional)' },
        user: { type: 'string', description: 'Upload-Post profile username' },
        schedule_time: { type: 'string', description: 'ISO-8601 datetime to schedule (optional)' },
      },
      required: ['caption', 'platforms'],
    },
  },

  // ── Cron Jobs ──
  {
    name: 'manage_cron',
    description: 'Create, list, update, delete, or run scheduled cron jobs.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'Action: create, list, update, delete, run, task-types' },
        job_id: { type: 'string', description: 'Job ID (for update/delete/run)' },
        task_type: { type: 'string', description: 'research-trends, pull-analytics, weekly-strategy, auto-publish, competitor-scan, custom' },
        name: { type: 'string', description: 'Job name' },
        cron_expression: { type: 'string', description: 'Cron schedule (e.g. "0 9 * * 1")' },
        brand_id: { type: 'string', description: 'Brand ID scope (optional)' },
        config: { type: 'string', description: 'JSON string of additional config' },
        enabled: { type: 'boolean', description: 'Enable/disable' },
      },
      required: ['action'],
    },
  },

  // ── Connectors (Gmail, Drive, Slack, GitHub, Notion, Brave, Maps, Google Ads, Meta Ads) ──
  // Gmail
  { name: 'connector_gmail_search', description: 'Search Gmail inbox', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query' }, max_results: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
  { name: 'connector_gmail_read', description: 'Read a Gmail email by ID', inputSchema: { type: 'object', properties: { message_id: { type: 'string', description: 'Gmail message ID' } }, required: ['message_id'] } },
  { name: 'connector_gmail_send', description: 'Send an email via Gmail', inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email' }, subject: { type: 'string', description: 'Subject' }, body: { type: 'string', description: 'Body (plain text or HTML)' } }, required: ['to', 'subject', 'body'] } },
  { name: 'connector_gmail_labels', description: 'List Gmail labels', inputSchema: { type: 'object', properties: {} } },
  // Google Drive
  { name: 'connector_drive_search', description: 'Search Google Drive files', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, max_results: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
  { name: 'connector_drive_read', description: 'Read a Google Drive file', inputSchema: { type: 'object', properties: { file_id: { type: 'string', description: 'Drive file ID' } }, required: ['file_id'] } },
  // Slack
  { name: 'connector_slack_send', description: 'Send a Slack message', inputSchema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel name or ID' }, text: { type: 'string', description: 'Message text' } }, required: ['channel', 'text'] } },
  { name: 'connector_slack_channels', description: 'List Slack channels', inputSchema: { type: 'object', properties: {} } },
  { name: 'connector_slack_search', description: 'Search Slack messages', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
  // GitHub
  { name: 'connector_github_repos', description: 'List GitHub repositories', inputSchema: { type: 'object', properties: { sort: { type: 'string', description: 'Sort: updated, created, pushed' } } } },
  { name: 'connector_github_issues', description: 'List GitHub issues', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'owner/repo' }, state: { type: 'string', description: 'open, closed, all' } }, required: ['repo'] } },
  { name: 'connector_github_create_issue', description: 'Create a GitHub issue', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'owner/repo' }, title: { type: 'string', description: 'Title' }, body: { type: 'string', description: 'Body (markdown)' } }, required: ['repo', 'title'] } },
  { name: 'connector_github_prs', description: 'List GitHub pull requests', inputSchema: { type: 'object', properties: { repo: { type: 'string', description: 'owner/repo' }, state: { type: 'string', description: 'open, closed, all' } }, required: ['repo'] } },
  // Notion
  { name: 'connector_notion_search', description: 'Search Notion pages', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
  { name: 'connector_notion_read', description: 'Read a Notion page', inputSchema: { type: 'object', properties: { page_id: { type: 'string', description: 'Page ID' } }, required: ['page_id'] } },
  { name: 'connector_notion_create', description: 'Create a Notion page', inputSchema: { type: 'object', properties: { parent_id: { type: 'string', description: 'Parent page/database ID' }, title: { type: 'string', description: 'Title' }, content: { type: 'string', description: 'Content' } }, required: ['parent_id', 'title'] } },
  // Brave Search
  { name: 'connector_brave_search', description: 'Search the web via Brave', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, count: { type: 'number', description: 'Results count (default 5)' } }, required: ['query'] } },
  // Google Maps
  { name: 'connector_maps_search', description: 'Search places on Google Maps', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Place search query' } }, required: ['query'] } },
  { name: 'connector_maps_directions', description: 'Get directions between locations', inputSchema: { type: 'object', properties: { origin: { type: 'string', description: 'Start location' }, destination: { type: 'string', description: 'End location' }, mode: { type: 'string', description: 'driving, walking, bicycling, transit' } }, required: ['origin', 'destination'] } },
  // Google Ads
  { name: 'connector_google_ads_list_campaigns', description: 'List Google Ads campaigns', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID (optional)' } } } },
  { name: 'connector_google_ads_campaign_metrics', description: 'Get Google Ads campaign metrics', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, campaign_id: { type: 'string', description: 'Campaign ID' }, date_range: { type: 'string', description: 'LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH' } }, required: ['campaign_id'] } },
  { name: 'connector_google_ads_account_metrics', description: 'Get Google Ads account metrics', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, date_range: { type: 'string', description: 'LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH' } } } },
  { name: 'connector_google_ads_create_campaign', description: 'Create a Google Ads campaign', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, name: { type: 'string', description: 'Name' }, budget_micros: { type: 'number', description: 'Daily budget in micros' }, campaign_type: { type: 'string', description: 'SEARCH, DISPLAY, VIDEO, SHOPPING' } }, required: ['name', 'budget_micros'] } },
  { name: 'connector_google_ads_update_campaign', description: 'Update a Google Ads campaign', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, campaign_id: { type: 'string', description: 'Campaign ID' }, status: { type: 'string', description: 'ENABLED or PAUSED' }, budget_micros: { type: 'number', description: 'Budget in micros' } }, required: ['campaign_id'] } },
  { name: 'connector_google_ads_upload_asset', description: 'Upload image asset to Google Ads', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, image_url: { type: 'string', description: 'Image URL' }, asset_name: { type: 'string', description: 'Asset name' } }, required: ['image_url', 'asset_name'] } },
  { name: 'connector_google_ads_keyword_ideas', description: 'Get keyword suggestions with search volume', inputSchema: { type: 'object', properties: { customer_id: { type: 'string', description: 'Customer ID' }, keywords: { type: 'string', description: 'Seed keywords (comma-separated)' }, language: { type: 'string', description: 'Language code (default en)' } }, required: ['keywords'] } },
  // Meta Ads
  { name: 'connector_meta_ads_list_campaigns', description: 'List Meta ad campaigns', inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID (optional)' } } } },
  { name: 'connector_meta_ads_campaign_insights', description: 'Get Meta Ads campaign insights', inputSchema: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' }, date_preset: { type: 'string', description: 'last_7d, last_30d, this_month' } }, required: ['campaign_id'] } },
  { name: 'connector_meta_ads_account_insights', description: 'Get Meta Ads account insights', inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, date_preset: { type: 'string', description: 'last_7d, last_30d, this_month' } } } },
  { name: 'connector_meta_ads_create_campaign', description: 'Create a Meta Ads campaign', inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, name: { type: 'string', description: 'Name' }, objective: { type: 'string', description: 'OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_SALES' }, daily_budget: { type: 'number', description: 'Daily budget in cents' }, status: { type: 'string', description: 'ACTIVE or PAUSED' } }, required: ['name', 'daily_budget'] } },
  { name: 'connector_meta_ads_update_campaign', description: 'Update a Meta Ads campaign', inputSchema: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' }, name: { type: 'string' }, status: { type: 'string', description: 'ACTIVE or PAUSED' }, daily_budget: { type: 'number', description: 'Budget in cents' } }, required: ['campaign_id'] } },
  { name: 'connector_meta_ads_upload_creative', description: 'Upload image to Meta Ads', inputSchema: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, image_url: { type: 'string', description: 'Image URL' }, name: { type: 'string', description: 'Creative name' } }, required: ['image_url', 'name'] } },
  { name: 'connector_meta_ads_list_adsets', description: 'List Meta Ads ad sets', inputSchema: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' } }, required: ['campaign_id'] } },
];

// ── Session Management ──────────────────────────────────────────────────────

const sessions = new Map(); // sessionId → { transport, userId }

// ── Tool Execution ──────────────────────────────────────────────────────────

async function callInternalApi(baseUrl, path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return text; }
}

async function executeMcpTool(toolName, args, { baseUrl, userId }) {
  try {
    // ── Connector tools → /api/connectors/execute ──
    if (toolName.startsWith('connector_')) {
      const result = await callInternalApi(baseUrl, '/api/connectors/execute', 'POST', {
        user_id: userId,
        tool_name: toolName,
        args,
      });
      return JSON.stringify(result, null, 2);
    }

    // ── Platform tools ──
    switch (toolName) {
      case 'generate_image': {
        const result = await callInternalApi(baseUrl, '/api/gemini/image', 'POST', {
          prompt: args.prompt,
          model: args.model || 'gemini-3.1-flash-image-preview',
          aspect_ratio: args.aspect_ratio || '1:1',
          quality: args.quality || '2K',
        });
        return JSON.stringify(result, null, 2);
      }

      case 'generate_video': {
        // Submit to FAL queue
        const model = args.video_model || 'kling-3-pro';
        const submitResult = await callInternalApi(baseUrl, `/api/fal/${model}`, 'POST', {
          prompt: args.prompt,
          aspect_ratio: args.aspect_ratio || '16:9',
          image_url: args.image_url,
        });

        if (submitResult?.request_id && submitResult?.status_url) {
          // Poll for completion (max 5 minutes)
          const maxWait = 300000;
          const pollInterval = 5000;
          let elapsed = 0;

          while (elapsed < maxWait) {
            await new Promise(r => setTimeout(r, pollInterval));
            elapsed += pollInterval;

            try {
              const status = await callInternalApi(baseUrl, `/api/fal/${model}/status/${submitResult.request_id}`, 'GET');
              if (status?.status === 'COMPLETED' || status?.video?.url) {
                return JSON.stringify(status, null, 2);
              }
              if (status?.status === 'FAILED') {
                return JSON.stringify({ error: 'Video generation failed', details: status }, null, 2);
              }
            } catch { /* continue polling */ }
          }
          return JSON.stringify({ error: 'Video generation timed out (5 min)', request_id: submitResult.request_id }, null, 2);
        }
        return JSON.stringify(submitResult, null, 2);
      }

      case 'edit_image': {
        const result = await callInternalApi(baseUrl, '/api/gemini/edit', 'POST', {
          image_url: args.image_url,
          prompt: args.edit_prompt,
        });
        return JSON.stringify(result, null, 2);
      }

      case 'analyze_image': {
        const result = await callInternalApi(baseUrl, '/api/gemini/analyze', 'POST', {
          image_url: args.image_url,
          question: args.question || 'Describe this image in detail',
        });
        return JSON.stringify(result, null, 2);
      }

      case 'scan_brand_website': {
        const result = await callInternalApi(
          baseUrl,
          `/api/scrape-brand?url=${encodeURIComponent(args.url)}`,
          'GET'
        );
        return JSON.stringify(result, null, 2);
      }

      case 'save_brand_profile': {
        const result = await callInternalApi(baseUrl, '/api/sync/brand_profiles', 'POST', {
          user_id: userId,
          name: args.name,
          tagline: args.tagline,
          industry: args.industry,
          audience: args.audience,
          tone: args.tone?.split(',').map(t => t.trim()),
          colors: args.colors?.split(',').map(c => c.trim()),
          visual_style: args.visual_style,
        });
        return JSON.stringify(result, null, 2);
      }

      case 'list_brands': {
        const result = await callInternalApi(
          baseUrl,
          `/api/sync/brand_profiles?user_id=${encodeURIComponent(userId)}`,
          'GET'
        );
        return JSON.stringify(result, null, 2);
      }

      case 'generate_content_calendar': {
        // Use Gemini to generate calendar via the API
        const prompt = `Generate a social media content calendar for brand "${args.brand_name}" for ${args.month ? `month ${args.month}` : 'next month'} ${args.year || new Date().getFullYear()}. ${args.posts_per_week || 3} posts per week. Return as JSON array with fields: date, platform, hook, caption, hashtags, image_prompt.`;
        const result = await callInternalApi(baseUrl, '/api/gemini', 'POST', {
          prompt,
          model: 'gemini-2.5-flash',
        });
        return JSON.stringify(result, null, 2);
      }

      case 'generate_content_brief': {
        const prompt = `Generate a content brief for brand "${args.brand_name}" on topic "${args.topic}" in ${args.format || 'post'} format. Include: hook, caption, hashtags, image_prompt, posting_tips.`;
        const result = await callInternalApi(baseUrl, '/api/gemini', 'POST', {
          prompt,
          model: 'gemini-2.5-flash',
        });
        return JSON.stringify(result, null, 2);
      }

      case 'search_web': {
        // Use Brave Search connector if available, fallback to Gemini grounding
        const result = await callInternalApi(baseUrl, '/api/connectors/execute', 'POST', {
          user_id: userId,
          tool_name: 'connector_brave_search',
          args: { query: args.query, count: 10 },
        });
        return JSON.stringify(result, null, 2);
      }

      case 'publish_content': {
        const payload = {
          caption: args.caption,
          platforms: args.platforms?.split(',').map(p => p.trim()),
          media_url: args.media_url,
          user: args.user,
        };
        if (args.schedule_time) payload.schedule_time = args.schedule_time;

        const result = await callInternalApi(baseUrl, '/api/upload-post/photos', 'POST', payload);
        return JSON.stringify(result, null, 2);
      }

      case 'manage_cron': {
        const action = args.action;
        if (action === 'list') {
          const result = await callInternalApi(baseUrl, `/api/cron/jobs?user_id=${encodeURIComponent(userId)}`, 'GET');
          return JSON.stringify(result, null, 2);
        }
        if (action === 'create') {
          const result = await callInternalApi(baseUrl, '/api/cron/jobs', 'POST', { ...args, user_id: userId });
          return JSON.stringify(result, null, 2);
        }
        if (action === 'update' && args.job_id) {
          const result = await callInternalApi(baseUrl, `/api/cron/jobs/${args.job_id}`, 'PUT', { ...args, user_id: userId });
          return JSON.stringify(result, null, 2);
        }
        if (action === 'delete' && args.job_id) {
          const result = await callInternalApi(baseUrl, `/api/cron/jobs/${args.job_id}`, 'DELETE');
          return JSON.stringify(result, null, 2);
        }
        if (action === 'run' && args.job_id) {
          const result = await callInternalApi(baseUrl, `/api/cron/jobs/${args.job_id}/run`, 'POST', { user_id: userId });
          return JSON.stringify(result, null, 2);
        }
        return JSON.stringify({ error: `Unknown cron action: ${action}` });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err.message || String(err) });
  }
}

// ── Mount Express Endpoints ─────────────────────────────────────────────────

export function mountMcpEndpoints(app, { port = 8080 } = {}) {
  const apiKey = process.env.MCP_SERVER_API_KEY;

  // Info endpoint
  app.get('/api/mcp/info', (_req, res) => {
    res.json({
      name: 'gods-eye-studio',
      version: '2.1.0',
      description: 'Gods Eye Studio MCP Server — AI creative platform',
      tools: MCP_TOOLS.length,
      enabled: !!apiKey,
    });
  });

  if (!apiKey) {
    // MCP disabled — return 503 on SSE endpoint
    app.get('/api/mcp/sse', (_req, res) => {
      res.status(503).json({
        error: 'MCP server is disabled. Set MCP_SERVER_API_KEY environment variable to enable.',
      });
    });
    console.log('[MCP] SSE server disabled (MCP_SERVER_API_KEY not set)');
    return;
  }

  // Auth middleware for MCP endpoints
  function authMcp(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${apiKey}`) {
      return res.status(401).json({ error: 'Invalid or missing MCP API key' });
    }
    next();
  }

  // SSE endpoint — opens the event stream
  app.get('/api/mcp/sse', authMcp, async (req, res) => {
    const userId = req.query.user_id || 'anon';
    const baseUrl = `http://127.0.0.1:${port}`;

    console.log(`[MCP] New SSE connection from user=${userId}`);

    const transport = new SSEServerTransport('/api/mcp/messages', res);
    const sessionId = transport.sessionId;

    // Store session
    sessions.set(sessionId, { transport, userId });

    // Create a new MCP server for this session
    const server = new Server(
      { name: 'gods-eye-studio', version: '2.1.0' },
      { capabilities: { tools: {} } }
    );

    // Register tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: MCP_TOOLS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const result = await executeMcpTool(name, args || {}, { baseUrl, userId });
      return {
        content: [{ type: 'text', text: result }],
      };
    });

    // Clean up on close
    transport.onclose = () => {
      console.log(`[MCP] Session ${sessionId} closed`);
      sessions.delete(sessionId);
    };

    // Connect server to transport (starts the SSE stream)
    await server.connect(transport);
  });

  // Message endpoint — receives JSON-RPC messages from the client
  app.post('/api/mcp/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found. Connect to /api/mcp/sse first.' });
    }

    await session.transport.handlePostMessage(req, res);
  });

  console.log(`[MCP] SSE server enabled at /api/mcp/sse (${MCP_TOOLS.length} tools)`);
}
