export type ContentFormat = 'post' | 'story' | 'reel';
export type SlotStatus = 'empty' | 'ideated' | 'briefed' | 'generated' | 'reviewed' | 'approved' | 'scheduled' | 'published';

/** A specific product/service the brand wants to promote, with a photo the user uploaded or confirmed. */
export interface BrandProduct {
  id: string;
  name: string;           // user-assigned name e.g. "Signature Latte"
  imageDataUrl: string;   // base64 data URL — the locked reference photo
}

/** A competitor the Scout agent researches for this brand. */
export interface BrandCompetitor {
  id: string;
  name: string;               // "Adidas"
  instagram?: string;         // "adidas" (no @)
  tiktok?: string;
  facebook?: string;
  youtube?: string;
  linkedin?: string;
  x?: string;
  pinterest?: string;
  threads?: string;
  website?: string;           // "adidas.com"
  notes?: string;
}

/** Per-platform scrape result tracked by Scout so the UI can show coverage chips. */
export type PlatformScrapeStatus = 'ok' | 'failed' | 'empty' | 'no_handle' | 'skipped';
export interface PlatformScrapeInfo {
  status: PlatformScrapeStatus;
  profiles: number;
  error?: string;
}

/** Scout agent's research output — consumed by Priya to generate calendar content. */
export interface ScoutReport {
  filename: string;           // downloadable .docx filename
  generated_at: string;       // ISO date
  scan_data: any;             // brand + competitor intel (includes platform_scrape_status)
  weakness_data: any;         // opportunities & positioning
  strategy_data: any;         // content pillars, calendar, hooks, scripts (Priya consumes this)
  sources: { title: string; url: string }[];
  competitors_analyzed: number;
  content_pillars: number;
  hooks_generated: number;
  /** Gate fields — user must approve before Priya runs */
  awaiting_approval?: boolean;
  approved_at?: string | null;
  /** Rejection fields — populated when the report was re-generated from user feedback */
  review_feedback?: string;
  rejection_count?: number;
}

/** Priya's campaign setup from the questionnaire modal */
export interface PriyaCampaign {
  duration_days: 15 | 30 | 45;
  target_audience: string;
  campaign_goals: string;
  themes: string[];
  platforms: SocialPlatform[];
  created_at: string;
}

export interface BrandProfile {
  id: string;
  user_id: string;
  name: string;
  website_url: string;
  logo_url: string;
  tagline: string;
  industry: string;
  audience: string;
  tone: string[];
  colors: string[];
  fonts: string[];
  visual_style: string;
  keywords: string[];
  avoid: string[];
  /** All images combined — kept for backward compatibility */
  example_images: string[];
  /** Product/service shots — used as baseImages for all generation */
  product_images: string[];
  /** Hero, lifestyle, background images — used for style/mood reference only */
  lifestyle_images: string[];
  /** Named products the user confirmed — used for calendar content + image-to-image generation */
  products: BrandProduct[];
  brand_values: string[];
  aesthetic: string[];
  overview: string;
  /** Background Extracted Rules — the Visual RAG text extracted from discarded Lifestyle Images */
  visual_style_rules?: string;
  /** Brand's own Instagram handle, e.g. "nike" (no @) */
  instagram_handle?: string;
  /** Optional additional social presence */
  facebook_url?: string;
  tiktok_handle?: string;
  youtube_handle?: string;
  linkedin_handle?: string;
  x_handle?: string;
  pinterest_handle?: string;
  threads_handle?: string;
  /** Competitors the Scout agent researches (persisted with brand) */
  competitors?: BrandCompetitor[];
  /** Latest Scout research report — consumed by Priya */
  scout_report?: ScoutReport | null;
  /** Last N previous Scout reports (most-recent last) — kept after user rejects with feedback */
  scout_report_history?: (ScoutReport & { rejected_at?: string; rejection_reason?: string })[];
  priya_campaign?: PriyaCampaign | null;
  created_at: string;
  updated_at: string;
}

export interface BrandDNA {
  name: string;
  website_url: string;
  logo_url: string;
  tagline: string;
  industry: string;
  audience: string;
  tone: string[];
  colors: string[];
  fonts: string[];
  visual_style: string;
  keywords: string[];
  avoid: string[];
  /** All images combined — kept for backward compatibility */
  example_images: string[];
  /** Product/service shots — used as baseImages for all generation */
  product_images: string[];
  /** Hero, lifestyle, background images — used for style/mood reference only */
  lifestyle_images: string[];
  /** Named products the user confirmed — used for calendar content + image-to-image generation */
  products: BrandProduct[];
  brand_values: string[];
  aesthetic: string[];
  overview: string;
  /** Background Extracted Rules — the Visual RAG text extracted from discarded Lifestyle Images */
  visual_style_rules?: string;
  /** Auto-detected products from website scraping (Shopify API, JSON-LD, HTML cards) */
  _detected_products?: Array<{ name: string; imageUrl: string }>;
  /** Brand's own Instagram handle, e.g. "nike" (no @) */
  instagram_handle?: string;
  facebook_url?: string;
  tiktok_handle?: string;
  youtube_handle?: string;
  linkedin_handle?: string;
  x_handle?: string;
  pinterest_handle?: string;
  threads_handle?: string;
  /** Competitors the Scout agent researches (persisted with brand) */
  competitors?: BrandCompetitor[];
}

export interface ContentBrief {
  hook: string;
  caption: string;
  hashtags: string[];
  image_prompt: string;
  visual_direction: string;
  call_to_action: string;
  target_emotion: string;
}

export interface ContentSlot {
  id: string;
  brand_id: string;
  user_id: string;
  slot_date: string;
  format: ContentFormat;
  status: SlotStatus;
  idea: string;
  brief: ContentBrief | null;
  generated_image: string | null;
  /** Auto-matched or user-selected product name for this slot */
  selected_product?: string;
  approved: boolean;
  /** Platforms this slot was published to */
  published_platforms?: string[];
  /** ISO timestamp of last publish */
  published_at?: string;
  /** Upload-Post request ID for tracking */
  publish_request_id?: string;
  /** Target social media platform for this slot */
  platform?: SocialPlatform;
  /** ISO timestamp for when Dispatch should publish (scheduled post) */
  scheduled_at?: string;
  /** Rejection reason captured during Review */
  review_feedback?: string;
  /** Groups slots that were reviewed together in one Review batch */
  review_batch_id?: string;
  /** Pipeline integration fields (set by autopilot) */
  pipeline_run_id?: string;
  quality_scores?: QualityScores | null;
  guardrail_flags?: GuardrailFlags | null;
  dedup_score?: number;
  variant_of?: string;
  performance_data?: PostPerformanceData | null;
  created_at: string;
  updated_at: string;
}

// ── Autopilot Pipeline Types ─────────────────────────────────────────────────

export interface QualityScores {
  hook: number;
  brand_voice: number;
  cta_clarity: number;
  uniqueness: number;
  overall: number;
  feedback?: string;
}

export interface GuardrailFlags {
  compliance_ok: boolean;
  issues: string[];
}

export interface PostPerformanceData {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  impressions?: number;
  reach?: number;
  engagement_rate?: number;
  [key: string]: any;
}

export type PipelineStage = 'scout' | 'create' | 'review' | 'approve' | 'publish' | 'analyze';
export type PipelineStatus = 'running' | 'completed' | 'failed' | 'paused';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'expired';

export interface PipelineRun {
  id: string;
  user_id: string;
  brand_id: string;
  status: PipelineStatus;
  current_stage: PipelineStage;
  config: PipelineConfig;
  stage_summary: Record<string, any>;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  created_at: string;
}

export interface PipelineConfig {
  platforms: SocialPlatform[];
  post_count: number;
  auto_approve_hours: number;
  enable_ab_test: boolean;
  competitors: { handle: string; platform?: string }[];
}

export interface PipelineStageLog {
  id: string;
  pipeline_run_id: string;
  stage: PipelineStage;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  input: Record<string, any>;
  output: Record<string, any>;
  duration_ms: number;
  started_at?: string;
  completed_at?: string;
}

export interface ApprovalQueueItem {
  id: string;
  user_id: string;
  brand_id: string;
  pipeline_run_id?: string;
  slot_id?: string;
  slot_date: string;
  format: ContentFormat;
  variant_group?: string;
  variant_label?: 'A' | 'B' | null;
  brief: ContentBrief | null;
  generated_image?: string;
  caption_preview?: string;
  quality_scores: QualityScores | null;
  guardrail_flags: GuardrailFlags | null;
  dedup_score: number;
  status: ApprovalStatus;
  auto_approve_at?: string;
  reviewer_notes?: string;
  publish_platforms?: string[];
  publish_scheduled_at?: string;
  created_at: string;
  resolved_at?: string;
}

export interface PerformanceSignal {
  id: string;
  user_id: string;
  brand_id: string;
  period_start: string;
  period_end: string;
  top_posts: any[];
  bottom_posts: any[];
  signals: {
    what_worked: string[];
    do_more: string[];
    stop_doing: string[];
    best_formats: string[];
    best_themes: string[];
  };
  generated_briefs: any[];
  created_at: string;
}

// ── Upload-Post / Social Media Types ─────────────────────────────────────────

export type SocialPlatform =
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'linkedin'
  | 'facebook'
  | 'x'
  | 'threads'
  | 'pinterest'
  | 'bluesky'
  | 'reddit'
  | 'google_business';

export const SOCIAL_PLATFORMS: { key: SocialPlatform; label: string; color: string }[] = [
  { key: 'instagram', label: 'Instagram', color: '#E4405F' },
  { key: 'tiktok', label: 'TikTok', color: '#000000' },
  { key: 'x', label: 'X (Twitter)', color: '#1DA1F2' },
  { key: 'facebook', label: 'Facebook', color: '#1877F2' },
  { key: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  { key: 'youtube', label: 'YouTube', color: '#FF0000' },
  { key: 'threads', label: 'Threads', color: '#000000' },
  { key: 'pinterest', label: 'Pinterest', color: '#BD081C' },
  { key: 'bluesky', label: 'Bluesky', color: '#0085FF' },
  { key: 'reddit', label: 'Reddit', color: '#FF4500' },
  { key: 'google_business', label: 'Google Business', color: '#4285F4' },
];

export interface SocialProfile {
  username: string;
  platform?: string;
  connected?: boolean;
  profile_url?: string;
  [key: string]: any;
}

export interface PublishResult {
  success: boolean;
  message?: string;
  request_id?: string;
  total_platforms?: number;
  data?: Record<string, any>;
}

export interface UploadStatus {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  data?: Record<string, any>;
}

export interface ScheduledPost {
  job_id: string;
  scheduled_date: string;
  platforms: string[];
  caption?: string;
  media_url?: string;
  status?: string;
  [key: string]: any;
}

export interface PostAnalytics {
  followers?: number;
  total_posts?: number;
  engagement_rate?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  [key: string]: any;
}

// ── Ad Campaign Types ──────────────────────────────────────────────────
export type AdPlatform = 'google_ads' | 'meta_ads';
export type AdCampaignStatus = 'ENABLED' | 'PAUSED' | 'REMOVED' | 'ACTIVE';

export interface AdCampaign {
  id: string;
  user_id: string;
  brand_id?: string;
  platform: AdPlatform;
  external_campaign_id: string;
  name: string;
  status: AdCampaignStatus;
  objective?: string;
  daily_budget_cents?: number;
  lifetime_budget_cents?: number;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  ctr: number;
  cpc_cents: number;
  roas: number;
  metrics_updated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AdCreative {
  id: string;
  user_id: string;
  brand_id?: string;
  campaign_id?: string;
  content_slot_id?: string;
  platform: AdPlatform;
  external_asset_id?: string;
  image_url: string;
  asset_name?: string;
  status: 'uploaded' | 'active' | 'rejected' | 'removed';
  created_at: string;
}

export interface CampaignMetrics {
  date: string;
  impressions: number;
  clicks: number;
  spend_cents: number;
  conversions: number;
  ctr: number;
  cpc_cents: number;
}
