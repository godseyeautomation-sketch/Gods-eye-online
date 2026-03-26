/**
 * Chat Orchestrator
 *
 * Central AI engine for the Gods Eye conversational home page.
 * - Multi-turn function calling loop with Gemini 2.5 Flash
 * - 11 tools: image gen, video gen, edit, analyze, brand scan, calendar, search, brain query, navigate
 * - Google Search grounding (native Gemini tool)
 * - RAG context injection from BrainContext
 * - Streaming text responses
 */

import { generateImage, editImage, analyzeImageToText } from './geminiService';
import { generateFalImage, submitJob, pollStatus, fetchResult, type FalVideoResult } from './falService';
import { scanWebsiteForBrandDNA, saveBrandProfile as saveBrandProfileDB, getBrandProfile, getAllBrandProfiles, generateMonthPlan, generateBrief, getSlotsForMonth } from './brandService';
import { saveVideoGeneration, saveVideoProject, getVideoProjects } from './localStorageService';
// uploadToFalStorage is handled internally by submitJob's resolveInputImages
import type { ChatMessage, ToolCallRecord, ChatAttachment, SearchResultEntry } from './conversationService';
import type { BrandProfile, ContentFormat } from '../types/brand.types';

// ── Tool Declarations (Gemini function calling format) ───────────────────────

const TOOL_DECLARATIONS = [
  {
    name: 'generate_image',
    description: 'Generate an image from a text prompt. Choose the best model and aspect ratio for the use case. Generated images auto-save to the Image gallery.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'Detailed image description. Be specific about style, lighting, composition, colors.' },
        model: { type: 'STRING', description: 'Image model. Options: gemini-3.1-flash-image-preview (default, best all-round), gemini-3-pro-image-preview (highest quality), gemini-2.5-flash-image (fastest), seedream-v4.5 (ByteDance, great detail), flux-2-ultra (photorealism), gpt-image-1.5 (OpenAI latest), gpt-image-1 (OpenAI realism), reve-1, z-image-turbo' },
        aspect_ratio: { type: 'STRING', description: 'Aspect ratio. Options: 1:1 (square), 16:9 (landscape), 9:16 (portrait/stories), 4:3, 3:4, 4:5 (social feed), 21:9 (cinematic), 3:2, 2:3. Choose based on use case.' },
        quality: { type: 'STRING', description: 'Quality: 1K, 2K, or 4K. Only applies to Gemini models. Default: 2K' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: 'Generate a video from a text prompt or animate an existing image. If the user has attached/uploaded an image in this conversation, the system will AUTOMATICALLY use it — you do NOT need an image URL. Just call this tool with a prompt describing the desired motion. Videos auto-save to the Video gallery. User can request a specific video model — always honor their choice.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'Detailed video description including motion, camera angles, mood, lighting.' },
        aspect_ratio: { type: 'STRING', description: 'Aspect ratio: 16:9 (landscape, default) or 9:16 (vertical/stories/reels)' },
        use_attached_image: { type: 'BOOLEAN', description: 'Set to true to animate the image the user attached in this conversation. The system handles the image automatically — no URL needed.' },
        video_model: { type: 'STRING', description: 'Video model to use. Options: kling-3-pro (best i2v fidelity, default for images), veo-3.1-fast (fastest, with audio), veo-3.1 (best quality with audio), veo-3-fast, veo-3, kling-3 (standard), kling-2.6, wan-2.6, hailuo-2.3, sora-2. If user asks for a specific model like "use veo 3" or "try kling", honor their choice.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: 'Edit an existing image with inpainting. Provide the image URL and edit instructions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        image_url: { type: 'STRING', description: 'URL of the image to edit' },
        edit_prompt: { type: 'STRING', description: 'What to change in the image' },
      },
      required: ['image_url', 'edit_prompt'],
    },
  },
  {
    name: 'analyze_image',
    description: 'Analyze or describe an image. Good for understanding what is in an image.',
    parameters: {
      type: 'OBJECT',
      properties: {
        image_url: { type: 'STRING', description: 'URL of the image to analyze' },
        question: { type: 'STRING', description: 'Specific question about the image' },
      },
      required: ['image_url'],
    },
  },
  {
    name: 'scan_brand_website',
    description: 'Scan a website URL to extract brand DNA: colors, fonts, tone, style, products.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Website URL to scan' },
      },
      required: ['url'],
    },
  },
  {
    name: 'save_brand_profile',
    description: 'Save a brand profile to the database for future use.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Brand name' },
        tagline: { type: 'STRING', description: 'Brand tagline' },
        industry: { type: 'STRING', description: 'Industry/niche' },
        audience: { type: 'STRING', description: 'Target audience' },
        tone: { type: 'STRING', description: 'Comma-separated brand tone words' },
        colors: { type: 'STRING', description: 'Comma-separated brand colors (hex)' },
        visual_style: { type: 'STRING', description: 'Visual style description' },
      },
      required: ['name'],
    },
  },
  {
    name: 'generate_content_calendar',
    description: 'Generate a full month of social media content slots with briefs and image prompts for a brand.',
    parameters: {
      type: 'OBJECT',
      properties: {
        brand_name: { type: 'STRING', description: 'Brand name to generate calendar for' },
        month: { type: 'NUMBER', description: 'Month number (1-12)' },
        year: { type: 'NUMBER', description: 'Year (e.g. 2026)' },
        posts_per_week: { type: 'NUMBER', description: 'Number of posts per week (default 3)' },
      },
      required: ['brand_name'],
    },
  },
  {
    name: 'generate_content_brief',
    description: 'Generate a single content brief with hook, caption, hashtags, and image prompt.',
    parameters: {
      type: 'OBJECT',
      properties: {
        brand_name: { type: 'STRING', description: 'Brand name' },
        topic: { type: 'STRING', description: 'Content topic or theme' },
        format: { type: 'STRING', description: 'Content format: post, story, or reel' },
      },
      required: ['brand_name', 'topic'],
    },
  },
  {
    name: 'search_brain',
    description: 'Search the user\'s trained creative memory/brain for relevant past work, styles, or brand info.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'What to search for in the brain' },
        top_k: { type: 'NUMBER', description: 'Number of results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for real-time information. ONLY use this when the user explicitly asks to search, research, look up, or find something online. Do NOT use for general conversation.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_brands',
    description: 'List all saved brand profiles for the user. Use this when the user asks about their brands, or when you need to know which brand to work with before generating content or calendars.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'navigate_to',
    description: 'Navigate to a specific page/tool in the app: IMAGE, VIDEO, EDIT, CHARACTER, BRAND, SPACES, APPS',
    parameters: {
      type: 'OBJECT',
      properties: {
        page: { type: 'STRING', description: 'Page to navigate to: IMAGE, VIDEO, EDIT, CHARACTER, BRAND, SPACES, APPS' },
      },
      required: ['page'],
    },
  },
  {
    name: 'publish_content',
    description: 'Publish content (text, image, or video) to social media platforms via Upload-Post. Supports scheduling.',
    parameters: {
      type: 'OBJECT',
      properties: {
        caption: { type: 'STRING', description: 'Post caption/text content' },
        platforms: { type: 'STRING', description: 'Comma-separated platforms: instagram, tiktok, x, facebook, linkedin, youtube, threads, pinterest, bluesky, reddit' },
        media_url: { type: 'STRING', description: 'URL of image/video to post (optional for text-only posts)' },
        user: { type: 'STRING', description: 'Upload-Post profile username to post as' },
        schedule_time: { type: 'STRING', description: 'ISO-8601 datetime to schedule the post (optional, posts immediately if omitted)' },
      },
      required: ['caption', 'platforms'],
    },
  },
  {
    name: 'manage_cron',
    description: 'Create, list, update, delete, or run scheduled cron jobs. Jobs are per-user and per-brand scoped. Available task types: research-trends (research trending topics), pull-analytics (pull engagement metrics), weekly-strategy (weekly content plan), auto-publish (publish scheduled posts), competitor-scan (analyze competitors), custom (run a custom prompt).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'Action: create, list, update, delete, run, task-types' },
        job_id: { type: 'STRING', description: 'Job ID (for update/delete/run actions)' },
        task_type: { type: 'STRING', description: 'Task type for create: research-trends, pull-analytics, weekly-strategy, auto-publish, competitor-scan, custom' },
        name: { type: 'STRING', description: 'Human-readable name for the job' },
        cron_expression: { type: 'STRING', description: 'Cron schedule (e.g. "0 15 * * *" for 3pm daily, "0 9 * * 1" for Monday 9am)' },
        brand_id: { type: 'STRING', description: 'Brand ID to scope this job to (optional)' },
        config: { type: 'STRING', description: 'JSON string of additional config (e.g. {"prompt":"...", "competitors":["@handle1"]}' },
        enabled: { type: 'BOOLEAN', description: 'Enable or disable the job' },
      },
      required: ['action'],
    },
  },
];

const SYSTEM_PROMPT = `You are Gods Eye, an elite AI creative studio assistant powering "Gods Eye Studio v2.1".

═══ PLATFORM CAPABILITIES ═══

IMAGE GENERATION MODELS (use in generate_image tool):
• gemini-3.1-flash-image-preview — Google's newest, pro quality at flash speed (DEFAULT, recommended)
• gemini-3-pro-image-preview — Google flagship, highest quality (Pro)
• gemini-2.5-flash-image — Google fastest model
• seedream-v4.5 — ByteDance Seedream 4.5, exceptional detail up to 4K
• seedream-v4 — ByteDance Seedream 4.0
• flux-2-ultra — Black Forest Labs FLUX.2, state-of-the-art photorealism
• gpt-image-1.5 — OpenAI's latest, high-fidelity with strong prompt adherence
• gpt-image-1 — OpenAI GPT Image 1, exceptional realism
• reve-1 — High-fidelity with outstanding color accuracy
• z-image-turbo — Fast creative synthesis

ASPECT RATIOS (use in generate_image & generate_video):
• 1:1 — Square (Instagram posts, profile pics)
• 16:9 — Landscape (YouTube, presentations, desktop wallpapers)
• 9:16 — Portrait (Instagram Stories, TikTok, Reels)
• 4:3 — Classic landscape (traditional photos)
• 3:4 — Classic portrait
• 4:5 — Social post (Instagram feed optimal)
• 21:9 — Cinematic ultrawide
• 3:2 — Wide (photography standard)
• 2:3 — Tall portrait

IMAGE QUALITY (Gemini models only): 1K, 2K, 4K

VIDEO GENERATION (use video_model parameter to switch):
• kling-3-pro — Best image-to-video fidelity (DEFAULT for i2v)
• veo-3.1-fast — Fastest, with audio (DEFAULT for t2v)
• veo-3.1 — Best quality Veo, with audio
• veo-3-fast / veo-3 — Google Veo 3
• kling-3 / kling-2.6 — Kling alternatives
• wan-2.6 — Wan video model
• hailuo-2.3 — Minimax Hailuo
• sora-2 — OpenAI Sora
• IMPORTANT: When user attaches an image and asks to animate/make a video, IMMEDIATELY call generate_video with use_attached_image=true. Do NOT ask for a URL — the system handles the image automatically.
• If user asks to "try veo 3" or "use kling", pass the corresponding video_model. NEVER refuse — always honor model requests.

OTHER TOOLS:
• Edit images with inpainting (change parts of existing images)
• Scan websites to extract brand DNA (colors, fonts, tone, products)
• Build content calendars with briefs and image prompts
• Search the web for real-time information (Google Search built in)
• Query user's trained creative memory (Brain/RAG)
• Navigate to app sections: IMAGE, VIDEO, EDIT, CHARACTER, BRAND, SPACES, APPS
• PUBLISH to social media (10+ platforms): Instagram, TikTok, X, Facebook, LinkedIn, YouTube, Threads, Pinterest, Bluesky, Reddit. Use publish_content tool. Can schedule posts for later.
• SCHEDULED TASKS (Cron): Create automated recurring tasks using manage_cron tool. Available agents:
  - research-trends: Research trending topics daily (uses web search)
  - pull-analytics: Pull engagement metrics from social platforms
  - weekly-strategy: Generate weekly content calendar
  - auto-publish: Automatically publish scheduled posts
  - competitor-scan: Analyze competitor social media
  - custom: Run any custom AI prompt on schedule
  Cron format: "minute hour day month weekday" (e.g. "0 15 * * *" = 3pm daily, "0 9 * * 1" = Monday 9am)
  Each job is scoped to the user and optionally to a specific brand — jobs NEVER cross user boundaries.

═══ BRAND HANDLING ═══

• Use list_brands to see the user's saved brands when needed for content/calendar tasks.
• When the user asks to create brand content, a calendar, or mentions "my brand" without specifying which one:
  1. Call list_brands to check their saved brands
  2. If they have exactly ONE brand, use that brand automatically
  3. If they have MULTIPLE brands, ask "Which brand should I use?" and list them
  4. If they have NO brands, suggest scanning their website with scan_brand_website
• NEVER show a brand selector UI — handle brand selection through natural conversation.

═══ CRITICAL RULES — ALWAYS FOLLOW ═══

1. ALWAYS USE TOOLS. Never describe what you would do — call the tool immediately.
2. When asked to generate an image, ALWAYS call generate_image with a detailed prompt. Choose the best model and aspect ratio for the use case:
   - Social media post → 4:5 or 1:1 ratio, gemini-3.1-flash-image-preview
   - Instagram Story/Reel → 9:16 ratio
   - YouTube thumbnail → 16:9 ratio
   - Product photo → 1:1 or 4:5, use seedream-v4.5 or gpt-image-1.5 for realism
   - Artistic/creative → flux-2-ultra or gemini-3.1-flash-image-preview
   - Fast iteration → gemini-2.5-flash-image
3. When the user mentions ANY brand name, IMMEDIATELY use search_web to research that brand first. Use findings to inform content creation.
4. When asked to create a social media post:
   a) First search_web for the brand
   b) Then generate_image with the right aspect ratio for the platform (9:16 for stories, 4:5 for feed, 16:9 for YouTube)
   c) Then write caption, hook, hashtags, and CTA
5. When asked about a brand, scan their website with scan_brand_website (if URL given) or search_web.
6. When the user shares images, analyze them and use context in your generations.
7. When creating videos, choose the right aspect ratio (16:9 for landscape, 9:16 for vertical/stories).
8. Generated images automatically appear in the Image gallery. Generated videos appear in the Video gallery. Users can like/heart images to train the AI brain.
9. Be confident, proactive, and concise. After generating, describe what was created briefly.
10. ALWAYS generate visuals when asked for content — never just write text.
11. When asked to post/publish/share content to social media, use publish_content. If the user generated an image in this conversation, include the image URL. Always confirm which platforms before publishing.`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorCallbacks {
  onChunk: (text: string) => void;
  onToolCall: (toolCall: ToolCallRecord) => void;
  onToolResult: (toolName: string, result: any) => void;
  onAttachment: (attachment: ChatAttachment) => void;
  onSearchResults: (results: SearchResultEntry[]) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
  // Context providers
  getRAGContext: (prompt: string, topK?: number) => Promise<string>;
  searchBrain: (query: string, topK?: number) => Promise<any[]>;
  onNavigate: (mode: string) => void;
  userId: string;
  model?: string; // Chat model ID (e.g. 'gemini-2.5-flash', 'gemini-3.1-flash-preview')
  personality?: any; // User's creative personality profile from onboarding
  skillOverride?: string; // Temporary skill/agent system prompt override
  conversationId?: string; // Active conversation ID — used for scoping video projects
  conversationTitle?: string; // Active conversation title — used as video project name
  brandContext?: string; // Active brand DNA summary for brand-aware responses
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: any[];
}

// ── Tool Execution ───────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  callbacks: OrchestratorCallbacks,
  lastImageDataUrl?: string,
): Promise<any> {
  switch (toolName) {
    case 'generate_image': {
      const urls = await generateImage({
        prompt: args.prompt,
        model: args.model || 'gemini-3.1-flash-image-preview',
        aspectRatio: args.aspect_ratio || '1:1',
        quality: args.quality || '2K',
        userId: callbacks.userId,
        saveToGallery: true,
      });
      if (urls.length > 0) {
        for (const url of urls) {
          callbacks.onAttachment({ type: 'image', url, prompt: args.prompt, model: args.model });
        }
      }
      return { success: true, count: urls.length, urls };
    }

    case 'generate_video': {
      const aspect = args.aspect_ratio || '16:9';
      // Use the attached image from chat context when requested
      let imageUrl: string | undefined;
      if (args.use_attached_image || args.image_url) {
        imageUrl = args.image_url || lastImageDataUrl;
      } else if (lastImageDataUrl) {
        // Auto-detect: if user attached an image and asks to animate/make video, use it
        imageUrl = lastImageDataUrl;
      }
      const hasImage = !!imageUrl;

      // Model selection — user can override, otherwise smart defaults
      const VIDEO_MODELS: Record<string, { t2v: string; i2v: string; name: string; family: string }> = {
        'kling-3-pro':   { t2v: 'fal-ai/kling-video/v3/pro/text-to-video', i2v: 'fal-ai/kling-video/v3/pro/image-to-video', name: 'Kling 3.0 Pro', family: 'kling' },
        'kling-3':       { t2v: 'fal-ai/kling-video/v3/standard/text-to-video', i2v: 'fal-ai/kling-video/v3/standard/image-to-video', name: 'Kling 3.0', family: 'kling' },
        'kling-2.6':     { t2v: 'fal-ai/kling-video/v2.6/pro/text-to-video', i2v: 'fal-ai/kling-video/v2.6/pro/image-to-video', name: 'Kling 2.6', family: 'kling' },
        'veo-3.1-fast':  { t2v: 'fal-ai/veo3.1/fast', i2v: 'fal-ai/veo3.1/image-to-video', name: 'Veo 3.1 Fast', family: 'veo' },
        'veo-3.1':       { t2v: 'fal-ai/veo3.1', i2v: 'fal-ai/veo3.1/image-to-video', name: 'Veo 3.1', family: 'veo' },
        'veo-3-fast':    { t2v: 'fal-ai/veo3/fast', i2v: 'fal-ai/veo3/fast/image-to-video', name: 'Veo 3 Fast', family: 'veo' },
        'veo-3':         { t2v: 'fal-ai/veo3', i2v: '', name: 'Veo 3', family: 'veo' },
        'wan-2.6':       { t2v: 'fal-ai/wan/v2.6', i2v: 'fal-ai/wan/v2.6/image-to-video', name: 'Wan 2.6', family: 'wan' },
        'hailuo-2.3':    { t2v: 'fal-ai/minimax/hailuo-2.3/pro/text-to-video', i2v: 'fal-ai/minimax/hailuo-2.3/pro/image-to-video', name: 'Hailuo 2.3', family: 'hailuo' },
        'sora-2':        { t2v: 'fal-ai/sora/v2', i2v: '', name: 'Sora 2', family: 'sora' },
      };

      const defaultT2V = 'veo-3.1-fast';
      const defaultI2V = 'kling-3-pro';
      const selectedKey = args.video_model || (hasImage ? defaultI2V : defaultT2V);
      const model = VIDEO_MODELS[selectedKey] || VIDEO_MODELS[hasImage ? defaultI2V : defaultT2V]!;

      const falModelId = hasImage ? (model.i2v || model.t2v) : model.t2v;
      const modelDisplayName = model.name + (hasImage ? ' (I2V)' : '');

      // Build input based on model family
      let input: Record<string, any>;
      if (hasImage && model.family === 'kling') {
        input = {
          prompt: args.prompt,
          image_url: imageUrl,
          aspect_ratio: aspect,
          duration: '5',
          negative_prompt: 'blur, distort, morph, change logo, change text, deform product',
        };
      } else if (hasImage && model.family === 'veo') {
        input = {
          prompt: args.prompt,
          image_url: imageUrl,
          aspect_ratio: 'auto',
          duration: '6s',
          resolution: '720p',
          generate_audio: true,
          safety_tolerance: '4',
        };
      } else if (hasImage) {
        // Generic i2v (wan, hailuo, etc.)
        input = {
          prompt: args.prompt,
          image_url: imageUrl,
          aspect_ratio: aspect,
        };
      } else {
        // Text-to-video
        input = model.family === 'veo' ? {
          prompt: args.prompt,
          aspect_ratio: aspect,
          duration: '6s',
          resolution: '720p',
          generate_audio: true,
          safety_tolerance: '4',
        } : {
          prompt: args.prompt,
          aspect_ratio: aspect,
          duration: '5',
        };
      }

      // submitJob's resolveInputImages will auto-upload data URLs to fal storage
      console.log('[Orchestrator] Submitting video job:', falModelId, 'hasImage:', hasImage);
      const { statusUrl, responseUrl } = await submitJob(falModelId, input);

      // Poll until done (max 5 minutes)
      let attempts = 0;
      const MAX_POLL = 60;
      while (attempts < MAX_POLL) {
        attempts++;
        await new Promise(r => setTimeout(r, 5000));
        const status = await pollStatus(statusUrl);
        console.log('[Orchestrator] Video poll:', status.status, 'attempt:', attempts);
        if (status.status === 'COMPLETED') break;
        if (status.status === 'FAILED') throw new Error('Video generation failed on fal.ai');
      }
      if (attempts >= MAX_POLL) throw new Error('Video generation timed out');

      // Fetch result
      const result: FalVideoResult = await fetchResult(responseUrl);
      const videoUrl = result.video?.url || result.videos?.[0]?.url || result.video_url || '';
      if (!videoUrl) throw new Error('No video URL in result');

      callbacks.onAttachment({ type: 'video', url: videoUrl, prompt: args.prompt });

      // Save to video gallery — scoped to conversation
      try {
        const convProjectId = callbacks.conversationId ? `conv-${callbacks.conversationId}` : 'chat-generations';
        const convProjectName = callbacks.conversationTitle || 'Chat Generations';
        const existingProjects = await getVideoProjects();
        const existingProject = existingProjects.find(p => p.id === convProjectId);
        if (!existingProject) {
          await saveVideoProject({
            id: convProjectId,
            name: convProjectName,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        } else if (existingProject.name !== convProjectName) {
          // Conversation was renamed — update project name to match
          await saveVideoProject({ ...existingProject, name: convProjectName, updatedAt: Date.now() });
        }

        await saveVideoGeneration({
          id: crypto.randomUUID(),
          url: videoUrl,
          prompt: args.prompt,
          modelName: modelDisplayName,
          aspectRatio: aspect,
          createdAt: Date.now(),
          projectId: convProjectId,
        });
      } catch (e) { console.warn('[Orchestrator] Failed to save video to gallery:', e); }
      return { success: true, url: videoUrl };
    }

    case 'edit_image': {
      const editedUrl = await editImage(
        args.image_url, '', args.edit_prompt, 'gemini-3.1-flash-image-preview'
      );
      callbacks.onAttachment({ type: 'image', url: editedUrl, prompt: args.edit_prompt });
      return { success: true, url: editedUrl };
    }

    case 'analyze_image': {
      const description = await analyzeImageToText({
        imageDataUrl: args.image_url,
        prompt: args.question || 'Describe this image in detail.',
      });
      return { description };
    }

    case 'scan_brand_website': {
      const brandDNA = await scanWebsiteForBrandDNA(args.url);
      return brandDNA;
    }

    case 'save_brand_profile': {
      const profile = await saveBrandProfileDB(callbacks.userId, {
        name: args.name,
        tagline: args.tagline || '',
        industry: args.industry || '',
        audience: args.audience || '',
        tone: args.tone ? args.tone.split(',').map((t: string) => t.trim()) : [],
        colors: args.colors ? args.colors.split(',').map((c: string) => c.trim()) : [],
        visual_style: args.visual_style || '',
      } as any);
      return { success: true, profile };
    }

    case 'generate_content_calendar': {
      // First get the brand profile
      const brands = await getAllBrandProfiles(callbacks.userId);
      const brand = brands.find((b: any) => b.name?.toLowerCase().includes(args.brand_name?.toLowerCase())) || brands[0];
      if (!brand) return { error: 'No brand profile found. Please scan a brand website first or save a brand profile.' };

      const month = args.month || new Date().getMonth() + 1;
      const year = args.year || new Date().getFullYear();
      const result = await generateMonthPlan(
        brand as BrandProfile, year, month, '', args.posts_per_week || 12
      );
      return { success: true, slots: result };
    }

    case 'generate_content_brief': {
      const brands = await getAllBrandProfiles(callbacks.userId);
      const brand = brands.find((b: any) => b.name?.toLowerCase().includes(args.brand_name?.toLowerCase())) || brands[0];
      if (!brand) return { error: 'No brand profile found. Please scan a brand website first or save a brand profile.' };

      const brief = await generateBrief(
        brand as BrandProfile,
        { slot_date: new Date().toISOString().split('T')[0], format: (args.format || 'post') as ContentFormat, idea: args.topic }
      );
      return brief;
    }

    case 'search_brain': {
      const results = await callbacks.searchBrain(args.query, args.top_k || 5);
      return { results: results.map((r: any) => ({ text: r.entry?.text, score: r.score, type: r.entry?.type })) };
    }

    case 'list_brands': {
      const brands = await getAllBrandProfiles(callbacks.userId);
      if (brands.length === 0) return { brands: [], message: 'No brands saved yet. Ask the user to scan a website or create a brand profile.' };
      return { brands: brands.map((b: any) => ({ id: b.id, name: b.name, industry: b.industry, tagline: b.tagline })) };
    }

    case 'search_web': {
      // Separate Gemini call with google_search tool only (can't combine with function calling)
      const searchRes = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: args.query }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
        }),
      });
      if (!searchRes.ok) {
        return { error: 'Web search failed' };
      }
      const searchData = await searchRes.json();
      const candidate = searchData.candidates?.[0];
      const searchText = candidate?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('') || '';

      // Extract grounding sources if available
      const chunks = candidate?.groundingMetadata?.groundingChunks || [];
      const sources: SearchResultEntry[] = chunks
        .filter((c: any) => c.web)
        .map((c: any) => ({ title: c.web.title || 'Source', url: c.web.uri || '', snippet: '' }));

      if (sources.length > 0) {
        callbacks.onSearchResults(sources);
      }

      return { answer: searchText, sources: sources.map((s: any) => ({ title: s.title, url: s.url })) };
    }

    case 'navigate_to': {
      callbacks.onNavigate(args.page);
      return { success: true, navigated_to: args.page };
    }

    case 'publish_content': {
      const platforms = (args.platforms || '').split(',').map((p: string) => p.trim().toLowerCase()).filter(Boolean);
      if (platforms.length === 0) return { error: 'No platforms specified. Supported: instagram, tiktok, x, facebook, linkedin, youtube, threads, pinterest, bluesky, reddit' };

      // Determine media URL — priority: explicit > conversation image > latest approved slot > gallery
      let mediaUrl = args.media_url || lastImageDataUrl;

      // If no image provided, try to find the latest approved slot image from user's brands
      if (!mediaUrl) {
        try {
          const brands = await getAllBrandProfiles(callbacks.userId);
          const brand = args.brand_name
            ? brands.find((b: any) => b.name?.toLowerCase().includes(args.brand_name?.toLowerCase()))
            : brands[0];
          if (brand) {
            const now = new Date();
            const slots = await getSlotsForMonth(brand.id, now.getFullYear(), now.getMonth() + 1);
            const approved = slots
              .filter(s => s.approved && s.generated_image)
              .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
            if (approved.length > 0) {
              mediaUrl = approved[0].generated_image!;
              // Use the slot's caption if user didn't provide one
              if (!args.caption && approved[0].brief) {
                args.caption = [approved[0].brief.hook, approved[0].brief.caption, approved[0].brief.call_to_action]
                  .filter(Boolean).join('\n\n');
                if (approved[0].brief.hashtags?.length) {
                  args.caption += '\n\n' + approved[0].brief.hashtags.map((h: string) => `#${h.replace(/^#/, '')}`).join(' ');
                }
              }
            }
          }
        } catch (e) {
          console.warn('[Orchestrator] Failed to find approved slot:', e);
        }
      }

      // Build request body
      const body: Record<string, any> = {
        platforms,
        user: args.user || 'default',
        caption: args.caption,
        async_upload: true,
      };
      if (args.schedule_time) body.scheduled_date = args.schedule_time;

      let endpoint = '/api/upload-post/text';
      if (mediaUrl) {
        // Detect if it's a video URL
        const isVideo = /\.(mp4|mov|avi|webm)(\?|$)/i.test(mediaUrl) || mediaUrl.includes('video');
        endpoint = isVideo ? '/api/upload-post/videos' : '/api/upload-post/photos';
        body.media_url = mediaUrl;
        if (isVideo) body.title = args.caption?.substring(0, 100);
      } else {
        body.text = args.caption;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (!res.ok) return { error: result.error || `Publishing failed: ${res.status}` };

      return {
        success: true,
        message: args.schedule_time ? `Scheduled for ${args.schedule_time}` : 'Published successfully!',
        platforms,
        request_id: result.request_id,
        total_platforms: result.total_platforms || platforms.length,
      };
    }

    case 'manage_cron': {
      const action = args.action;
      const userId = callbacks.userId;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      try {
        switch (action) {
          case 'list': {
            const res = await fetch(`/api/cron/jobs?user_id=${userId}`);
            return await res.json();
          }
          case 'create': {
            if (!args.cron_expression) return { error: 'cron_expression is required for create' };
            const prompt = args.config ? (() => { try { return JSON.parse(args.config).prompt || args.name; } catch { return args.name; } })() : args.name;
            const body: any = {
              user_id: userId,
              brand_id: args.brand_id || null,
              name: args.name || args.task_type || 'Scheduled Task',
              prompt: prompt || args.name,
              cron_expression: args.cron_expression,
              agent_type: args.task_type || 'research',
              timezone: 'Asia/Kolkata',
            };
            const res = await fetch(`/api/cron/jobs`, { method: 'POST', headers, body: JSON.stringify(body) });
            return await res.json();
          }
          case 'update': {
            if (!args.job_id) return { error: 'job_id is required for update' };
            const updates: any = {};
            if (args.cron_expression) updates.cron_expression = args.cron_expression;
            if (args.name) updates.name = args.name;
            if (args.enabled !== undefined) updates.is_active = args.enabled;
            const res = await fetch(`/api/cron/jobs/${args.job_id}`, { method: 'PATCH', headers, body: JSON.stringify(updates) });
            return await res.json();
          }
          case 'delete': {
            if (!args.job_id) return { error: 'job_id is required for delete' };
            const res = await fetch(`/api/cron/jobs/${args.job_id}`, { method: 'DELETE', headers });
            return await res.json();
          }
          case 'run': {
            if (!args.job_id) return { error: 'job_id is required for run' };
            const res = await fetch(`/api/cron/jobs/${args.job_id}/run`, { method: 'POST', headers });
            return await res.json();
          }
          default:
            return { error: `Unknown cron action: ${action}. Use: create, list, update, delete, run` };
        }
      } catch (err: any) {
        return { error: `Cron operation failed: ${err.message}` };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── Build Gemini Contents Array ──────────────────────────────────────────────

function buildContents(messages: ChatMessage[], ragContext: string, personality?: any, brandContext?: string, skillOverride?: string): GeminiContent[] {
  const contents: GeminiContent[] = [];

  // System instruction as first user message
  let systemText = `System: ${SYSTEM_PROMPT}`;

  // Inject active skill/agent override
  if (skillOverride) {
    systemText += `\n\n═══ ACTIVE SKILL/AGENT INSTRUCTIONS ═══
${skillOverride}
═══ END SKILL INSTRUCTIONS ═══
Follow these instructions for this conversation. Use the available tools as needed.`;
  }

  // Inject per-user personality profile
  if (personality) {
    const vibeLabels: Record<string, string> = {
      minimalist: 'Minimalist (clean, simple)', bold_vibrant: 'Bold & Vibrant (bright, energetic)',
      cinematic: 'Cinematic (dramatic, film-like)', vintage: 'Vintage/Retro (nostalgic, warm)',
      futuristic: 'Futuristic (neon, tech, sci-fi)', organic: 'Organic/Natural (earthy, soft)',
    };
    const interactionLabels: Record<string, string> = {
      quick: 'Quick & Direct — get to the point, less explanation',
      detailed: 'Detailed & Thorough — explain options, give context',
      experimental: 'Experimental & Surprising — try unexpected ideas, push boundaries',
      guided: 'Guide step by step — help the user decide',
    };
    const vibes = (personality.vibes || []).map((v: string) => vibeLabels[v] || v).join(', ');
    const useCases = (personality.use_cases || []).map((u: string) => u.replace(/_/g, ' ')).join(', ');
    const interaction = interactionLabels[personality.interaction_style] || personality.interaction_style;

    systemText += `\n\n═══ USER CREATIVE PROFILE ═══
- Name: ${personality.name || 'User'}
- Role: ${(personality.role || '').replace(/_/g, ' ')}
- Creative Style: ${vibes}
- Creates: ${useCases}
- Interaction Preference: ${interaction}

Adapt your creative suggestions, image prompts, visual style choices, and content tone to match this user's profile. Use their preferred creative style when generating images and content.`;

    // Inject SOUL — the AI's personality and behavioral core
    if (personality.soul) {
      systemText += `\n\n═══ YOUR SOUL ═══
${personality.soul}

This is your core personality. Follow these behavioral directives in EVERY response. They define how you think, speak, and act. This takes priority over generic AI behavior.`;
    }
  }
  // Inject active brand context
  if (brandContext) {
    systemText += `\n\n═══ ACTIVE BRAND CONTEXT ═══
${brandContext}

The user has this brand selected. When they ask to create content, generate images, plan calendars, or write captions — use this brand's identity, tone, colors, visual style, and products. Always stay on-brand.`;
  }

  if (ragContext) {
    systemText += `\n\n${ragContext}`;
  }

  // Build alternating user/model messages
  for (const msg of messages) {
    if (msg.role === 'system') continue;

    const role = msg.role === 'user' ? 'user' : 'model';
    const parts: any[] = [];

    // For the first user message, prepend system instructions
    if (role === 'user' && contents.length === 0) {
      parts.push({ text: systemText + '\n\nUser: ' + msg.content });
    } else {
      parts.push({ text: msg.content });
    }

    // Include attached images as inline data (so Gemini can see them)
    if (role === 'user' && (msg as any).imageDataUrls?.length > 0) {
      for (const dataUrl of (msg as any).imageDataUrls) {
        if (dataUrl?.startsWith('data:')) {
          const mimeMatch = dataUrl.match(/^data:(image\/\w+);base64,/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
          const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
          parts.push({ inlineData: { mimeType, data: base64Data } });
        }
      }
    }

    contents.push({ role, parts });
  }

  // If no messages yet (shouldn't happen), add system as user
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: systemText }] });
  }

  return contents;
}

// ── Main Send Function ───────────────────────────────────────────────────────

export async function sendMessage(
  messages: ChatMessage[],
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  try {
    // 1. Get RAG context
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    let ragContext = '';
    if (lastUserMsg) {
      try {
        ragContext = await callbacks.getRAGContext(lastUserMsg.content, 5);
      } catch { /* RAG failure is non-fatal */ }
    }

    // Extract the last user-attached image data URL (for image-to-video etc.)
    let lastImageDataUrl: string | undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as any;
      if (m.role === 'user' && m.imageDataUrls?.length > 0) {
        lastImageDataUrl = m.imageDataUrls[m.imageDataUrls.length - 1];
        break;
      }
    }

    // 2. Build contents
    let contents = buildContents(messages, ragContext, callbacks.personality, callbacks.brandContext, callbacks.skillOverride);

    // 3. Build request with tools + Google Search grounding
    const requestBody: any = {
      contents,
      tools: [
        { functionDeclarations: TOOL_DECLARATIONS },
      ],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    };

    // 4. Multi-turn tool execution loop (max 8 iterations)
    let iterations = 0;
    const MAX_ITERATIONS = 8;
    const chatModel = callbacks.model || 'gemini-2.5-flash';
    const isKimiModel = chatModel.startsWith('kimi-');

    // ── KIMI (Moonshot) ROUTING — OpenAI-compatible API ──
    if (isKimiModel) {
      // Convert Gemini-format messages to OpenAI-format for Kimi
      const kimiMessages: any[] = [];
      // Extract system text from the first user message (Gemini format embeds it there)
      const firstContent = contents[0];
      const firstText = firstContent?.parts?.[0]?.text || '';
      const systemPart = firstText.includes('\n\nUser: ') ? firstText.split('\n\nUser: ')[0] : SYSTEM_PROMPT;
      kimiMessages.push({ role: 'system', content: systemPart });
      // Conversation messages
      for (let i = 0; i < contents.length; i++) {
        const msg = contents[i];
        const role = msg.role === 'model' ? 'assistant' : 'user';
        const textParts = (msg.parts || []).filter((p: any) => p.text);
        let text = textParts.map((p: any) => p.text).join('');
        // First user message has system prepended — extract just the user part
        if (i === 0 && role === 'user' && text.includes('\n\nUser: ')) {
          text = text.split('\n\nUser: ').slice(1).join('\n\nUser: ');
        }
        if (text) kimiMessages.push({ role, content: text });
      }

      const kimiResponse = await fetch('/api/kimi/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'kimi-k2-0711',
          messages: kimiMessages,
          temperature: 0.7,
          max_tokens: 8192,
        }),
      });

      if (!kimiResponse.ok) {
        const err = await kimiResponse.json().catch(() => ({}));
        throw new Error(err.error?.message || `Kimi API Error: ${kimiResponse.status}`);
      }

      const kimiData = await kimiResponse.json();
      const kimiText = kimiData.choices?.[0]?.message?.content || '';

      if (kimiText) {
        // Stream-simulate for smooth UX
        const words = kimiText.split(' ');
        let accumulated = '';
        for (let i = 0; i < words.length; i++) {
          accumulated += (i > 0 ? ' ' : '') + words[i];
          callbacks.onChunk(accumulated);
          if (i < 50) await new Promise(r => setTimeout(r, 15));
        }

        return {
          text: kimiText,
          toolCalls: [],
          attachments: [],
          searchResults: [],
        };
      }
      throw new Error('No response from Kimi');
    }

    // ── GEMINI ROUTING ──
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await fetch(`/api/gemini/models/${chatModel}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `API Error: ${response.status}`);
      }

      const data = await response.json();
      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error('No response from AI');

      // Check for Google Search grounding metadata
      if (candidate.groundingMetadata?.groundingChunks) {
        const searchResults: SearchResultEntry[] = candidate.groundingMetadata.groundingChunks
          .filter((c: any) => c.web)
          .map((c: any) => ({
            title: c.web.title || 'Web result',
            url: c.web.uri || '',
            snippet: '',
          }));
        if (searchResults.length > 0) {
          callbacks.onSearchResults(searchResults);
        }
      }

      const parts = candidate.content?.parts || [];

      // Check if any part is a function call
      const functionCallPart = parts.find((p: any) => p.functionCall);

      if (functionCallPart) {
        const { name, args } = functionCallPart.functionCall;

        // Notify UI of tool call
        const toolRecord: ToolCallRecord = { name, args, status: 'running' };
        callbacks.onToolCall(toolRecord);

        // Execute the tool
        let result: any;
        try {
          result = await executeTool(name, args || {}, callbacks, lastImageDataUrl);
          toolRecord.status = 'success';
          toolRecord.result = result;
        } catch (err: any) {
          result = { error: err.message };
          toolRecord.status = 'error';
          toolRecord.result = result;
        }

        callbacks.onToolResult(name, result);

        // Append model's ORIGINAL parts (preserves thought_signature for Gemini 3.x)
        contents.push({
          role: 'model',
          parts: candidate.content?.parts || [{ functionCall: { name, args } }],
        });
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name,
              response: { content: result },
            },
          }],
        });

        // Update request body for next iteration
        requestBody.contents = contents;
        continue; // Loop again to get the final text response
      }

      // No function call — extract text response
      const textParts = parts.filter((p: any) => p.text);
      const fullText = textParts.map((p: any) => p.text).join('');

      if (fullText) {
        // Stream-simulate the response for smooth UX
        const words = fullText.split(' ');
        let accumulated = '';
        for (let i = 0; i < words.length; i++) {
          accumulated += (i > 0 ? ' ' : '') + words[i];
          callbacks.onChunk(accumulated);
          // Small delay for streaming effect (only for first 50 words, then instant)
          if (i < 50) {
            await new Promise(r => setTimeout(r, 15));
          }
        }
        callbacks.onComplete(fullText);
      } else {
        callbacks.onComplete('');
      }

      return; // Done
    }

    // If we exhausted iterations
    callbacks.onComplete('I completed several actions but reached the maximum number of tool calls. Let me know if you need anything else.');
  } catch (error: any) {
    callbacks.onError(error);
  }
}
