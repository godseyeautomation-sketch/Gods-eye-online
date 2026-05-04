import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Upload, X, Play, Download, Loader2, AlertCircle,
  Clapperboard, Image as ImageIcon, Film, Sparkles,
  Video, Wand2, Move, ChevronDown, ChevronUp, Link,
  ArrowRight, Clock, Zap, Search, Volume2, Scissors,
  MonitorPlay, RefreshCw, Trash2, AlertTriangle,
} from 'lucide-react';
import { generateVideo, submitJob, pollStatus, fetchResult, extractVideoUrl, GenerationStatus } from '../../services/falService';
import { getCharacterSupport } from '../../constants';
import {
  StoredVideo,
  saveVideoGeneration,
  getVideoGenerations,
  deleteVideoGeneration,
  clearVideoGenerations,
} from '../../services/localStorageService';
import { useVideoProjects } from '../../context/VideoProjectContext';
import { VideoProjectGrid } from './VideoProjectGrid';
import { ProjectVideoGallery } from './ProjectVideoGallery';

// ── Types ─────────────────────────────────────────────────────────────────

type MainTab = 'create' | 'edit' | 'motion';
type CreateMode = 't2v' | 'i2v';

// ── Create Models ────────────────────────────────────────────────────────

interface CreateInputParams {
  prompt: string;
  negativePrompt: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  generateAudio: boolean;
  imageUrl?: string;
  endImageUrl?: string;
  mode: CreateMode;
}

interface CreateModelDef {
  key: string;
  name: string;
  badge: string;
  badgeColor: string;
  description: string;
  group: string;
  t2vId?: string;
  i2vId?: string;
  supportsT2V: boolean;
  supportsI2V: boolean;
  hasAudio: boolean;
  isExclusive: boolean;
  isEditModel: boolean;
  durationRange: string;
  durationOptions: number[];
  aspectRatios: string[];
  resolution: string;
  buildInput: (p: CreateInputParams) => Record<string, any>;
}

const klingBuildInput = ({ prompt, negativePrompt, duration, aspectRatio, generateAudio, imageUrl, endImageUrl, mode }: CreateInputParams) => ({
  prompt,
  negative_prompt: negativePrompt || undefined,
  duration: String(duration),
  aspect_ratio: aspectRatio,
  generate_audio: generateAudio,
  ...(mode === 'i2v' && imageUrl ? { start_image_url: imageUrl } : {}),
  ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
});

const veoBuildInput = ({ prompt, duration, aspectRatio, resolution, generateAudio }: CreateInputParams) => ({
  prompt, aspect_ratio: aspectRatio, duration: `${duration}s`,
  resolution: resolution === '1080p' ? '1080p' : '720p',
  generate_audio: generateAudio, safety_tolerance: '4',
});

const seedanceBuildInput = ({ prompt, duration, aspectRatio, resolution, imageUrl, endImageUrl, mode }: CreateInputParams) => ({
  prompt, duration: String(duration), aspect_ratio: aspectRatio,
  resolution: resolution || '1080p',
  ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
  ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
});

// Seedance 2.0 (launched April 2026) — https://fal.ai/docs/model-api-reference/
// video-generation-api/bytedance-seedance-2.0-text-to-video
//   required: prompt
//   optional: resolution ("480p"|"720p"), duration ("auto"|"4"…"15" as STRING),
//             aspect_ratio ("auto"|"21:9"|"16:9"|"4:3"|"1:1"|"3:4"|"9:16"),
//             generate_audio (bool, default true), seed
//   i2v-only: image_url, end_image_url
// Notably: duration is optional and string-typed. If user hasn't picked one we
// send "auto" so the model chooses a sensible default.
const seedance20BuildInput = ({ prompt, duration, aspectRatio, resolution, generateAudio, imageUrl, endImageUrl, mode }: CreateInputParams) => ({
  prompt,
  duration: duration ? String(duration) : 'auto',
  aspect_ratio: aspectRatio || 'auto',
  resolution: resolution === '480p' ? '480p' : '720p',
  generate_audio: generateAudio !== false,
  ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
  ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
});

const minimaxBuildInput = ({ prompt, imageUrl, mode }: CreateInputParams) => ({
  prompt, prompt_optimizer: true,
  ...(mode === 'i2v' && imageUrl ? { first_frame_image: imageUrl } : {}),
});

// Hailuo 02 / 2.3 inputs per fal.ai docs (verified April 2026):
// https://fal.ai/models/fal-ai/minimax/hailuo-02/pro/image-to-video/api
// https://fal.ai/models/fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video/api
//   - required: prompt (string), image_url (string, for i2v only)
//   - optional: prompt_optimizer (bool), end_image_url (string)
//   - NOT supported: duration, aspect_ratio, resolution — the schema rejects these.
// Previous builder sent `first_frame_image` (wrong) and `duration` (rejected),
// which caused every Hailuo job to fail with an API validation error.
const minimax02BuildInput = ({ prompt, imageUrl, endImageUrl, mode }: CreateInputParams) => ({
  prompt,
  prompt_optimizer: true,
  ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
  ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
});

const wanBuildInput = ({ prompt, aspectRatio, imageUrl, endImageUrl, mode }: CreateInputParams) => ({
  prompt, aspect_ratio: aspectRatio, resolution: '720p',
  ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
  ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
});

const CREATE_MODELS: CreateModelDef[] = [
  // ── Minimax Hailuo ──────────────────────────────────────────────────────
  {
    key: 'hailuo-23-fast', name: 'Minimax Hailuo 2.3 Fast', badge: '', badgeColor: '',
    description: 'Fastest Hailuo — 1080p image-to-video only.', group: 'Minimax Hailuo',
    i2vId: 'fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video',
    supportsT2V: false, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '6s-10s', durationOptions: [6, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: minimax02BuildInput,
  },
  {
    key: 'hailuo-23', name: 'Minimax Hailuo 2.3', badge: '', badgeColor: '',
    description: 'Highest quality Hailuo — best realism & motion.', group: 'Minimax Hailuo',
    t2vId: 'fal-ai/minimax/hailuo-2.3/pro/text-to-video', i2vId: 'fal-ai/minimax/hailuo-2.3/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '6s-10s', durationOptions: [6, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: minimax02BuildInput,
  },
  {
    key: 'hailuo-02-fast', name: 'Minimax Hailuo 02 Fast', badge: '', badgeColor: '',
    description: 'Fast 512p image-to-video drafts — cheapest option.', group: 'Minimax Hailuo',
    i2vId: 'fal-ai/minimax/hailuo-02-fast/image-to-video',
    supportsT2V: false, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '6s-10s', durationOptions: [6, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '512p', buildInput: minimax02BuildInput,
  },
  {
    key: 'hailuo-02', name: 'Minimax Hailuo 02', badge: '', badgeColor: '',
    description: 'Pro quality 1080p with camera control.', group: 'Minimax Hailuo',
    t2vId: 'fal-ai/minimax/hailuo-02/pro/text-to-video', i2vId: 'fal-ai/minimax/hailuo-02/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '6s-10s', durationOptions: [6, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: minimax02BuildInput,
  },
  // ── Kling ─────────────────────────────────────────────────────────────
  {
    key: 'kling-30-pro', name: 'Kling 3.0 Pro', badge: 'EXCLUSIVE', badgeColor: 'bg-[#c8ff00] text-black',
    description: "Kuaishou's flagship. Best realism & prompt adherence.", group: 'Kling',
    t2vId: 'fal-ai/kling-video/v3/pro/text-to-video', i2vId: 'fal-ai/kling-video/v3/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: true, isEditModel: false,
    durationRange: '3s-15s', durationOptions: [3, 5, 8, 10, 12, 15], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: klingBuildInput,
  },
  {
    key: 'kling-30', name: 'Kling 3.0', badge: 'EXCLUSIVE', badgeColor: 'bg-[#c8ff00] text-black',
    description: 'Standard quality. Good balance of speed & quality.', group: 'Kling',
    t2vId: 'fal-ai/kling-video/v3/standard/text-to-video', i2vId: 'fal-ai/kling-video/v3/standard/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: true, isEditModel: false,
    durationRange: '3s-15s', durationOptions: [3, 5, 8, 10, 12, 15], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: klingBuildInput,
  },
  {
    key: 'kling-26', name: 'Kling 2.6', badge: '', badgeColor: '',
    description: 'Smooth motion with strong visual consistency.', group: 'Kling',
    t2vId: 'fal-ai/kling-video/v2.6/pro/text-to-video', i2vId: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '5s-10s', durationOptions: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: klingBuildInput,
  },
  {
    key: 'kling-25-turbo', name: 'Kling 2.5 Turbo', badge: '', badgeColor: '',
    description: 'Fast mode — great for drafts.', group: 'Kling',
    t2vId: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video', i2vId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '5s-10s', durationOptions: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, negativePrompt, aspectRatio, imageUrl, mode }) => ({
      prompt, negative_prompt: negativePrompt || undefined, aspect_ratio: aspectRatio,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  {
    key: 'kling-o1-video', name: 'Kling O1 Video', badge: '', badgeColor: '',
    description: 'Reference-to-video. Deep visual consistency.', group: 'Kling',
    i2vId: 'fal-ai/kling-video/o1/reference-to-video',
    supportsT2V: false, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '5s-10s', durationOptions: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, imageUrl }) => ({ prompt, ...(imageUrl ? { image_url: imageUrl } : {}) }),
  },
  {
    key: 'kling-motion-control', name: 'Kling Motion Control', badge: '', badgeColor: '',
    description: 'Transfer motion from reference video.', group: 'Kling',
    t2vId: 'fal-ai/kling-video/v2.6/pro/motion-control', i2vId: 'fal-ai/kling-video/v2.6/pro/motion-control',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '3s-30s', durationOptions: [5, 10, 15, 30], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, imageUrl, mode }) => ({ prompt, ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}) }),
  },
  // ── OpenAI Sora 2 ────────────────────────────────────────────────────
  {
    key: 'sora-2', name: 'Sora 2', badge: '', badgeColor: '',
    description: 'Multi-shot video with sound generation.', group: 'OpenAI Sora 2',
    t2vId: 'fal-ai/sora-2/text-to-video', i2vId: 'fal-ai/sora-2/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-12s', durationOptions: [4, 8, 12], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, imageUrl, mode }) => ({
      prompt, duration, aspect_ratio: aspectRatio,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  {
    key: 'sora-2-pro', name: 'Sora 2 Pro', badge: 'Pro', badgeColor: 'bg-violet-600 text-white',
    description: 'Premium Sora 2 — higher quality & consistency.', group: 'OpenAI Sora 2',
    t2vId: 'fal-ai/sora-2/text-to-video/pro', i2vId: 'fal-ai/sora-2/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-12s', durationOptions: [4, 8, 12], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, imageUrl, mode }) => ({
      prompt, duration, aspect_ratio: aspectRatio,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  // ── Google Veo ───────────────────────────────────────────────────────
  {
    key: 'veo31-fast', name: 'Google Veo 3.1 Fast', badge: '', badgeColor: '',
    description: 'Fastest Veo — up to 4K, with audio.', group: 'Google Veo',
    t2vId: 'fal-ai/veo3.1/fast', i2vId: 'fal-ai/veo3.1/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-8s', durationOptions: [4, 6, 8], aspectRatios: ['16:9', '9:16'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, resolution, generateAudio, imageUrl, mode }) => ({
      prompt, aspect_ratio: mode === 'i2v' ? 'auto' : aspectRatio, duration: `${duration}s`,
      resolution: resolution === '1080p' ? '1080p' : '720p',
      generate_audio: generateAudio, safety_tolerance: '4',
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  {
    key: 'veo31', name: 'Google Veo 3.1', badge: '', badgeColor: '',
    description: 'Best quality Veo — up to 4K resolution.', group: 'Google Veo',
    t2vId: 'fal-ai/veo3.1', i2vId: 'fal-ai/veo3.1/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-8s', durationOptions: [4, 6, 8], aspectRatios: ['16:9', '9:16'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, resolution, generateAudio, imageUrl, mode }) => ({
      prompt, aspect_ratio: mode === 'i2v' ? 'auto' : aspectRatio, duration: `${duration}s`,
      resolution: resolution === '1080p' ? '1080p' : '720p',
      generate_audio: generateAudio, safety_tolerance: '4',
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  {
    key: 'veo31-first-last', name: 'Veo 3.1 First+Last Frame', badge: 'Keyframe', badgeColor: 'bg-blue-600 text-white',
    description: 'Veo 3.1 with first and last frame control.', group: 'Google Veo',
    t2vId: undefined, i2vId: 'fal-ai/veo3.1/first-last-frame-to-video',
    supportsT2V: false, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-8s', durationOptions: [4, 6, 8], aspectRatios: ['16:9', '9:16'],
    resolution: '1080p', buildInput: ({ prompt, duration, resolution, generateAudio, imageUrl, endImageUrl }) => ({
      prompt, duration: `${duration}s`, aspect_ratio: 'auto',
      resolution: resolution === '1080p' ? '1080p' : '720p',
      generate_audio: generateAudio, safety_tolerance: '4',
      ...(imageUrl ? { first_frame_image_url: imageUrl } : {}),
      ...(endImageUrl ? { last_frame_image_url: endImageUrl } : {}),
    }),
  },
  {
    key: 'veo3-fast', name: 'Google Veo 3 Fast', badge: '', badgeColor: '',
    description: 'Fast Veo 3 with audio — cost-effective.', group: 'Google Veo',
    t2vId: 'fal-ai/veo3/fast', i2vId: 'fal-ai/veo3/fast/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-8s', durationOptions: [4, 6, 8], aspectRatios: ['16:9', '9:16'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, resolution, generateAudio, imageUrl, mode }) => ({
      prompt, aspect_ratio: mode === 'i2v' ? 'auto' : aspectRatio, duration: `${duration}s`,
      resolution: resolution === '1080p' ? '1080p' : '720p',
      generate_audio: generateAudio, safety_tolerance: '4',
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
    }),
  },
  {
    key: 'veo3', name: 'Google Veo 3', badge: '', badgeColor: '',
    description: 'Premium Veo 3 — best quality with audio.', group: 'Google Veo',
    t2vId: 'fal-ai/veo3', i2vId: undefined,
    supportsT2V: true, supportsI2V: false, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-8s', durationOptions: [4, 6, 8], aspectRatios: ['16:9', '9:16'],
    resolution: '1080p', buildInput: veoBuildInput,
  },
  // ── Wan ──────────────────────────────────────────────────────────────
  {
    key: 'wan-22', name: 'Wan 2.2', badge: 'NEW', badgeColor: 'bg-[#c8ff00] text-black',
    description: 'Latest Wan — 720p, improved motion and quality.', group: 'Wan',
    t2vId: 'fal-ai/wan/v2.2-a14b/text-to-video', i2vId: 'fal-ai/wan/v2.2-a14b/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '~5s', durationOptions: [5], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '720p', buildInput: ({ prompt, aspectRatio, imageUrl, endImageUrl, mode }) => ({
      prompt, aspect_ratio: aspectRatio, resolution: '720p',
      num_frames: 81, frames_per_second: 16,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
      ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
    }),
  },
  {
    key: 'wan-22-fast', name: 'Wan 2.2 Fast', badge: '', badgeColor: '',
    description: 'Fast Wan 2.2 — quick drafts at 720p.', group: 'Wan',
    t2vId: 'fal-ai/wan/v2.2-5b/text-to-video/fast-wan', i2vId: undefined,
    supportsT2V: true, supportsI2V: false, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '5s', durationOptions: [5], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '720p', buildInput: ({ prompt, aspectRatio }) => ({
      prompt, aspect_ratio: aspectRatio, resolution: '720p',
    }),
  },
  {
    key: 'wan-26', name: 'Wan 2.6', badge: 'NEW', badgeColor: 'bg-[#c8ff00] text-black',
    description: 'Newest Wan — up to 15s, reference-to-video support.', group: 'Wan',
    t2vId: 'fal-ai/wan/v2.6/text-to-video', i2vId: 'fal-ai/wan/v2.6/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '5s-15s', durationOptions: [5, 10, 15], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '720p', buildInput: ({ prompt, duration, aspectRatio, imageUrl, endImageUrl, mode }) => ({
      prompt, aspect_ratio: aspectRatio, resolution: '720p', duration: String(duration),
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
      ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
    }),
  },
  {
    key: 'wan-25', name: 'Wan 2.5', badge: '', badgeColor: '',
    description: 'Wan 2.5 — 1080p with native audio generation.', group: 'Wan',
    t2vId: 'fal-ai/wan-25-preview/text-to-video', i2vId: 'fal-ai/wan-25-preview/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '5s-10s', durationOptions: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: ({ prompt, duration, aspectRatio, generateAudio, imageUrl, endImageUrl, mode }) => ({
      prompt, aspect_ratio: aspectRatio, resolution: '1080p', duration: String(duration),
      generate_audio: generateAudio,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
      ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
    }),
  },
  {
    key: 'wan-21', name: 'Wan 2.1', badge: '', badgeColor: '',
    description: 'Stable Wan with broad aspect ratio support.', group: 'Wan',
    t2vId: 'fal-ai/wan-t2v', i2vId: 'fal-ai/wan-i2v',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '~5s', durationOptions: [5], aspectRatios: ['16:9', '9:16'],
    resolution: '720p', buildInput: ({ prompt, aspectRatio, imageUrl, endImageUrl, mode }) => ({
      prompt, aspect_ratio: aspectRatio, resolution: '720p',
      num_frames: 81, frames_per_second: 16,
      ...(mode === 'i2v' && imageUrl ? { image_url: imageUrl } : {}),
      ...(mode === 'i2v' && endImageUrl ? { end_image_url: endImageUrl } : {}),
    }),
  },
  // ── Seedance ──────────────────────────────────────────────────────────
  {
    key: 'seedance-20', name: 'Seedance 2.0', badge: 'NEW', badgeColor: 'bg-[#c8ff00] text-black',
    description: "ByteDance's latest — native audio, director-level camera control.", group: 'Seedance',
    t2vId: 'fal-ai/bytedance/seedance-2.0/text-to-video', i2vId: 'fal-ai/bytedance/seedance-2.0/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-15s', durationOptions: [4, 5, 6, 8, 10, 12, 15], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: '720p', buildInput: seedance20BuildInput,
  },
  {
    key: 'seedance-20-fast', name: 'Seedance 2.0 Fast', badge: 'NEW', badgeColor: 'bg-[#c8ff00] text-black',
    description: 'Faster Seedance 2.0 — lower cost, same cinematic output.', group: 'Seedance',
    t2vId: 'fal-ai/bytedance/seedance-2.0/fast/text-to-video', i2vId: 'fal-ai/bytedance/seedance-2.0/fast/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-15s', durationOptions: [4, 5, 6, 8, 10, 12, 15], aspectRatios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    resolution: '720p', buildInput: seedance20BuildInput,
  },
  {
    key: 'seedance-15-pro', name: 'Seedance 1.5 Pro', badge: '', badgeColor: '',
    description: 'Seedance 1.5 — 720p with audio generation.', group: 'Seedance',
    t2vId: 'fal-ai/bytedance/seedance/v1.5/pro/text-to-video', i2vId: 'fal-ai/bytedance/seedance/v1.5/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: true, isExclusive: false, isEditModel: false,
    durationRange: '4s-12s', durationOptions: [4, 5, 6, 8, 10, 12], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolution: '720p', buildInput: seedanceBuildInput,
  },
  {
    key: 'seedance-pro', name: 'Seedance Pro', badge: '', badgeColor: '',
    description: 'Pro quality at 1080p — consistent results.', group: 'Seedance',
    t2vId: 'fal-ai/bytedance/seedance/v1/pro/text-to-video', i2vId: 'fal-ai/bytedance/seedance/v1/pro/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '2s-12s', durationOptions: [2, 4, 5, 8, 10, 12], aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    resolution: '1080p', buildInput: seedanceBuildInput,
  },
  {
    key: 'seedance-pro-fast', name: 'Seedance Pro Fast', badge: '', badgeColor: '',
    description: 'Fast Seedance — quick 1080p drafts.', group: 'Seedance',
    t2vId: 'fal-ai/bytedance/seedance/v1/pro/fast/text-to-video', i2vId: 'fal-ai/bytedance/seedance/v1/pro/fast/image-to-video',
    supportsT2V: true, supportsI2V: true, hasAudio: false, isExclusive: false, isEditModel: false,
    durationRange: '2s-12s', durationOptions: [2, 4, 5, 8, 10, 12], aspectRatios: ['16:9', '9:16', '1:1'],
    resolution: '1080p', buildInput: seedanceBuildInput,
  },
];

// ── Motion Control Models ────────────────────────────────────────────────

interface MotionInputParams { prompt: string; videoUrl?: string; imageUrl?: string; }
interface MotionModelDef { key: string; name: string; badge: string; badgeColor: string; description: string; modelId: string; acceptsVideo: boolean; acceptsImage: boolean; buildInput: (p: MotionInputParams) => Record<string, any>; }

const MOTION_MODELS: MotionModelDef[] = [
  { key: 'kling-omni', name: 'Kling O1 Edit', badge: 'O1 Edit', badgeColor: 'bg-brand text-bg', description: 'Edit videos with natural language.', modelId: 'fal-ai/kling-video/o1/video-to-video/edit', acceptsVideo: true, acceptsImage: false, buildInput: ({ prompt, videoUrl }) => ({ prompt, video_url: videoUrl, keep_audio: false }) },
  { key: 'kling-o1-video', name: 'Kling O1 Reference', badge: 'Reference', badgeColor: 'bg-violet-600 text-white', description: 'Transform reference videos.', modelId: 'fal-ai/kling-video/o1/video-to-video/reference', acceptsVideo: true, acceptsImage: false, buildInput: ({ prompt, videoUrl }) => ({ prompt, video_url: videoUrl }) },
  { key: 'kling-motion', name: 'Kling Motion Control', badge: 'Control', badgeColor: 'bg-blue-600 text-white', description: 'Transfer motion onto character image.', modelId: 'fal-ai/kling-video/v2.6/pro/motion-control', acceptsVideo: true, acceptsImage: true, buildInput: ({ prompt, videoUrl, imageUrl }) => ({ prompt, video_url: videoUrl, ...(imageUrl ? { image_url: imageUrl } : {}) }) },
  { key: 'kling-o1-ref-image', name: 'Kling O1 Image Ref', badge: 'I2V', badgeColor: 'bg-pink-600 text-white', description: 'Image-to-video with Kling O1.', modelId: 'fal-ai/kling-video/o1/reference-to-video', acceptsVideo: false, acceptsImage: true, buildInput: ({ prompt, imageUrl }) => ({ prompt, ...(imageUrl ? { image_url: imageUrl } : {}) }) },
];

const MOTION_PRESETS = [
  { label: 'Cinematic Pan', text: 'Camera slowly pans from left to right, cinematic lighting' },
  { label: 'Slow Zoom', text: 'Slow cinematic zoom in, shallow depth of field, film look' },
  { label: 'Drone', text: 'Aerial drone shot slowly descending, epic cinematic scale' },
  { label: 'Dolly', text: 'Smooth dolly tracking shot, following the subject' },
  { label: 'Still', text: 'Static locked-off camera, subtle ambient motion only' },
  { label: 'Handheld', text: 'Natural handheld camera movement, documentary style' },
];

// ── Model Groups (order matches Higgsfield screenshot) ───────────────────

const MODEL_GROUPS = [
  { name: 'Minimax Hailuo', description: 'High-dynamic, VFX-ready, fastest and most affordable' },
  { name: 'Kling', description: 'Perfect motion with advanced video control' },
  { name: 'OpenAI Sora 2', description: 'Multi-shot video with sound generation' },
  { name: 'Google Veo', description: 'Precision video with sound control' },
  { name: 'Wan', description: 'Camera-controlled video with sound, more freedom' },
  { name: 'Seedance', description: 'Cinematic, multi-shot video creation' },
];

const FEATURED_TAB_MODELS = [
  { label: 'Kling 3.0 Pro', key: 'kling-30-pro' },
  { label: 'Kling 3.0', key: 'kling-30' },
  { label: 'Kling 2.6', key: 'kling-26' },
  { label: 'Veo 3.1 Fast', key: 'veo31-fast' },
  { label: 'Sora 2', key: 'sora-2' },
  { label: 'Wan 2.6', key: 'wan-26' },
  { label: 'Hailuo 2.3', key: 'hailuo-23' },
  { label: 'Seedance 2.0', key: 'seedance-20' },
  { label: 'Seedance 1.5', key: 'seedance-15-pro' },
];

// ── Example video presets (shown in gallery when no history) ─────────────

const EXAMPLE_STYLES: { label: string; img: string; prompt?: string }[] = [
  { label: 'MINIMAL ANIMATE', img: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&q=90&auto=format&fit=crop', prompt: 'minimally animate' },
  { label: 'MIRROR SELFIE', img: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=90&auto=format&fit=crop' },
  { label: 'STREAM',        img: 'https://images.unsplash.com/photo-1598550476439-6847785fcea6?w=800&q=90&auto=format&fit=crop' },
  { label: 'ASMR',          img: 'https://images.unsplash.com/photo-1589903308904-1010c2294adc?w=800&q=90&auto=format&fit=crop' },
  { label: 'PODCAST',       img: 'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=800&q=90&auto=format&fit=crop' },
  { label: 'STATIC',        img: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=800&q=90&auto=format&fit=crop' },
  { label: 'STEADICAM',     img: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?w=800&q=90&auto=format&fit=crop' },
  { label: 'INTERVIEW',     img: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&q=90&auto=format&fit=crop' },
  { label: 'TIMELAPSE',     img: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&q=90&auto=format&fit=crop' },
  { label: 'SLOW MOTION',   img: 'https://images.unsplash.com/photo-1470813740244-df37b8c1edcb?w=800&q=90&auto=format&fit=crop' },
  { label: 'CINEMATIC',     img: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=800&q=90&auto=format&fit=crop' },
  { label: 'VLOG',          img: 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&q=90&auto=format&fit=crop' },
];

// Legacy localStorage key (migration + cleanup)
const LEGACY_HISTORY_KEY = 'klint_video_history';

// ── Component ─────────────────────────────────────────────────────────────

interface FalVideoPageProps { initialImage?: string; }

export const FalVideoPage: React.FC<FalVideoPageProps> = ({ initialImage }) => {
  const [activeTab, setActiveTab] = useState<MainTab>('create');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const selectorRef = useRef<HTMLDivElement>(null);
  const { activeProject, refreshProjectVideos, refreshUnorganized } = useVideoProjects();

  const [createModelKey, setCreateModelKey] = useState('kling-30-pro');
  const [createMode, setCreateMode] = useState<CreateMode>(initialImage ? 'i2v' : 't2v');
  const [createAspectRatio, setCreateAspectRatio] = useState('16:9');
  const [createDuration, setCreateDuration] = useState(5);
  const [createResolution, setCreateResolution] = useState('720p');
  const [createAudio, setCreateAudio] = useState(false);
  const [createImage, setCreateImage] = useState<string | null>(initialImage || null);
  const [createImageDrag, setCreateImageDrag] = useState(false);
  const [createEndImage, setCreateEndImage] = useState<string | null>(null);
  const [createEndImageDrag, setCreateEndImageDrag] = useState(false);
  const createImageRef = useRef<HTMLInputElement>(null);
  const createEndImageRef = useRef<HTMLInputElement>(null);

  const [editVideo, setEditVideo] = useState<string | null>(null);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editVideoDrag, setEditVideoDrag] = useState(false);
  const [editDuration, setEditDuration] = useState(5);
  const editVideoRef = useRef<HTMLInputElement>(null);

  const [motionModelKey, setMotionModelKey] = useState('kling-omni');
  const [motionMedia, setMotionMedia] = useState<string | null>(null);
  const [motionMediaUrl, setMotionMediaUrl] = useState('');
  const [motionMediaDrag, setMotionMediaDrag] = useState(false);
  const motionMediaRef = useRef<HTMLInputElement>(null);
  const [motionCharImage, setMotionCharImage] = useState<string | null>(null);
  const [motionCharImageDrag, setMotionCharImageDrag] = useState(false);
  const motionCharImageRef = useRef<HTMLInputElement>(null);

  const [createPrompt, setCreatePrompt] = useState('');
  const [createNegPrompt, setCreateNegPrompt] = useState('');
  const [showNegPrompt, setShowNegPrompt] = useState(false);

  // Character picker — picks a saved Character profile and uses its first
  // reference photo as the source frame for image-to-video. Wired to
  // createImage so the model gets a real face anchor instead of t2v-ing.
  const [videoCharacters, setVideoCharacters] = useState<{ id: string; name: string; thumbnail: string; images: string[] }[]>([]);
  const [selectedVideoCharacterId, setSelectedVideoCharacterId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { listCharacters } = await import('../../services/characterStore');
        const { supabase } = await import('../../services/supabaseClient');
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.id) return;
        const chars = await listCharacters(user.id);
        if (!cancelled) setVideoCharacters(chars);
      } catch (err) {
        console.warn('[FalVideoPage] character load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const [editPrompt, setEditPrompt] = useState('');
  const [motionPrompt, setMotionPrompt] = useState('');

  // ── Concurrent generation jobs (up to 4, survive navigation) ──
  interface GenJob {
    id: string; status: GenerationStatus; detail: string; modelName: string; prompt: string;
    abort: AbortController;
    // Persisted fields for resume after navigation
    statusUrl?: string; responseUrl?: string; aspectRatio?: string; projectId?: string;
  }
  interface PersistedJob {
    id: string; modelName: string; prompt: string; statusUrl: string; responseUrl: string;
    aspectRatio: string; projectId?: string; startedAt: number;
  }

  const JOBS_SESSION_KEY = 'klint_video_active_jobs';
  const persistJobs = (pJobs: PersistedJob[]) => {
    try { sessionStorage.setItem(JOBS_SESSION_KEY, JSON.stringify(pJobs)); } catch {}
  };
  const loadPersistedJobs = (): PersistedJob[] => {
    try { const r = sessionStorage.getItem(JOBS_SESSION_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
  };
  const removePersistedJob = (jobId: string) => {
    const current = loadPersistedJobs().filter(j => j.id !== jobId);
    persistJobs(current);
  };

  const [jobs, setJobs] = useState<GenJob[]>([]);
  const activePolls = useRef<Set<string>>(new Set()); // Track active poll loops to prevent duplicates
  const MAX_CONCURRENT = 4;

  const [error, setError] = useState<string | null>(null);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const [history, setHistory] = useState<StoredVideo[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => { if (initialImage) { setCreateImage(initialImage); setCreateMode('i2v'); setActiveTab('create'); } }, [initialImage]);

  // Load video history from IndexedDB on mount (+ migrate any legacy localStorage entries)
  useEffect(() => {
    (async () => {
      try {
        // Migrate legacy localStorage entries to IndexedDB
        const legacyRaw = localStorage.getItem(LEGACY_HISTORY_KEY);
        if (legacyRaw) {
          const legacyVideos: StoredVideo[] = JSON.parse(legacyRaw);
          await Promise.all(legacyVideos.map(v => saveVideoGeneration(v).catch(() => {})));
          localStorage.removeItem(LEGACY_HISTORY_KEY);
          console.log(`[VideoStore] Migrated ${legacyVideos.length} legacy videos from localStorage`);
        }
        // Load from IndexedDB
        const videos = await getVideoGenerations();
        setHistory(videos);
      } catch (e) {
        console.warn('[VideoStore] Failed to load video history:', e);
      }
    })();
  }, []);

  // ── Resume persisted jobs that were running when user navigated away ──
  // Use refs for context functions so resumeJob doesn't re-create on context changes
  const refreshProjectVideosRef = useRef(refreshProjectVideos);
  const refreshUnorganizedRef = useRef(refreshUnorganized);
  useEffect(() => { refreshProjectVideosRef.current = refreshProjectVideos; }, [refreshProjectVideos]);
  useEffect(() => { refreshUnorganizedRef.current = refreshUnorganized; }, [refreshUnorganized]);

  const resumeJob = useCallback((pJob: PersistedJob, isNewSubmission = false) => {
    // Prevent duplicate poll loops for the same job
    if (activePolls.current.has(pJob.id)) return;
    activePolls.current.add(pJob.id);

    const abort = new AbortController();
    const job: GenJob = {
      id: pJob.id, status: 'processing', detail: isNewSubmission ? 'Submitted! Waiting for server...' : 'Resuming...', modelName: pJob.modelName,
      prompt: pJob.prompt, abort, statusUrl: pJob.statusUrl, responseUrl: pJob.responseUrl,
      aspectRatio: pJob.aspectRatio, projectId: pJob.projectId,
    };
    setJobs(prev => {
      // If job already exists (from handleGenerate's 'submitting' phase), update it in-place
      const existing = prev.findIndex(j => j.id === pJob.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = job;
        return updated;
      }
      return [...prev, job];
    });

    // Start polling — use startedAt for stable elapsed time
    const POLL_INTERVAL = 4000;
    const MAX_WAIT = 600000;
    const startedAt = pJob.startedAt || Date.now();

    const poll = async () => {
      // For new submissions, poll immediately first (no initial wait)
      if (!isNewSubmission) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
      while ((Date.now() - startedAt) < MAX_WAIT && !abort.signal.aborted) {
        const elapsed = Date.now() - startedAt;
        try {
          const status = await pollStatus(pJob.statusUrl);
          if (status.status === 'IN_QUEUE') {
            setJobs(prev => prev.map(j => j.id === pJob.id ? { ...j, status: 'queued', detail: `In queue... ${Math.round(elapsed / 1000)}s` } : j));
          } else if (status.status === 'IN_PROGRESS') {
            setJobs(prev => prev.map(j => j.id === pJob.id ? { ...j, status: 'processing', detail: `Generating... ${Math.round(elapsed / 1000)}s` } : j));
          } else if (status.status === 'COMPLETED') {
            const result = await fetchResult(pJob.responseUrl);
            const url = extractVideoUrl(result);
            setCurrentVideo(url);
            // Use pJob.id as video ID to prevent duplicates (upsert via IndexedDB put)
            const newEntry: StoredVideo = {
              id: pJob.id, url, prompt: pJob.prompt, modelName: pJob.modelName,
              aspectRatio: pJob.aspectRatio, createdAt: pJob.startedAt || Date.now(),
              ...(pJob.projectId ? { projectId: pJob.projectId } : {}),
            };
            await saveVideoGeneration(newEntry).catch(() => {});
            refreshProjectVideosRef.current();
            refreshUnorganizedRef.current();
            setHistory(prev => {
              // Deduplicate — don't add if already present
              if (prev.some(v => v.id === newEntry.id)) return prev;
              return [newEntry, ...prev.slice(0, 29)];
            });
            setJobs(prev => prev.map(j => j.id === pJob.id ? { ...j, status: 'done', detail: 'Complete!' } : j));
            removePersistedJob(pJob.id);
            activePolls.current.delete(pJob.id);
            setTimeout(() => setJobs(prev => prev.filter(j => j.id !== pJob.id)), 5000);
            return;
          } else if (status.status === 'FAILED') {
            setJobs(prev => prev.map(j => j.id === pJob.id ? { ...j, status: 'error', detail: 'Generation failed' } : j));
            removePersistedJob(pJob.id);
            activePolls.current.delete(pJob.id);
            setTimeout(() => setJobs(prev => prev.filter(j => j.id !== pJob.id)), 8000);
            return;
          }
        } catch (e: any) {
          console.warn('[VideoResume] Poll error:', e.message);
        }
        // Wait before next poll
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
      activePolls.current.delete(pJob.id);
    };
    poll();
  }, []); // stable — uses refs for context functions

  useEffect(() => {
    const persisted = loadPersistedJobs();
    if (persisted.length > 0) {
      console.log(`[VideoJobs] Resuming ${persisted.length} persisted job(s)`);
      persisted.forEach(pj => resumeJob(pj));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount only

  const selectedCreate = CREATE_MODELS.find(m => m.key === createModelKey) || CREATE_MODELS[0];
  const selectedMotion = MOTION_MODELS.find(m => m.key === motionModelKey) || MOTION_MODELS[0];
  const activeJobs = jobs.filter(j => j.status !== 'idle' && j.status !== 'done' && j.status !== 'error');
  const isGenerating = activeJobs.length > 0;
  const canStartNew = activeJobs.length < MAX_CONCURRENT;

  const effectiveCreateMode: CreateMode =
    createMode === 'i2v' && !selectedCreate.supportsI2V ? 't2v' :
    createMode === 't2v' && !selectedCreate.supportsT2V ? 'i2v' : createMode;

  const activePrompt = activeTab === 'create' ? createPrompt : activeTab === 'edit' ? editPrompt : motionPrompt;
  const setActivePrompt = (v: string) => { if (activeTab === 'create') setCreatePrompt(v); else if (activeTab === 'edit') setEditPrompt(v); else setMotionPrompt(v); };

  const toDataUrl = (file: File): Promise<string> => new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target!.result as string); r.onerror = rej; r.readAsDataURL(file); });
  const handleCreateImageFile = async (file: File) => { if (!file.type.startsWith('image/')) return; setCreateImage(await toDataUrl(file)); setCreateMode('i2v'); };
  const handleCreateEndImageFile = async (file: File) => { if (!file.type.startsWith('image/')) return; setCreateEndImage(await toDataUrl(file)); setCreateMode('i2v'); };
  const handleEditVideoFile = async (file: File) => { if (!file.type.startsWith('video/')) return; setEditVideo(await toDataUrl(file)); setEditVideoUrl(''); };
  const handleMotionMediaFile = async (file: File) => { const ok = file.type.startsWith('video/') || file.type.startsWith('image/'); if (!ok) return; setMotionMedia(await toDataUrl(file)); setMotionMediaUrl(''); };
  const handleMotionCharImageFile = async (file: File) => { if (!file.type.startsWith('image/')) return; setMotionCharImage(await toDataUrl(file)); };

  const handleDownload = async (url: string, filename = 'godseye-video.mp4') => {
    setIsDownloading(true);
    try { const res = await fetch(url); const blob = await res.blob(); const blobUrl = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = blobUrl; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(blobUrl), 10000); }
    catch { window.open(url, '_blank'); } finally { setIsDownloading(false); }
  };

  const handleDeleteVideo = (id: string) => {
    deleteVideoGeneration(id).catch(() => {});
    setHistory(prev => prev.filter(v => v.id !== id));
  };
  const handleClearHistory = () => {
    clearVideoGenerations().catch(() => {});
    setHistory([]); setCurrentVideo(null);
  };

  const selectModel = (key: string) => {
    const m = CREATE_MODELS.find(x => x.key === key); if (!m) return;
    setCreateModelKey(key); setCreateDuration(m.durationOptions[0]);
    if (!m.supportsI2V) setCreateMode('t2v'); if (!m.supportsT2V) setCreateMode('i2v');
    if (!m.aspectRatios.includes(createAspectRatio)) setCreateAspectRatio(m.aspectRatios[0]);
    setShowModelSelector(false); setModelSearch(''); setHoveredGroup(null);
  };

  const handleGenerate = useCallback(async () => {
    if (!activeProject) { setError('Open or create a project folder first.'); return; }
    if (!canStartNew) { setError(`Max ${MAX_CONCURRENT} concurrent generations. Wait for one to finish.`); return; }
    setError(null);
    let modelId: string; let input: Record<string, any>; let promptText: string; let modelName: string; let outAspect = '16:9';
    try {
      if (activeTab === 'create') {
        if (!createPrompt.trim()) { setError('Enter a prompt first.'); return; }
        if (effectiveCreateMode === 'i2v' && !createImage) { setError('Upload a reference image for Image-to-Video mode.'); return; }
        const activeId = effectiveCreateMode === 'i2v' ? selectedCreate.i2vId : selectedCreate.t2vId;
        if (!activeId) { setError('This model does not support the selected mode.'); return; }
        modelId = activeId;
        input = selectedCreate.buildInput({ prompt: createPrompt.trim(), negativePrompt: createNegPrompt.trim(), duration: createDuration, aspectRatio: createAspectRatio, resolution: createResolution, generateAudio: createAudio, imageUrl: createImage || undefined, endImageUrl: createEndImage || undefined, mode: effectiveCreateMode });
        promptText = createPrompt.trim(); modelName = selectedCreate.name; outAspect = createAspectRatio;
      } else if (activeTab === 'edit') {
        if (!editPrompt.trim()) { setError('Enter an edit instruction.'); return; }
        const videoSrc = editVideoUrl.trim() || editVideo;
        if (!videoSrc) { setError('Upload a source video or paste a URL.'); return; }
        modelId = 'fal-ai/kling-video/o1/video-to-video/edit';
        input = { prompt: editPrompt.trim(), video_url: videoSrc, keep_audio: false };
        promptText = editPrompt.trim(); modelName = 'Kling O1 Edit';
      } else {
        if (!motionPrompt.trim()) { setError('Enter a motion prompt.'); return; }
        const mediaSrc = motionMediaUrl.trim() || motionMedia || undefined;
        if (motionModelKey === 'kling-motion' && !mediaSrc) { setError('Upload a motion reference video.'); return; }
        modelId = selectedMotion.modelId;
        input = selectedMotion.buildInput({ prompt: motionPrompt.trim(), videoUrl: mediaSrc, imageUrl: motionModelKey === 'kling-motion' ? (motionCharImage || undefined) : (selectedMotion.acceptsImage ? mediaSrc : undefined) });
        promptText = motionPrompt.trim(); modelName = selectedMotion.name;
      }

      // Create a new job
      const jobId = crypto.randomUUID();
      const abort = new AbortController();
      const projectId = activeProject?.id;
      const job: GenJob = { id: jobId, status: 'submitting', detail: 'Uploading assets...', modelName, prompt: promptText, abort, aspectRatio: outAspect, projectId };
      setJobs(prev => [...prev, job]);

      // Submit to fal.ai queue, persist job for navigation resilience, then poll
      (async () => {
        try {
          setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'submitting', detail: 'Uploading assets & submitting...' } : j));
          const { statusUrl, responseUrl } = await submitJob(modelId, input);

          // Persist job so it survives navigation away from Video page
          const pJob: PersistedJob = { id: jobId, modelName, prompt: promptText, statusUrl, responseUrl, aspectRatio: outAspect, projectId, startedAt: Date.now() };
          persistJobs([...loadPersistedJobs(), pJob]);

          // Now resume polling using the shared resumeJob logic
          // Pass isNewSubmission=true to update existing card in-place & poll immediately
          resumeJob(pJob, true);
        } catch (e: any) {
          setError(e.message);
          setJobs(prev => prev.map(j => j.id === jobId ? { ...j, status: 'error', detail: e.message } : j));
          setTimeout(() => setJobs(prev => prev.filter(j => j.id !== jobId)), 8000);
        }
      })();

    } catch (e: any) { setError(e.message); }
  }, [canStartNew, activeTab, createPrompt, createNegPrompt, createDuration, createAspectRatio, createResolution, createAudio, createImage, createEndImage, effectiveCreateMode, selectedCreate, editPrompt, editVideo, editVideoUrl, motionPrompt, selectedMotion, motionMedia, motionMediaUrl, motionCharImage, motionModelKey, activeProject, refreshProjectVideos, refreshUnorganized, resumeJob]);

  const handleCancel = (jobId?: string) => {
    if (jobId) {
      const job = jobs.find(j => j.id === jobId);
      job?.abort.abort();
      removePersistedJob(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } else {
      // Cancel all
      jobs.forEach(j => { j.abort.abort(); removePersistedJob(j.id); });
      setJobs([]);
    }
  };
  const appendPreset = (text: string) => { if (activeTab === 'create') setCreatePrompt(p => p ? `${p.trim()}. ${text}` : text); else if (activeTab === 'motion') setMotionPrompt(p => p ? `${p.trim()}. ${text}` : text); };

  const STATUS_MAP: Record<string, { label: string; color: string }> = {
    submitting: { label: 'Uploading & submitting...', color: 'text-brand' },
    queued: { label: 'In queue...', color: 'text-yellow-400' },
    processing: { label: 'Generating...', color: 'text-blue-400' },
    done: { label: 'Complete!', color: 'text-emerald-400' },
    error: { label: 'Failed', color: 'text-red-400' },
  };
  const getStatusCfg = (job: GenJob) => {
    const base = STATUS_MAP[job.status];
    return base ? { label: job.detail || base.label, color: base.color } : null;
  };

  const filteredGroups = MODEL_GROUPS.filter(g => !modelSearch || g.name.toLowerCase().includes(modelSearch.toLowerCase()) || CREATE_MODELS.filter(m => m.group === g.name).some(m => m.name.toLowerCase().includes(modelSearch.toLowerCase())));
  const getGroupModels = (g: string) => CREATE_MODELS.filter(m => m.group === g);

  const optBtn = (active: boolean) => `flex-1 py-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${active ? 'border-brand/70 bg-brand/15 text-brand' : 'border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.03] text-text-secondary hover:border-zinc-300 dark:hover:border-white/20 hover:text-text-primary'}`;

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <div className="relative h-screen w-full flex flex-col overflow-hidden pt-[72px] bg-white dark:bg-[#0a0a0a]">
      {/* Brand-green aurora — only in dark mode */}
      <div aria-hidden className="hidden dark:block pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-10%] left-[-5%] right-[55%] h-[560px] aw-aurora" style={{ background: 'radial-gradient(45% 50% at 22% 28%, rgba(204,255,0,0.08), transparent 65%)' }} />
        <div className="absolute bottom-[-15%] left-[55%] right-[-5%] h-[560px] aw-aurora" style={{ background: 'radial-gradient(40% 50% at 75% 70%, rgba(204,255,0,0.05), transparent 65%)', animationDelay: '-8s', animationDuration: '22s' }} />
      </div>

      {/* ══ TOP BAR — tabs left, featured models center, search right ══ */}
      <div className="relative z-10 flex items-center px-5 h-12 flex-shrink-0 border-b border-zinc-200 dark:border-white/[0.06] bg-white/80 dark:bg-[#0a0a0a]/80 backdrop-blur">
        {/* Tabs */}
        <div className="flex items-center gap-4 mr-8">
          {([
            { id: 'create', label: 'Create Video' },
            { id: 'edit', label: 'Edit Video' },
            { id: 'motion', label: 'Motion Control' },
          ] as const).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`text-[13px] font-medium transition-colors whitespace-nowrap ${activeTab === tab.id ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-white/40 hover:text-zinc-700 dark:hover:text-white/70'}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Featured model tabs — horizontal scroll like Higgsfield */}
        {activeTab === 'create' && (
          <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {FEATURED_TAB_MODELS.map(ft => {
              const isActive = createModelKey === ft.key;
              return (
                <button key={ft.key} onClick={() => selectModel(ft.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-all ${isActive ? 'bg-zinc-100 dark:bg-white/10 text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-white/40 hover:text-zinc-700 dark:hover:text-white/70'}`}>
                  <span className="text-zinc-300 dark:text-white/30">&#9675;</span>
                  {ft.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Search + Close for model selector */}
        <div className="flex items-center gap-2 ml-auto">
          {showModelSelector && (
            <button onClick={() => setShowModelSelector(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 dark:text-white/40 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 transition-all">
              <X size={18} />
            </button>
          )}
          {!showModelSelector && (
            <button onClick={() => setShowModelSelector(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-zinc-400 dark:text-white/30 hover:text-zinc-600 dark:hover:text-white/60 hover:bg-zinc-100 dark:hover:bg-white/5 transition-all text-[13px]">
              Search
            </button>
          )}
        </div>
      </div>

      {/* ══ MAIN CONTENT AREA ══ */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ══ LEFT SIDEBAR ══ */}
        <aside className="w-[320px] flex-shrink-0 flex flex-col overflow-hidden border-r border-zinc-200 dark:border-white/[0.06] bg-zinc-50 dark:bg-[#0d0d0d]">
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5 scrollbar-hide">

            {activeTab === 'create' && (<>
              {/* Preview / Image upload area */}
              {createImage ? (
                <div className="relative group rounded-2xl overflow-hidden">
                  <img src={createImage} alt="Source" className="w-full aspect-video object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <div className="absolute bottom-3 left-3">
                    <p className="text-white text-[13px] font-bold uppercase tracking-wide">SOURCE IMAGE</p>
                    <p className="text-white/50 text-[11px]">{selectedCreate.name}</p>
                  </div>
                  <button onClick={() => { setCreateImage(null); setCreateMode('t2v'); }}
                    className="absolute top-3 right-3 px-3 py-1.5 bg-white/10 backdrop-blur-md rounded-lg text-white text-[11px] font-medium flex items-center gap-1.5 hover:bg-white/20 transition-all">
                    <RefreshCw size={11} /> Change
                  </button>
                </div>
              ) : (
                <div
                  className={`aspect-[4/3] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${createImageDrag ? 'border-brand bg-brand/5 scale-[1.01]' : 'border-zinc-300 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/20 bg-zinc-100 dark:bg-white/[0.02]'}`}
                  onDragOver={e => { e.preventDefault(); setCreateImageDrag(true); }}
                  onDragLeave={() => setCreateImageDrag(false)}
                  onDrop={e => { e.preventDefault(); setCreateImageDrag(false); const f = e.dataTransfer.files[0]; if (f) handleCreateImageFile(f); }}
                  onClick={() => createImageRef.current?.click()}>
                  <div className="w-12 h-12 rounded-2xl bg-zinc-200 dark:bg-white/[0.04] border border-zinc-300 dark:border-white/8 flex items-center justify-center">
                    <ImageIcon size={22} className="text-zinc-400 dark:text-white/30" />
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] text-zinc-700 dark:text-white/80">Upload image or <span className="text-zinc-900 dark:text-white font-bold">generate it</span></p>
                    <p className="text-[11px] text-zinc-400 dark:text-white/30 mt-1">PNG, JPG or Paste from clipboard</p>
                  </div>
                  <input ref={createImageRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCreateImageFile(f); }} />
                </div>
              )}

              {/* End frame */}
              {effectiveCreateMode === 'i2v' && createImage && (
                <div>
                  <p className="text-[10px] text-zinc-400 dark:text-white/30 mb-1.5 font-medium">End Frame <span className="opacity-60">(optional)</span></p>
                  {createEndImage ? (
                    <div className="relative group rounded-xl overflow-hidden border border-white/8 h-16">
                      <img src={createEndImage} alt="End" className="w-full h-full object-cover" />
                      <button onClick={() => setCreateEndImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-white hover:bg-red-600 transition-all"><X size={9} /></button>
                    </div>
                  ) : (
                    <div className={`h-16 rounded-xl border border-dashed flex items-center justify-center gap-2 cursor-pointer transition-all ${createEndImageDrag ? 'border-brand bg-brand/5' : 'border-zinc-300 dark:border-white/8 hover:border-zinc-400 dark:hover:border-white/15'}`}
                      onDragOver={e => { e.preventDefault(); setCreateEndImageDrag(true); }} onDragLeave={() => setCreateEndImageDrag(false)}
                      onDrop={e => { e.preventDefault(); setCreateEndImageDrag(false); const f = e.dataTransfer.files[0]; if (f) handleCreateEndImageFile(f); }}
                      onClick={() => createEndImageRef.current?.click()}>
                      <Upload size={12} className="text-zinc-300 dark:text-white/20" /><span className="text-[10px] text-zinc-400 dark:text-white/30">Drop end frame</span>
                      <input ref={createEndImageRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleCreateEndImageFile(f); }} />
                    </div>
                  )}
                </div>
              )}

              {/* Prompt */}
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-1.5">Prompt</p>
                <p className="text-[11px] text-zinc-400 dark:text-white/20 mb-2">Describe the scene you imagine, with details.</p>
                <textarea className="w-full bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2.5 text-[12px] text-zinc-800 dark:text-white/80 placeholder-zinc-300 dark:placeholder-white/20 outline-none resize-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" rows={3} placeholder="A golden retriever runs through a field..." value={createPrompt} onChange={e => setCreatePrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } e.stopPropagation(); }} />
                <div className="flex items-center gap-1.5 mt-2">
                  <Sparkles size={12} className="text-[#c8ff00]" />
                  <span className="text-[11px] text-zinc-500 dark:text-white/50 font-medium">Enhance on</span>
                </div>
                {/* Negative prompt toggle */}
                <button onClick={() => setShowNegPrompt(v => !v)} className="mt-2 text-[10px] text-zinc-400 dark:text-white/25 hover:text-zinc-500 dark:hover:text-white/40 transition-colors flex items-center gap-1">
                  Negative prompt {showNegPrompt ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                </button>
                {showNegPrompt && (
                  <input className="w-full mt-1.5 bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2 text-zinc-600 dark:text-white/50 text-[11px] placeholder-zinc-300 dark:placeholder-white/15 outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" placeholder="blur, shaky, low quality, watermark" value={createNegPrompt} onChange={e => setCreateNegPrompt(e.target.value)} onKeyDown={e => e.stopPropagation()} />
                )}
              </div>

              {/* Character picker — face anchor for image-to-video.
                  Auto-loads the character's first reference photo as the
                  start frame, switches to i2v mode. Shows a Seedance face-
                  policy warning when the selected video model is incompatible. */}
              {videoCharacters.length > 0 && (() => {
                const charSupport = getCharacterSupport(selectedCreate.t2vId || selectedCreate.i2vId || '');
                const selectedChar = videoCharacters.find(c => c.id === selectedVideoCharacterId);
                return (
                  <div>
                    <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-1.5 flex items-center gap-1.5">
                      <span>Character</span>
                      <span className="text-[9px] uppercase tracking-wider text-zinc-400 dark:text-white/25 font-bold">Optional · Face anchor</span>
                    </p>
                    <select
                      value={selectedVideoCharacterId || ''}
                      onChange={e => {
                        const id = e.target.value || null;
                        setSelectedVideoCharacterId(id);
                        if (id) {
                          const c = videoCharacters.find(ch => ch.id === id);
                          if (c) {
                            setCreateImage(c.thumbnail);
                            // Auto-flip to image-to-video so the character face is honored
                            if (selectedCreate.supportsI2V) setCreateMode('i2v');
                          }
                        }
                      }}
                      className="w-full bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2.5 text-[12px] text-zinc-800 dark:text-white/80 outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors"
                    >
                      <option value="">— None —</option>
                      {videoCharacters.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    {/* Compatibility warnings */}
                    {selectedChar && charSupport.support === 'limited' && (
                      <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-[11px] leading-relaxed">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <span>
                          <span className="font-bold block mb-0.5">Limited compatibility with {selectedCreate.name}</span>
                          {charSupport.warning}
                        </span>
                      </div>
                    )}
                    {selectedChar && charSupport.support === 'none' && (
                      <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] leading-relaxed">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <span>
                          <span className="font-bold block mb-0.5">Not supported by {selectedCreate.name}</span>
                          This text-to-video model can't accept a character reference. Switch to an image-to-video model (Veo 3.1, Hailuo, Sora 2) to use this character.
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Model selector button */}
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-1.5">Model</p>
                <button onClick={() => setShowModelSelector(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.02] hover:bg-zinc-50 dark:hover:bg-white/[0.04] hover:border-zinc-300 dark:hover:border-white/15 transition-all">
                  <div>
                    <p className="text-[13px] text-zinc-900 dark:text-white font-medium">{selectedCreate.name}</p>
                  </div>
                  <ChevronDown size={14} className="text-zinc-400 dark:text-white/30" />
                </button>
              </div>

              {/* Resolution + Ratio row */}
              <div className="flex gap-3">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.02]">
                  <span className="text-[10px] text-[#c8ff00]">&#9670;</span>
                  <select value={createResolution} onChange={e => setCreateResolution(e.target.value)} className="bg-transparent text-zinc-800 dark:text-white text-[12px] font-medium outline-none cursor-pointer">
                    <option value="720p" className="bg-white dark:bg-[#151515]">720p</option>
                    <option value="1080p" className="bg-white dark:bg-[#151515]">1080p</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.02]">
                  <MonitorPlay size={12} className="text-zinc-400 dark:text-white/30" />
                  <select value={createAspectRatio} onChange={e => setCreateAspectRatio(e.target.value)} className="bg-transparent text-zinc-800 dark:text-white text-[12px] font-medium outline-none cursor-pointer">
                    {selectedCreate.aspectRatios.map(ar => <option key={ar} value={ar} className="bg-white dark:bg-[#151515]">{ar}</option>)}
                  </select>
                </div>
                {selectedCreate.durationOptions.length > 1 && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.02]">
                    <Clock size={12} className="text-zinc-400 dark:text-white/30" />
                    <select value={createDuration} onChange={e => setCreateDuration(Number(e.target.value))} className="bg-transparent text-zinc-800 dark:text-white text-[12px] font-medium outline-none cursor-pointer">
                      {selectedCreate.durationOptions.map(d => <option key={d} value={d} className="bg-white dark:bg-[#151515]">{d}s</option>)}
                    </select>
                  </div>
                )}
              </div>

              {/* Audio toggle — only for models with hasAudio */}
              {selectedCreate.hasAudio && (
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <Volume2 size={14} className={createAudio ? 'text-[#c8ff00]' : 'text-white/25'} />
                    <span className="text-[12px] font-medium text-zinc-600 dark:text-white/70">Generate Audio</span>
                  </div>
                  <button onClick={() => setCreateAudio(v => !v)}
                    className={`relative w-9 h-5 rounded-full transition-all ${createAudio ? 'bg-[#c8ff00]' : 'bg-white/10'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${createAudio ? 'left-[18px] bg-black' : 'left-0.5 bg-white/40'}`} />
                  </button>
                </div>
              )}

              {/* Generate button */}
              <button onClick={handleGenerate} disabled={!canStartNew || !createPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#c8ff00] text-black font-bold text-[14px] disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 active:scale-[0.98] transition-all shadow-[0_8px_32px_-8px_rgba(200,255,0,0.3)]">
                {!canStartNew ? <><Loader2 size={16} className="animate-spin" /> Queue Full ({activeJobs.length}/{MAX_CONCURRENT})</> : <><Sparkles size={16} /> Generate {activeJobs.length > 0 ? `(${activeJobs.length} running)` : ''}</>}
              </button>
            </>)}

            {/* ──── EDIT TAB ──── */}
            {activeTab === 'edit' && (<>
              <div className="px-4 py-3 rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.02]">
                <p className="text-[13px] font-bold text-zinc-900 dark:text-white">Kling O1 Edit</p>
                <p className="text-[10px] text-zinc-400 dark:text-white/30 mt-1">Text-guided video editing</p>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-2">Source Video</p>
                {editVideo ? (
                  <div className="relative group rounded-xl overflow-hidden border border-white/8">
                    <video src={editVideo} className="w-full h-32 object-cover" muted />
                    <button onClick={() => setEditVideo(null)} className="absolute top-2 right-2 w-6 h-6 bg-black/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-white hover:bg-red-600 transition-all"><X size={12} /></button>
                  </div>
                ) : (
                  <div className={`h-32 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${editVideoDrag ? 'border-brand bg-brand/5' : 'border-zinc-300 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/20'}`}
                    onDragOver={e => { e.preventDefault(); setEditVideoDrag(true); }} onDragLeave={() => setEditVideoDrag(false)}
                    onDrop={e => { e.preventDefault(); setEditVideoDrag(false); const f = e.dataTransfer.files[0]; if (f) handleEditVideoFile(f); }}
                    onClick={() => editVideoRef.current?.click()}>
                    <Video size={18} className="text-zinc-300 dark:text-white/20" /><p className="text-[10px] text-zinc-400 dark:text-white/30">Drop video or click</p>
                    <input ref={editVideoRef} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleEditVideoFile(f); }} />
                  </div>
                )}
                <div className="mt-2 flex items-center gap-1.5">
                  <Link size={11} className="text-zinc-300 dark:text-white/20 flex-shrink-0" />
                  <input className="flex-1 bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2 text-[11px] text-zinc-600 dark:text-white/50 placeholder-zinc-300 dark:placeholder-white/15 outline-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" placeholder="Or paste video URL" value={editVideoUrl} onChange={e => { setEditVideoUrl(e.target.value); if (e.target.value) setEditVideo(null); }} onKeyDown={e => e.stopPropagation()} />
                </div>
              </div>
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-1.5">Edit Instruction</p>
                <textarea className="w-full bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2.5 text-[12px] text-zinc-800 dark:text-white/80 placeholder-zinc-300 dark:placeholder-white/20 outline-none resize-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" rows={3} placeholder="Change the sky to a sunset..." value={editPrompt} onChange={e => setEditPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } e.stopPropagation(); }} />
              </div>
              <button onClick={handleGenerate} disabled={!canStartNew || !editPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#c8ff00] text-black font-bold text-[14px] disabled:opacity-30 hover:brightness-110 active:scale-[0.98] transition-all">
                {!canStartNew ? <><Loader2 size={16} className="animate-spin" /> Queue Full</> : <><Sparkles size={16} /> Generate {activeJobs.length > 0 ? `(${activeJobs.length} running)` : ''}</>}
              </button>
            </>)}

            {/* ──── MOTION TAB ──── */}
            {activeTab === 'motion' && (<>
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-2">Model</p>
                <div className="space-y-1.5">
                  {MOTION_MODELS.map(m => (
                    <button key={m.key} onClick={() => { setMotionModelKey(m.key); setMotionMedia(null); setMotionMediaUrl(''); setMotionCharImage(null); }}
                      className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all ${motionModelKey === m.key ? 'border-brand/40 bg-brand/5' : 'border-zinc-200 dark:border-white/8 bg-white dark:bg-white/[0.02] hover:border-zinc-300 dark:hover:border-white/15'}`}>
                      <div className="flex items-center justify-between">
                        <span className={`text-[12px] font-medium ${motionModelKey === m.key ? 'text-brand' : 'text-zinc-700 dark:text-white/80'}`}>{m.name}</span>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${m.badgeColor}`}>{m.badge}</span>
                      </div>
                      <p className="text-[10px] text-zinc-400 dark:text-white/30 mt-0.5">{m.description}</p>
                    </button>
                  ))}
                </div>
              </div>
              {/* Media upload for motion */}
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-2">{selectedMotion.acceptsVideo ? 'Reference Video' : 'Reference Image'}</p>
                {motionMedia ? (
                  <div className="relative group rounded-xl overflow-hidden border border-white/8 h-24">
                    {selectedMotion.acceptsVideo ? <video src={motionMedia} className="w-full h-full object-cover" muted /> : <img src={motionMedia} alt="Ref" className="w-full h-full object-cover" />}
                    <button onClick={() => setMotionMedia(null)} className="absolute top-1.5 right-1.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-white hover:bg-red-600 transition-all"><X size={9} /></button>
                  </div>
                ) : (
                  <div className={`h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all ${motionMediaDrag ? 'border-brand bg-brand/5' : 'border-zinc-300 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/20'}`}
                    onDragOver={e => { e.preventDefault(); setMotionMediaDrag(true); }} onDragLeave={() => setMotionMediaDrag(false)}
                    onDrop={e => { e.preventDefault(); setMotionMediaDrag(false); const f = e.dataTransfer.files[0]; if (f) handleMotionMediaFile(f); }}
                    onClick={() => motionMediaRef.current?.click()}>
                    <Upload size={16} className="text-zinc-300 dark:text-white/20" /><p className="text-[10px] text-zinc-400 dark:text-white/30">Drop file or click</p>
                    <input ref={motionMediaRef} type="file" accept={selectedMotion.acceptsVideo ? 'video/*' : 'image/*'} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleMotionMediaFile(f); }} />
                  </div>
                )}
              </div>
              {motionModelKey === 'kling-motion' && (
                <div>
                  <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-2">Character Image</p>
                  {motionCharImage ? (
                    <div className="relative group rounded-xl overflow-hidden border border-white/8 h-20">
                      <img src={motionCharImage} alt="Char" className="w-full h-full object-cover" />
                      <button onClick={() => setMotionCharImage(null)} className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 text-white hover:bg-red-600 transition-all"><X size={9} /></button>
                    </div>
                  ) : (
                    <div className={`h-20 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all ${motionCharImageDrag ? 'border-brand bg-brand/5' : 'border-zinc-300 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/20'}`}
                      onDragOver={e => { e.preventDefault(); setMotionCharImageDrag(true); }} onDragLeave={() => setMotionCharImageDrag(false)}
                      onDrop={e => { e.preventDefault(); setMotionCharImageDrag(false); const f = e.dataTransfer.files[0]; if (f) handleMotionCharImageFile(f); }}
                      onClick={() => motionCharImageRef.current?.click()}>
                      <ImageIcon size={14} className="text-zinc-300 dark:text-white/20" /><p className="text-[10px] text-zinc-400 dark:text-white/30">Drop character image</p>
                      <input ref={motionCharImageRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleMotionCharImageFile(f); }} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <p className="text-[11px] text-zinc-500 dark:text-white/40 font-medium mb-1.5">Motion Prompt</p>
                <textarea className="w-full bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/8 rounded-xl px-3 py-2.5 text-[12px] text-zinc-800 dark:text-white/80 placeholder-zinc-300 dark:placeholder-white/20 outline-none resize-none focus:border-zinc-400 dark:focus:border-white/20 transition-colors" rows={3} placeholder="Slow cinematic zoom..." value={motionPrompt} onChange={e => setMotionPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGenerate(); } e.stopPropagation(); }} />
                {/* Presets */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {MOTION_PRESETS.map(p => (
                    <button key={p.label} onClick={() => appendPreset(p.text)} className="px-2.5 py-1 rounded-full text-[9px] font-medium border border-zinc-200 dark:border-white/8 text-zinc-400 dark:text-white/30 hover:text-zinc-600 dark:hover:text-white/60 hover:border-zinc-300 dark:hover:border-white/20 transition-all">{p.label}</button>
                  ))}
                </div>
              </div>
              <button onClick={handleGenerate} disabled={!canStartNew || !motionPrompt.trim()}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#c8ff00] text-black font-bold text-[14px] disabled:opacity-30 hover:brightness-110 active:scale-[0.98] transition-all">
                {!canStartNew ? <><Loader2 size={16} className="animate-spin" /> Queue Full</> : <><Sparkles size={16} /> Generate {activeJobs.length > 0 ? `(${activeJobs.length} running)` : ''}</>}
              </button>
            </>)}
          </div>

          {/* Status bar at bottom of sidebar — shows all active jobs */}
          {activeJobs.length > 0 && (
            <div className="flex-shrink-0 border-t border-zinc-200 dark:border-white/[0.06] max-h-[140px] overflow-y-auto scrollbar-hide">
              {activeJobs.map(job => {
                const cfg = getStatusCfg(job);
                return (
                  <div key={job.id} className="flex items-center gap-2 px-5 py-2.5 border-b border-zinc-100 dark:border-white/[0.03]">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className={`text-[11px] font-medium ${cfg?.color || 'text-white/50'} truncate block`}>{cfg?.label || 'Processing...'}</span>
                      <span className="text-[9px] text-zinc-400 dark:text-white/20 truncate block">{job.modelName} — {job.prompt.slice(0, 30)}{job.prompt.length > 30 ? '...' : ''}</span>
                    </div>
                    <button onClick={() => handleCancel(job.id)} className="text-[10px] text-zinc-400 dark:text-white/25 hover:text-red-400 transition-colors flex-shrink-0">Cancel</button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        {/* ══ MAIN CONTENT — Video gallery / current video ══ */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Error banner */}
          {error && (
            <div className="mx-4 mt-3 flex items-center gap-2.5 px-4 py-3 bg-red-950/80 border border-red-800/30 rounded-xl text-red-300 text-[12px]">
              <AlertCircle size={14} className="flex-shrink-0 text-red-400" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-300"><X size={12} /></button>
            </div>
          )}

          {/* Current video playing */}
          {currentVideo && (
            <div className="mx-4 mt-3 rounded-2xl overflow-hidden border border-white/[0.06] bg-black relative" style={{ maxHeight: '50%' }}>
              <video src={currentVideo} controls autoPlay loop className="w-full h-full object-contain" />
              <div className="absolute top-3 right-3 flex gap-2">
                <button onClick={() => handleDownload(currentVideo)} disabled={isDownloading}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-black/70 backdrop-blur-md rounded-lg text-white text-[11px] font-medium hover:bg-white hover:text-black transition-all border border-white/10">
                  {isDownloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                  {isDownloading ? 'Saving...' : 'Download'}
                </button>
                <button onClick={() => setCurrentVideo(null)} className="w-8 h-8 bg-black/70 backdrop-blur-md rounded-lg flex items-center justify-center text-white/60 hover:text-white border border-white/10 transition-all">
                  <X size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Generation in progress — show active jobs as cards */}
          {activeJobs.length > 0 && (
            <div className="mx-4 mt-3 space-y-2">
              {activeJobs.map(job => {
                const cfg = getStatusCfg(job);
                const progressW = job.status === 'done' ? '100%' : job.status === 'processing' ? '75%' : job.status === 'queued' ? '35%' : job.status === 'submitting' ? '10%' : '15%';
                return (
                  <div key={job.id} className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-zinc-50 dark:bg-white/[0.02] border border-zinc-200 dark:border-white/[0.06]">
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#c8ff00]/20 to-[#c8ff00]/5 border border-[#c8ff00]/30 flex items-center justify-center">
                        <Film size={20} className="text-[#c8ff00]" />
                      </div>
                      <div className="absolute inset-0 rounded-xl border border-[#c8ff00]/20 animate-ping" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`flex items-center gap-2 text-[12px] font-medium ${cfg?.color || 'text-white/50'}`}>
                        <Loader2 size={12} className="animate-spin" />{cfg?.label || 'Processing...'}
                      </div>
                      <p className="text-[10px] text-zinc-400 dark:text-white/25 mt-0.5 truncate">{job.modelName} — {job.prompt.slice(0, 50)}</p>
                      <div className="w-full h-0.5 bg-zinc-200 dark:bg-white/8 rounded-full overflow-hidden mt-1.5">
                        <div className="h-full bg-gradient-to-r from-[#c8ff00]/60 to-[#c8ff00]" style={{ width: progressW, transition: 'width 1s ease' }} />
                      </div>
                    </div>
                    <button onClick={() => handleCancel(job.id)} className="text-[10px] text-zinc-400 dark:text-white/20 hover:text-red-400 transition-colors border border-zinc-200 dark:border-white/8 rounded-full px-3 py-1 hover:border-red-500/30 flex-shrink-0">Cancel</button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Video Gallery Grid — always visible (even while generating) */}
          {activeProject ? (
            /* ── Inside a project folder ── */
            <ProjectVideoGallery onDownload={handleDownload} />
          ) : (
            /* ── Projects-only view: must create/open a project to generate ── */
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-3">
                <p className="text-[11px] text-zinc-400 dark:text-white/25 font-medium uppercase tracking-wider mb-2">Projects</p>
                <p className="text-zinc-400 dark:text-white/15 text-[11px] mb-4">Create or open a project to start generating videos</p>
              </div>
              <VideoProjectGrid />
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════════════════
            MODEL SELECTOR OVERLAY (Higgsfield exact style)
        ═══════════════════════════════════════════════════════════ */}
        {showModelSelector && (
          <>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-sm z-40" onClick={() => setShowModelSelector(false)} />

            {/* Selector panel */}
            <div ref={selectorRef} className="absolute left-1/2 top-4 -translate-x-1/2 z-50 w-[680px] max-h-[calc(100%-32px)] flex flex-col rounded-2xl bg-white dark:bg-[#151515] border border-zinc-200 dark:border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.2)] dark:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">

              {/* Search bar */}
              <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-zinc-200 dark:border-white/[0.06]">
                <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/[0.04] border border-zinc-200 dark:border-white/8">
                  <Search size={15} className="text-zinc-400 dark:text-white/25" />
                  <input className="flex-1 bg-transparent text-[13px] text-zinc-800 dark:text-white placeholder-zinc-400 dark:placeholder-white/25 outline-none" placeholder="Search..." value={modelSearch} onChange={e => setModelSearch(e.target.value)} onKeyDown={e => e.stopPropagation()} autoFocus />
                  {modelSearch && <button onClick={() => setModelSearch('')} className="text-zinc-400 dark:text-white/20 hover:text-zinc-600 dark:hover:text-white/50"><X size={14} /></button>}
                </div>
              </div>

              {/* All models label */}
              <div className="px-5 py-2 flex items-center gap-2 flex-shrink-0">
                <MonitorPlay size={13} className="text-zinc-400 dark:text-white/20" />
                <span className="text-[11px] text-zinc-400 dark:text-white/30 font-medium">All models</span>
              </div>

              {/* Two-column layout: groups left, variants right */}
              <div className="flex-1 flex overflow-hidden min-h-0" style={{ maxHeight: '460px' }}>

                {/* Left: Group list */}
                <div className="w-[300px] flex-shrink-0 overflow-y-auto scrollbar-hide border-r border-zinc-200 dark:border-white/[0.06]">
                  {filteredGroups.map(g => {
                    const models = getGroupModels(g.name);
                    const isHovered = hoveredGroup === g.name;
                    const hasSelected = models.some(m => m.key === createModelKey);
                    return (
                      <div key={g.name}
                        onMouseEnter={() => setHoveredGroup(g.name)}
                        className={`flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-all ${isHovered ? 'bg-zinc-100 dark:bg-white/[0.04]' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.02]'}`}
                        onClick={() => { if (models.length === 1) selectModel(models[0].key); }}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isHovered || hasSelected ? 'bg-zinc-200 dark:bg-white/8' : 'bg-zinc-100 dark:bg-white/[0.03]'}`}>
                          <Film size={16} className={isHovered || hasSelected ? 'text-zinc-500 dark:text-white/60' : 'text-zinc-300 dark:text-white/20'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] font-medium ${isHovered || hasSelected ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-white/70'}`}>{g.name}</p>
                          <p className="text-[10px] text-zinc-400 dark:text-white/25 truncate">{g.description}</p>
                          {/* Show resolution/duration for single-model groups */}
                          {models.length === 1 && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="flex items-center gap-1 text-[9px] text-zinc-400 dark:text-white/20"><span className="w-1 h-1 rounded-full bg-[#c8ff00]/50" />{models[0].resolution}</span>
                              <span className="flex items-center gap-1 text-[9px] text-zinc-400 dark:text-white/20"><Clock size={8} />{models[0].durationRange}</span>
                            </div>
                          )}
                        </div>
                        {models.length > 1 && <ChevronDown size={13} className="text-zinc-300 dark:text-white/15 -rotate-90 flex-shrink-0" />}
                      </div>
                    );
                  })}
                </div>

                {/* Right: Variant list (shown on hover) */}
                <div className="flex-1 overflow-y-auto scrollbar-hide">
                  {(() => {
                    const group = hoveredGroup || selectedCreate.group;
                    const models = getGroupModels(group);
                    if (models.length <= 1) return (
                      <div className="flex items-center justify-center h-full text-zinc-300 dark:text-white/15 text-[12px]">
                        Hover a group to see models
                      </div>
                    );
                    return (
                      <div className="py-2">
                        {models.map(m => {
                          const isSelected = createModelKey === m.key;
                          return (
                            <button key={m.key} onClick={() => selectModel(m.key)}
                              className={`w-full flex items-start gap-3 px-5 py-3 text-left transition-all ${isSelected ? 'bg-zinc-100 dark:bg-white/[0.04]' : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]'}`}>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`text-[13px] font-medium ${isSelected ? 'text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-white/80'}`}>{m.name}</span>
                                  {m.hasAudio && <Volume2 size={12} className="text-zinc-400 dark:text-white/30" />}
                                  {m.isExclusive && (
                                    <span className="text-[8px] font-black px-1.5 py-0.5 rounded bg-[#c8ff00] text-black uppercase tracking-wider">EXCLUSIVE</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-white/25">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#c8ff00]/50" />{m.resolution}
                                  </span>
                                  <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-white/25">
                                    <Clock size={9} />{m.durationRange}
                                  </span>
                                  {m.isEditModel && (
                                    <span className="flex items-center gap-1 text-[8px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/8 text-zinc-500 dark:text-white/50 uppercase">
                                      <Scissors size={8} /> Edit Video
                                    </span>
                                  )}
                                </div>
                              </div>
                              {isSelected && <div className="w-2 h-2 rounded-full bg-[#c8ff00] mt-1.5 flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
};
