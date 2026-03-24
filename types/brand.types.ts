export type ContentFormat = 'post' | 'story' | 'reel';
export type SlotStatus = 'empty' | 'ideated' | 'briefed' | 'generated' | 'approved';

/** A specific product/service the brand wants to promote, with a photo the user uploaded or confirmed. */
export interface BrandProduct {
  id: string;
  name: string;           // user-assigned name e.g. "Signature Latte"
  imageDataUrl: string;   // base64 data URL — the locked reference photo
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
  created_at: string;
  updated_at: string;
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
