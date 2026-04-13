
export enum AppMode {
  EXPLORE = 'explore',
  IMAGE = 'image',
  VIDEO = 'video',
  ADMIN = 'admin',
  DRAW = 'draw',
  EDIT = 'edit',
  CHARACTER = 'character',
  ASSIST = 'assist',
  APPS = 'apps',
  COMMUNITY = 'community',
  SPACES = 'spaces',
  BRAND = 'brand',
  AGENTIC = 'agentic',
  ANALYTICS = 'analytics',
  CRON_JOBS = 'cron_jobs',
  CONNECTORS = 'connectors',
  AUTOPILOT = 'autopilot',
}

export enum ModelType {
  NANO_BANANA_2 = 'gemini-3.1-flash-image-preview', // Nano Banana 2 (latest, Feb 2026)
  NANO_BANANA_PRO = 'gemini-3-pro-image-preview',  // Nano Banana Pro
  NANO_BANANA = 'gemini-2.5-flash-image',           // Nano Banana (Fast)
  SEEDREAM = 'imagen-3.0-fast-generate-001',        // Placeholder
  QWEN_LAYERED = 'fal-ai/qwen-image-layered',       // Alibaba Qwen: image → RGBA layers (fal.ai)
  // fal.ai image models
  SEEDREAM_V45 = 'fal-ai/bytedance/seedream/v4.5/text-to-image', // ByteDance Seedream 4.5 (Latest)
  SEEDREAM_V4 = 'fal-ai/bytedance/seedream/v4/text-to-image',    // ByteDance Seedream 4.0
  SEEDREAM_LITE = 'fal-ai/bytedance/seedream/v3/text-to-image',  // ByteDance Seedream v3 (Legacy)
  GPT_IMAGE_15 = 'fal-ai/gpt-image-1.5',            // GPT Image 1.5 (OpenAI via fal.ai, Latest)
  GPT_IMAGE = 'fal-ai/gpt-image-1/text-to-image',   // GPT Image 1 (OpenAI via fal.ai)
  FLUX2 = 'fal-ai/flux-pro/v1.1-ultra',            // FLUX.2 Ultra (Black Forest Labs)
  REVE = 'fal-ai/reve/text-to-image',              // Reve Image 1.0
  Z_IMAGE = 'fal-ai/z-image/turbo',                // Z-Image Turbo
  TOPAZ = 'fal-ai/topaz/upscale/image',            // Topaz Photo AI Upscaler
}

/** A segment to keep from a video clip (supports cuts that remove middle sections) */
export interface ClipSegment {
  start: number;  // seconds
  end: number;    // seconds
}

export interface TimelineClip {
  videoId: string;
  url: string;         // Blob URL or CDN URL for playback
  blob?: Blob;         // Raw blob for ffmpeg processing
  inPoint: number;     // Trim start (seconds)
  outPoint: number;    // Trim end (seconds)
  duration: number;    // Total original duration
  order: number;       // Position in timeline
  /** Segments to keep after cuts. If empty/undefined, uses inPoint→outPoint as single segment */
  segments?: ClipSegment[];
}

export interface VideoEffect {
  id: string;
  name: string;
  category: string;
  thumbnail: string;
  promptTemplate: string;
  modelCompatibility: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  usage: number;
  limit: number;
  status: 'active' | 'banned';
  lastActive: string;
  canUseByok?: boolean;
  canUseVideo?: boolean;
  canUseSpaces?: boolean;
  tier?: string; // e.g. Free, Pro, Max, Admin
}

export interface GeneratedAsset {
  id: string;
  url: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  createdAt: number;
  layers?: string[]; // Qwen Layered: individual RGBA layer URLs
  loading?: boolean; // Skeleton placeholder while generating
}

export interface GenerationConfig {
  model: ModelType;
  aspectRatio: string;
  quality: '1K' | '2K' | '4K';
  batchSize: number;
  prompt: string;
  harmonize?: boolean;
}

export interface PerspectiveConfig {
  cameraAngle: string;  // Gemini-friendly spatial description
  shotType: string;     // Gemini-friendly framing description
  rotation: number;     // -180 to 180 degrees
  tilt: number;         // -60 to 60 degrees
  facingCamera: boolean;
}

export const DEFAULT_PERSPECTIVE: PerspectiveConfig = {
  cameraAngle: '',
  shotType: '',
  rotation: 0,
  tilt: 0,
  facingCamera: false,
};

export function buildPerspectiveText(p: PerspectiveConfig): string {
  const parts: string[] = [];
  if (p.cameraAngle) parts.push(p.cameraAngle);
  if (p.shotType) parts.push(p.shotType);
  if (p.facingCamera) parts.push('subject turned to face the viewer directly, full frontal view, making direct eye contact with the camera');
  if (p.rotation !== 0) parts.push(`scene viewed from ${Math.round(p.rotation)}° horizontal angle`);
  if (p.tilt !== 0) parts.push(p.tilt > 0 ? `camera tilted upward ${Math.round(p.tilt)}°, looking up at subject` : `camera tilted downward ${Math.round(Math.abs(p.tilt))}°, looking down at subject`);
  return parts.join(', ');
}

export function isPerspectiveActive(p: PerspectiveConfig): boolean {
  return !!(p.cameraAngle || p.shotType || p.facingCamera || p.rotation !== 0 || p.tilt !== 0);
}

// ---- NEW: Object Orientation (For Inpainting) ----
export interface ObjectOrientation {
  action: string;
}

export const DEFAULT_OBJECT_ORIENTATION: ObjectOrientation = {
  action: '',
};

export const OBJECT_ORIENTATION_OPTIONS = [
  { value: 'turned diagonally to face the left side of the room, viewed from a 3/4 angle', label: 'Turn Left', icon: 'RotateCcw' },
  { value: 'turned diagonally to face the right side of the room, viewed from a 3/4 angle', label: 'Turn Right', icon: 'RotateCw' },
  { value: 'turned completely to face the camera head-on', label: 'Face Forward', icon: 'ArrowDown' },
  { value: 'turned around facing away from the camera, showing its back', label: 'Face Away', icon: 'ArrowUp' },
  { value: 'tipped slightly backward, pointing upward', label: 'Tilt Up', icon: 'ArrowUpRight' },
  { value: 'leaning forward, pointing downward', label: 'Tilt Down', icon: 'ArrowDownRight' },
];

export function buildObjectOrientationText(o?: ObjectOrientation): string {
  if (!o || !o.action) return '';
  return `the object ${o.action}`;
}

export function isObjectOrientationActive(o?: ObjectOrientation): boolean {
  return !!(o && o.action);
}

export interface Character {
  id: string;
  name: string;
  thumbnail: string;
  images: string[];
}

export interface RefinementMessage {
  role: 'user' | 'model';
  content: string;
  imageUrl?: string;
}

export interface StudioElement {
  id: string;
  type: 'text' | 'heading' | 'image' | 'button';
  content: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  style: {
    fontSize?: number;
    color?: string;
    borderRadius?: number;
    opacity?: number;
    textAlign?: 'left' | 'center' | 'right';
    backgroundColor?: string;
  };
}
