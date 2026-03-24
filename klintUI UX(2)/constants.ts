
import { ModelType, User, VideoEffect } from './types';

export const ASPECT_RATIOS = [
  { label: 'Square (1:1)', value: '1:1', icon: 'Square' },
  { label: 'Landscape (16:9)', value: '16:9', icon: 'Monitor' },
  { label: 'Portrait (9:16)', value: '9:16', icon: 'Smartphone' },
  { label: 'Classic (4:3)', value: '4:3', icon: 'RectangleHorizontal' },
  { label: 'Story (3:4)', value: '3:4', icon: 'RectangleVertical' },
];

export const MODELS = [
  { 
    id: ModelType.NANO_BANANA_PRO, 
    name: 'Gemini 3.0 Pro', 
    description: "Google's Flagship Generation Model (Nano Banana Pro)", 
    premium: true,
    badge: 'Pro'
  },
  { 
    id: ModelType.NANO_BANANA, 
    name: 'Gemini 2.5 Flash', 
    description: "Google's Fastest Generation Model", 
    premium: true,
    badge: 'Fast'
  }
];

export const VIDEO_MODELS = [
  { id: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 - Fast', badge: 'Fast', description: 'Optimized for speed and fluid motion' },
  { id: 'veo-3.1-generate-preview', name: 'Veo 3.1 - Quality', badge: 'Quality', description: 'Highest fidelity with advanced physics' },
];

export const VIDEO_GEN_MODES = [
  { id: 'text-to-video', label: 'Text to Video', icon: 'Sparkles', placeholder: 'Generate a video with text...' },
  { id: 'frames-to-video', label: 'Frames to Video', icon: 'Image', placeholder: 'Generate a video with text and frames...' },
  { id: 'ingredients-to-video', label: 'Ingredients to Video', icon: 'Layers', placeholder: 'Generate a video with text and ingredients...' },
  { id: 'create-image', label: 'Create Image', icon: 'PlusSquare', placeholder: 'Generate a high-quality image...' },
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
