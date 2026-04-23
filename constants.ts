
import { ModelType, User, VideoEffect } from './types';

export const ASPECT_RATIOS = [
  { label: 'Square (1:1)', value: '1:1', icon: 'Square' },
  { label: 'Landscape (16:9)', value: '16:9', icon: 'Monitor' },
  { label: 'Portrait (9:16)', value: '9:16', icon: 'Smartphone' },
  { label: 'Classic Landscape (4:3)', value: '4:3', icon: 'RectangleHorizontal' },
  { label: 'Classic Portrait (3:4)', value: '3:4', icon: 'RectangleVertical' },
  { label: 'Cinematic (21:9)', value: '21:9', icon: 'Monitor' },
  { label: 'Social High (9:21)', value: '9:21', icon: 'Smartphone' },
  { label: 'Wide (3:2)', value: '3:2', icon: 'RectangleHorizontal' },
  { label: 'Tall (2:3)', value: '2:3', icon: 'RectangleVertical' },
  { label: 'Social Post (4:5)', value: '4:5', icon: 'RectangleVertical' },
];

/**
 * Model capability metadata:
 * - supportedAspectRatios: which aspect ratio values from ASPECT_RATIOS this model accepts (undefined = all)
 * - sizeParamType: how the model receives size info ('image_size_enum' | 'aspect_ratio' | 'gpt_sizes' | 'none' | 'gemini')
 * - hasQuality: whether the Gemini-style quality selector (1K/2K/4K) applies
 * - maxBatchSize: max num_images (0 = no batch support)
 */
export const MODELS = [
  {
    id: ModelType.NANO_BANANA_2,
    name: 'Gemini 3.1 Flash',
    description: "Google's Newest Model. Pro quality at Flash speed. (Nano Banana 2)",
    premium: false,
    badge: 'NEW',
    sizeParamType: 'gemini' as const,
    hasQuality: true,
    maxBatchSize: 4,
    // Gemini supports all aspect ratios
  },
  {
    id: ModelType.NANO_BANANA_PRO,
    name: 'Gemini 3.0 Pro',
    description: "Google's Flagship Generation Model (Nano Banana Pro)",
    premium: true,
    badge: 'Pro',
    sizeParamType: 'gemini' as const,
    hasQuality: true,
    maxBatchSize: 4,
  },
  {
    id: ModelType.NANO_BANANA,
    name: 'Gemini 2.5 Flash',
    description: "Google's Fastest Generation Model",
    premium: true,
    badge: 'Fast',
    sizeParamType: 'gemini' as const,
    hasQuality: true,
    maxBatchSize: 4,
  },
  {
    id: ModelType.QWEN_LAYERED,
    name: 'Qwen Layered',
    description: 'Alibaba Qwen: Decompose any reference image into multiple transparent RGBA layers.',
    premium: false,
    badge: 'Layers',
    sizeParamType: 'none' as const,
    hasQuality: false,
    maxBatchSize: 0, // no batch — uses num_layers instead
    supportedAspectRatios: [] as string[], // no aspect ratio choice
  },
  {
    id: ModelType.SEEDREAM_V45,
    name: 'Seedream 4.5',
    description: "ByteDance's newest image model. Up to 4K output with exceptional detail.",
    premium: false,
    badge: 'NEW',
    sizeParamType: 'image_size_enum' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // image_size enum: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto_2K, auto_4K
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  {
    id: ModelType.SEEDREAM_V4,
    name: 'Seedream 4.0',
    description: "ByteDance Seedream 4 — unified generation & editing architecture.",
    premium: false,
    badge: 'ByteDance',
    sizeParamType: 'image_size_enum' as const,
    hasQuality: false,
    maxBatchSize: 4,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  {
    id: ModelType.SEEDREAM_LITE,
    name: 'Seedream v3',
    description: "ByteDance Seedream v3 — fast and reliable text-to-image.",
    premium: false,
    badge: 'v3',
    sizeParamType: 'image_size_enum' as const,
    hasQuality: false,
    maxBatchSize: 4,
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  {
    id: ModelType.GPT_IMAGE_2,
    name: 'GPT Image 2',
    description: "OpenAI's newest image model via fal.ai. Best-in-class text rendering and photorealism.",
    premium: true,
    badge: 'NEW',
    sizeParamType: 'image_size_enum' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // image_size enum: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  {
    id: ModelType.GPT_IMAGE_15,
    name: 'GPT Image 1.5',
    description: 'OpenAI GPT Image 1.5 via fal.ai. High-fidelity with strong prompt adherence.',
    premium: true,
    badge: 'OpenAI',
    sizeParamType: 'gpt_sizes' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // GPT 1.5 sizes: 1024x1024, 1536x1024, 1024x1536 (no auto)
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  },
  {
    id: ModelType.GPT_IMAGE,
    name: 'GPT Image 1',
    description: "OpenAI GPT Image 1 via fal.ai. Exceptional instruction-following and realism.",
    premium: true,
    badge: 'OpenAI',
    sizeParamType: 'gpt_sizes' as const,
    hasQuality: false,
    maxBatchSize: 4,
    supportedAspectRatios: ['1:1', '16:9', '9:16'],
  },
  {
    id: ModelType.FLUX2,
    name: 'FLUX.2 Ultra',
    description: 'Black Forest Labs FLUX.2 Ultra. State-of-the-art photorealism and detail.',
    premium: true,
    badge: 'BFL',
    sizeParamType: 'aspect_ratio' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // aspect_ratio: 21:9, 16:9, 4:3, 3:2, 1:1, 2:3, 3:4, 9:16, 9:21
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21', '3:2', '2:3'],
  },
  {
    id: ModelType.REVE,
    name: 'Reve Image 1.0',
    description: 'High-fidelity image generation with outstanding color and compositional accuracy.',
    premium: false,
    badge: 'Reve',
    sizeParamType: 'aspect_ratio' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // aspect_ratio: 16:9, 9:16, 3:2, 2:3, 4:3, 3:4, 1:1
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
  },
  {
    id: ModelType.Z_IMAGE,
    name: 'Z-Image Turbo',
    description: 'Fast, creative image synthesis with strong stylistic versatility.',
    premium: false,
    badge: 'Z-AI',
    sizeParamType: 'image_size_enum' as const,
    hasQuality: false,
    maxBatchSize: 4,
    // image_size enum: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9
    supportedAspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  },
  {
    id: ModelType.TOPAZ,
    name: 'Topaz Upscale',
    description: 'Topaz Labs AI upscaler — enhance and upscale images with best-in-class sharpness.',
    premium: true,
    badge: 'Topaz',
    sizeParamType: 'none' as const,
    hasQuality: false,
    maxBatchSize: 0, // upscaler — one image at a time
    supportedAspectRatios: [] as string[], // no aspect ratio choice
  }
];

export const VIDEO_MODELS = [
  { id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 - Fast', badge: 'Fast', description: 'Optimized for speed and fluid motion' },
  { id: 'veo-3.1-generate-preview', name: 'Veo 3.1 - Quality', badge: 'Quality', description: 'Highest fidelity with advanced physics' },
];

export const VIDEO_GEN_MODES = [
  { id: 'text-to-video', label: 'Text to Video', icon: 'Type', placeholder: 'Generate a video with text...' },
  { id: 'frames-to-video', label: 'Frames to Video', icon: 'Image', placeholder: 'Generate a video with text and frames...' },
  { id: 'ingredients-to-video', label: 'Ingredients to Video', icon: 'Layers', placeholder: 'Generate a video with text and ingredients...' },
];

export const INITIAL_VIDEO_EFFECTS: VideoEffect[] = [
  {
    id: 'general',
    name: 'GENERAL',
    category: 'All',
    thumbnail: 'https://picsum.photos/400/600?random=1001',
    promptTemplate: 'Cinematic shot, high quality, 8k resolution, detailed texture',
    modelCompatibility: ['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview']
  }
];

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Alice Walker', email: 'alice@example.com', usage: 85, limit: 100, status: 'active', lastActive: '2 mins ago' },
];

export const MOCK_USAGE_DATA = [
  { name: 'Mon', apiCalls: 400, errors: 24 },
];

export const SAMPLE_IMAGES = [
  "https://picsum.photos/800/800?random=1",
  "https://picsum.photos/800/600?random=2",
  "https://picsum.photos/600/800?random=3",
  "https://picsum.photos/800/800?random=4",
];

export const EXPLORE_TOP_CHOICES = [
  {
    id: 1,
    title: 'Gemini 3.0 Pro',
    description: 'Best 4K image model ever',
    image: 'https://picsum.photos/400/400?random=10',
    tag: 'UNLIMITED',
    isPro: false
  },
];

export const EXPLORE_VISUAL_EFFECTS = [
  'Raven Transition', 'Air Bending', 'Animalization'
];
