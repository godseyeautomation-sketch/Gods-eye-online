import React, { createContext, useContext, useState, useCallback } from 'react';
import { generateImage, analyzeImageToText } from '../services/geminiService';
import { saveToLocalGallery } from '../services/localStorageService';

/* ── Types ─────────────────────────────────────────────────────────────── */
export interface StoryFrame {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string | null;
  status: 'idle' | 'pending' | 'done' | 'error';
}

export interface StorylineOption {
  id: string;
  title: string;
  description: string;
  frames: { title: string; prompt: string }[];
}

export interface AspectRatio {
  id: string;
  value: string;
  label: string;
}

export interface ReelIngredient {
  id: string;
  name: string;
  imageDataUrl: string;
}

const ASPECT_OPTIONS: AspectRatio[] = [
  { id: '9_16', value: '9:16', label: 'Vertical' },
  { id: '1_1',  value: '1:1',  label: 'Square' },
  { id: '16_9', value: '16:9', label: 'Wide' },
];

/* ── Gemini script generation helper ───────────────────────────────────── */
const buildStorylinePrompt = (imageDescription: string) => `
You are a cinematic reel director. Given this source image description, generate EXACTLY 3 different storyline options.
Each storyline should have a unique creative angle.

Source image: ${imageDescription}

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
[
  {
    "id": "storyline_1",
    "title": "Short Creative Title",
    "description": "One sentence describing the narrative arc",
    "frames": [
      { "title": "FRAME_NAME", "prompt": "Detailed image generation prompt that maintains the subject/style of the source" },
      { "title": "FRAME_NAME", "prompt": "..." },
      { "title": "FRAME_NAME", "prompt": "..." },
      { "title": "FRAME_NAME", "prompt": "..." },
      { "title": "FRAME_NAME", "prompt": "..." }
    ]
  }
]

Each storyline must have exactly 5 frames. Frame prompts should:
- Reference the same subject/person/scene from the source image
- Progress through a cinematic sequence (establishing → action → climax → resolution → closing)
- Include specific visual directions (camera angle, lighting, mood)
- Be self-contained enough to generate a standalone image
`;

const buildScriptPrompt = (imageDescription: string, storyline: StorylineOption) => `
You are a cinematic reel director. Refine and enhance these frame prompts for maximum visual impact.

Source image: ${imageDescription}
Chosen storyline: ${storyline.title} - ${storyline.description}
Original frames: ${JSON.stringify(storyline.frames)}

Return ONLY valid JSON array of exactly 5 frame objects:
[{ "title": "FRAME_NAME", "prompt": "Enhanced detailed prompt..." }]

Each prompt should be 2-3 sentences with specific visual directions (camera angle, lighting, color grade, mood).
Maintain visual consistency across all frames.
`;

/* ── Context ───────────────────────────────────────────────────────────── */
interface ReelStudioState {
  sourceImage: string | null;
  setSourceImage: (img: string | null) => void;
  storyboard: StoryFrame[];
  aspectRatio: AspectRatio;
  setAspectRatio: (ar: AspectRatio) => void;
  aspectOptions: AspectRatio[];

  // Storyline generation
  storylineOptions: StorylineOption[];
  selectedStoryline: StorylineOption | null;
  isGeneratingOptions: boolean;
  generateStorylineOptions: () => Promise<void>;
  selectStoryline: (id: string) => void;

  // Quick narrative
  isGeneratingNarrative: boolean;
  generateFromNarrative: (narrative: string) => Promise<void>;

  // Script & Shoot
  isScripting: boolean;
  generateScript: () => Promise<void>;
  createCustomScript: (frames: { title: string; prompt: string }[]) => void;
  isShooting: boolean;
  shootReel: () => Promise<void>;
  activeFrameIndex: number;
  setActiveFrameIndex: (i: number) => void;

  // Playback
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;

  // Video creation
  isCreatingVideo: boolean;
  createVideo: () => Promise<void>;

  // Frame editing
  updateFramePrompt: (frameId: string, newPrompt: string) => void;
  regenerateFrame: (frameId: string) => Promise<void>;
  isRegenerating: string | null; // frameId currently regenerating

  // Ingredients (props/products)
  ingredients: ReelIngredient[];
  addIngredient: (name: string, imageDataUrl: string) => void;
  removeIngredient: (id: string) => void;
  updateIngredientName: (id: string, name: string) => void;

  // Gallery save
  saveAllToGallery: (userId: string) => Promise<void>;
  isSavingToGallery: boolean;

  reset: () => void;
  error: string | null;
}

const ReelStudioCtx = createContext<ReelStudioState | null>(null);
export const useReelStudio = () => {
  const ctx = useContext(ReelStudioCtx);
  if (!ctx) throw new Error('useReelStudio must be used inside <ReelStudioProvider>');
  return ctx;
};

/* ── Provider ──────────────────────────────────────────────────────────── */
export const ReelStudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [storyboard, setStoryboard] = useState<StoryFrame[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(ASPECT_OPTIONS[0]);
  const [storylineOptions, setStorylineOptions] = useState<StorylineOption[]>([]);
  const [selectedStoryline, setSelectedStoryline] = useState<StorylineOption | null>(null);
  const [isGeneratingOptions, setIsGeneratingOptions] = useState(false);
  const [isScripting, setIsScripting] = useState(false);
  const [isShooting, setIsShooting] = useState(false);
  const [isCreatingVideo, setIsCreatingVideo] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState<string | null>(null);
  const [isSavingToGallery, setIsSavingToGallery] = useState(false);
  const [activeFrameIndex, setActiveFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<ReelIngredient[]>([]);
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false);

  /* ── Describe the source image using Gemini Vision ──────────────── */
  const describeImage = useCallback(async (imgDataUrl: string): Promise<string> => {
    try {
      const description = await analyzeImageToText({
        prompt: 'Describe this image in rich detail for use as a cinematic reference. Include: every person visible (appearance, clothing, expression, pose), the exact setting/location, all objects and props, lighting conditions, color palette, mood/atmosphere, and composition. Be specific and detailed. Return ONLY the description text.',
        imageDataUrl: imgDataUrl,
        model: 'gemini-2.5-flash',
      });
      return description || 'A professional photograph with cinematic composition and natural lighting';
    } catch {
      return 'A professional photograph with cinematic composition and natural lighting';
    }
  }, []);

  /* ── Generate storyline options using AI ─────────────────────────── */
  const generateStorylineOptions = useCallback(async () => {
    if (!sourceImage) return;
    setError(null);
    setIsGeneratingOptions(true);
    try {
      const description = await describeImage(sourceImage);
      const prompt = buildStorylinePrompt(description);

      // Use Gemini text API to generate storyline options
      const aiResponse = await analyzeImageToText({
        prompt,
        imageDataUrl: sourceImage,
        model: 'gemini-2.5-flash',
      });

      let parsed: StorylineOption[] | null = null;
      try {
        const cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fallback below */ }
        }
      }

      if (parsed && Array.isArray(parsed) && parsed.length >= 2) {
        // Ensure each storyline has the required fields
        const validated = parsed.slice(0, 3).map((s, idx) => ({
          id: s.id || `storyline_${idx + 1}`,
          title: s.title || `Storyline ${idx + 1}`,
          description: s.description || '',
          frames: Array.isArray(s.frames) ? s.frames.slice(0, 5).map(f => ({
            title: f.title || 'FRAME',
            prompt: f.prompt || '',
          })) : [],
        }));
        setStorylineOptions(validated);
      } else {
        throw new Error('Invalid AI response');
      }
    } catch (e: any) {
      console.warn('[ReelStudio] AI storyline generation failed, using fallback:', e);
      // Fallback templates
      const fallbackStorylines: StorylineOption[] = [
        {
          id: 'cinematic_reveal',
          title: 'Cinematic Reveal',
          description: 'Progressive zoom revealing the scene from detail to wide',
          frames: [
            { title: 'MYSTERY', prompt: `Extreme close-up of a small detail in the EXACT same scene from the reference image. Shallow depth of field, cinematic color grading, 8K` },
            { title: 'EMERGENCE', prompt: `Medium shot pulling back in the EXACT same scene from the reference image. Same people, same setting. Cinematic framing` },
            { title: 'PRESENCE', prompt: `Full portrait of the main subject in the EXACT same environment from the reference image. Slightly lower angle, professional photography` },
            { title: 'CONTEXT', prompt: `Wide shot showing the full setting from the reference image. Same people, same decor, cinematic composition` },
            { title: 'GRANDEUR', prompt: `Ultra-wide shot of the EXACT same scene from the reference image. Maximum context, cinematic masterpiece` },
          ],
        },
        {
          id: 'intimate_moments',
          title: 'Intimate Moments',
          description: 'Candid angles capturing authentic moments in the same scene',
          frames: [
            { title: 'WARMTH', prompt: `Warm close-up in the EXACT same scene from the reference image. Focus on a tender moment. Intimate photography` },
            { title: 'CANDID', prompt: `Over-the-shoulder shot in the EXACT same scene from the reference image. Documentary style, warm lighting` },
            { title: 'FOCUS', prompt: `Tight close-up of the main subject in the EXACT same scene. Shallow depth of field, editorial style` },
            { title: 'TOGETHER', prompt: `Medium two-shot in the EXACT same scene from the reference image. Lifestyle photography, natural warmth` },
            { title: 'SERENITY', prompt: `Wide peaceful shot of the EXACT same scene from the reference image. Calm composed view, reflective mood` },
          ],
        },
        {
          id: 'emotional_arc',
          title: 'Emotional Close-ups',
          description: 'Varying focal lengths to capture emotion in the same scene',
          frames: [
            { title: 'QUIET', prompt: `Contemplative medium shot in the EXACT same scene from the reference image. Soft natural lighting, artistic composition` },
            { title: 'GAZE', prompt: `Close-up portrait in the EXACT same scene from the reference image. Focus on eyes, dramatic natural lighting` },
            { title: 'ENERGY', prompt: `Dynamic angle in the EXACT same scene from the reference image. Slightly tilted camera, capturing movement` },
            { title: 'JOY', prompt: `Warm candid moment in the EXACT same scene from the reference image. Genuine smile captured naturally` },
            { title: 'PEACE', prompt: `Beautiful wide framing of the EXACT same scene from the reference image. Warm golden tones, harmonious` },
          ],
        },
      ];
      setStorylineOptions(fallbackStorylines);
    } finally {
      setIsGeneratingOptions(false);
    }
  }, [sourceImage, describeImage]);

  /* ── Select a storyline ──────────────────────────────────────────── */
  const selectStoryline = useCallback((id: string) => {
    const option = storylineOptions.find(o => o.id === id);
    if (option) {
      setSelectedStoryline(option);
      // Reset storyboard when selecting a new storyline
      setStoryboard([]);
    }
  }, [storylineOptions]);

  /* ── Generate script (create storyboard frames) ──────────────────── */
  const generateScript = useCallback(async () => {
    if (!selectedStoryline) return;
    setIsScripting(true);
    setError(null);
    try {
      const frames: StoryFrame[] = selectedStoryline.frames.map((f, i) => ({
        id: `frame_${i}_${Date.now()}`,
        title: f.title,
        prompt: f.prompt,
        imageUrl: null,
        status: 'idle' as const,
      }));
      setStoryboard(frames);
    } catch (e: any) {
      setError(e.message || 'Failed to generate script');
    } finally {
      setIsScripting(false);
    }
  }, [selectedStoryline]);

  /* ── Generate from one-line narrative — AI-powered viral script ── */
  const generateFromNarrative = useCallback(async (narrative: string) => {
    if (!narrative.trim()) return;
    const n = narrative.trim();
    setIsGeneratingNarrative(true);
    setError(null);

    try {
      // Step 1: Get AI description of the source image (if available)
      let imageContext = '';
      if (sourceImage) {
        const desc = await describeImage(sourceImage);
        imageContext = `\n\nSOURCE IMAGE DESCRIPTION:\n${desc}`;
      }

      // Step 2: Build ingredient context
      const ingredientNames = ingredients.length > 0
        ? `\n\nPRODUCTS/PROPS TO FEATURE: ${ingredients.map(ing => `"${ing.name}"`).join(', ')}`
        : '';

      // Step 3: Ask Gemini to craft a viral-optimized 5-shot script
      const scriptPrompt = `You are a world-class social media reel director and viral content strategist. Your reels consistently get millions of views.

USER'S CONCEPT: "${n}"${imageContext}${ingredientNames}

Create a 5-FRAME cinematic shot sequence optimized for VIRAL social media performance. Think like a top content creator — every frame must serve a purpose in the viewer retention funnel.

VIRAL FRAMEWORK:
- Frame 1 (HOOK): The first 0.5 seconds determine if someone scrolls past. Create an immediately arresting visual that creates curiosity or pattern interruption. What makes them STOP scrolling?
- Frame 2 (TENSION): Build intrigue. Introduce a visual question or contrast that makes the viewer need to see what happens next. Create anticipation.
- Frame 3 (PAYOFF): The main value moment. This is the hero shot — the most visually stunning or emotionally resonant frame. Maximum impact.
- Frame 4 (TWIST/CLIFFHANGER): Surprise or escalate. Show something unexpected, a different angle, or an emotional peak that makes them want to rewatch or share.
- Frame 5 (CTA/CLOSER): End with a frame so beautiful or impactful they'll save, share, or follow. This should feel like a mic drop — satisfying but leaving them wanting more.

CRITICAL RULES:
- Every frame prompt MUST say "the EXACT same scene, people, and environment from the reference image"
- Only vary camera angle, framing, lighting mood, and focus — NEVER change the location, people, clothing, or setting
- Each prompt must be a detailed image generation prompt (2-3 sentences) with specific camera directions
- Include technical photography terms (focal length feel, depth of field, lighting style)

Return ONLY valid JSON (no markdown, no backticks, no explanation) in this exact format:
[
  { "title": "SHORT_TITLE", "prompt": "Detailed image generation prompt..." },
  { "title": "SHORT_TITLE", "prompt": "Detailed image generation prompt..." },
  { "title": "SHORT_TITLE", "prompt": "Detailed image generation prompt..." },
  { "title": "SHORT_TITLE", "prompt": "Detailed image generation prompt..." },
  { "title": "SHORT_TITLE", "prompt": "Detailed image generation prompt..." }
]`;

      const aiResponse = await analyzeImageToText({
        prompt: scriptPrompt,
        imageDataUrl: sourceImage || '',
        model: 'gemini-2.5-flash',
      });

      // Parse the AI response
      let parsedFrames: { title: string; prompt: string }[] | null = null;
      try {
        // Clean potential markdown fencing
        const cleaned = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        parsedFrames = JSON.parse(cleaned);
      } catch {
        console.warn('[ReelStudio] Failed to parse AI script response, trying to extract JSON...');
        // Try to find JSON array in the response
        const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try {
            parsedFrames = JSON.parse(jsonMatch[0]);
          } catch {
            console.error('[ReelStudio] Could not extract JSON from AI response');
          }
        }
      }

      if (parsedFrames && Array.isArray(parsedFrames) && parsedFrames.length >= 3) {
        // Ensure exactly 5 frames
        const finalFrames = parsedFrames.slice(0, 5);
        const frames: StoryFrame[] = finalFrames.map((f, i) => ({
          id: `narrative_${i}_${Date.now()}`,
          title: f.title || `FRAME ${i + 1}`,
          prompt: f.prompt,
          imageUrl: null,
          status: 'idle' as const,
        }));
        setStoryboard(frames);
      } else {
        throw new Error('AI returned invalid script format');
      }
    } catch (e: any) {
      console.error('[ReelStudio] AI script generation failed, using smart fallback:', e);
      // Fallback to enhanced static templates if AI fails
      const fallbackShots = [
        { title: 'HOOK', prompt: `Extreme close-up of a striking detail in the EXACT same scene from the reference image. Theme: ${n}. Shallow depth of field, the kind of shot that makes you stop scrolling. Dramatic lighting, 8K macro photography` },
        { title: 'TENSION', prompt: `Mysterious medium shot from an unusual angle in the EXACT same scene from the reference image. Theme: ${n}. Same people, same environment. Create visual intrigue with dramatic shadows or silhouette framing. Cinematic composition` },
        { title: 'PAYOFF', prompt: `The hero shot — stunning full portrait of the main subject in the EXACT same scene from the reference image. Theme: ${n}. Same setting, same clothing. Slightly low angle, perfect golden hour-style lighting, magazine-quality photography` },
        { title: 'TWIST', prompt: `Unexpected over-the-shoulder or reflection shot in the EXACT same scene from the reference image. Theme: ${n}. Same people, same environment. A fresh perspective that reveals something new about the scene. Creative framing, cinematic color grade` },
        { title: 'CLOSER', prompt: `Wide cinematic closing shot of the EXACT same scene from the reference image. Theme: ${n}. Same people, same everything. The most beautiful angle — warm color grading, emotional composition that makes viewers want to save and share` },
      ];
      const frames: StoryFrame[] = fallbackShots.map((shot, i) => ({
        id: `narrative_${i}_${Date.now()}`,
        title: shot.title,
        prompt: shot.prompt,
        imageUrl: null,
        status: 'idle' as const,
      }));
      setStoryboard(frames);
    } finally {
      setIsGeneratingNarrative(false);
    }
  }, [sourceImage, ingredients, describeImage]);

  /* ── Create custom script from user-written frames ───────────── */
  const createCustomScript = useCallback((frames: { title: string; prompt: string }[]) => {
    const storyFrames: StoryFrame[] = frames.map((f, i) => ({
      id: `custom_${i}_${Date.now()}`,
      title: f.title || `Frame ${i + 1}`,
      prompt: f.prompt,
      imageUrl: null,
      status: 'idle' as const,
    }));
    setStoryboard(storyFrames);
  }, []);

  /* ── Shoot: generate images for each frame ───────────────────────── */
  const shootReel = useCallback(async () => {
    if (storyboard.length === 0 || !sourceImage) return;
    setIsShooting(true);
    setError(null);

    // Mark all frames as pending
    setStoryboard(prev => prev.map(f => ({ ...f, status: 'pending' as const })));

    // Build base images: source image + ingredient images
    const allBaseImages = [sourceImage, ...ingredients.map(ing => ing.imageDataUrl)];

    // Build ingredient context string for prompts
    const ingredientContext = ingredients.length > 0
      ? ` The scene must prominently feature these items: ${ingredients.map(ing => `"${ing.name}"`).join(', ')}. Use the provided reference photos of these items for accurate visual representation.`
      : '';

    // Generate frames in parallel (2 at a time to avoid rate limits)
    const CONCURRENCY = 2;
    const queue = [...storyboard];
    const results = new Map<string, string>();

    const processFrame = async (frame: StoryFrame) => {
      try {
        const enhancedPrompt = frame.prompt + ingredientContext;
        const urls = await generateImage({
          prompt: enhancedPrompt,
          model: 'gemini-3.1-flash-image-preview',
          aspectRatio: aspectRatio.value,
          baseImages: allBaseImages,
          saveToGallery: false,
        });
        if (urls && urls.length > 0) {
          results.set(frame.id, urls[0]);
          setStoryboard(prev => prev.map(f =>
            f.id === frame.id ? { ...f, imageUrl: urls[0], status: 'done' as const } : f
          ));
        } else {
          setStoryboard(prev => prev.map(f =>
            f.id === frame.id ? { ...f, status: 'error' as const } : f
          ));
        }
      } catch {
        setStoryboard(prev => prev.map(f =>
          f.id === frame.id ? { ...f, status: 'error' as const } : f
        ));
      }
    };

    // Process in batches of CONCURRENCY
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(processFrame));
    }

    setIsShooting(false);
  }, [storyboard, sourceImage, aspectRatio, ingredients]);

  /* ── Create video from frames (using canvas recording) ───────────── */
  const createVideo = useCallback(async () => {
    const readyFrames = storyboard.filter(f => f.status === 'done' && f.imageUrl);
    if (readyFrames.length < 2) return;

    setIsCreatingVideo(true);
    setError(null);

    try {
      const FRAME_DURATION = 1200; // ms per frame
      const WIDTH = aspectRatio.value === '9:16' ? 1080 : aspectRatio.value === '1:1' ? 1080 : 1920;
      const HEIGHT = aspectRatio.value === '9:16' ? 1920 : aspectRatio.value === '1:1' ? 1080 : 1080;

      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d')!;

      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm',
        videoBitsPerSecond: 8_000_000,
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      });

      // Pre-load all images
      const images = await Promise.all(readyFrames.map(f => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = f.imageUrl!;
        });
      }));

      recorder.start();

      // Render each frame for FRAME_DURATION
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        // Cover-fit the image
        const scale = Math.max(WIDTH / img.width, HEIGHT / img.height);
        const sw = WIDTH / scale;
        const sh = HEIGHT / scale;
        const sx = (img.width - sw) / 2;
        const sy = (img.height - sh) / 2;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, WIDTH, HEIGHT);

        // Hold for FRAME_DURATION by rendering frames at 30fps
        const frameCount = Math.ceil(FRAME_DURATION / (1000 / 30));
        for (let f = 0; f < frameCount; f++) {
          await new Promise(r => setTimeout(r, 1000 / 30));
          // Slight zoom effect for cinematic feel
          const progress = f / frameCount;
          const zoom = 1 + progress * 0.02;
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, WIDTH, HEIGHT);
          const zw = WIDTH / zoom;
          const zh = HEIGHT / zoom;
          const zsx = (img.width - zw / scale) / 2;
          const zsy = (img.height - zh / scale) / 2;
          ctx.drawImage(img, zsx, zsy, zw / scale, zh / scale, (WIDTH - zw) / 2, (HEIGHT - zh) / 2, zw, zh);
        }
      }

      recorder.stop();
      const blob = await done;

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `godseye-reel-${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || 'Failed to create video');
    } finally {
      setIsCreatingVideo(false);
    }
  }, [storyboard, aspectRatio]);

  /* ── Update frame prompt ───────────────────────────────────────── */
  const updateFramePrompt = useCallback((frameId: string, newPrompt: string) => {
    setStoryboard(prev => prev.map(f =>
      f.id === frameId ? { ...f, prompt: newPrompt } : f
    ));
  }, []);

  /* ── Regenerate a single frame ───────────────────────────────── */
  const regenerateFrame = useCallback(async (frameId: string) => {
    const frame = storyboard.find(f => f.id === frameId);
    if (!frame || !sourceImage) return;
    setIsRegenerating(frameId);
    setError(null);

    // Build base images: source image + ingredient images
    const allBaseImages = [sourceImage, ...ingredients.map(ing => ing.imageDataUrl)];
    const ingredientContext = ingredients.length > 0
      ? ` The scene must prominently feature these items: ${ingredients.map(ing => `"${ing.name}"`).join(', ')}. Use the provided reference photos of these items for accurate visual representation.`
      : '';

    try {
      setStoryboard(prev => prev.map(f =>
        f.id === frameId ? { ...f, status: 'pending' as const, imageUrl: null } : f
      ));
      const enhancedPrompt = frame.prompt + ingredientContext;
      const urls = await generateImage({
        prompt: enhancedPrompt,
        model: 'gemini-3.1-flash-image-preview',
        aspectRatio: aspectRatio.value,
        baseImages: allBaseImages,
        saveToGallery: false,
      });
      if (urls && urls.length > 0) {
        setStoryboard(prev => prev.map(f =>
          f.id === frameId ? { ...f, imageUrl: urls[0], status: 'done' as const } : f
        ));
      } else {
        setStoryboard(prev => prev.map(f =>
          f.id === frameId ? { ...f, status: 'error' as const } : f
        ));
      }
    } catch {
      setStoryboard(prev => prev.map(f =>
        f.id === frameId ? { ...f, status: 'error' as const } : f
      ));
    } finally {
      setIsRegenerating(null);
    }
  }, [storyboard, sourceImage, aspectRatio, ingredients]);

  /* ── Save all completed frames to Image Gallery ──────────────── */
  const saveAllToGallery = useCallback(async (userId: string) => {
    const doneFrames = storyboard.filter(f => f.status === 'done' && f.imageUrl);
    if (doneFrames.length === 0) return;
    setIsSavingToGallery(true);
    setError(null);
    try {
      for (const frame of doneFrames) {
        await saveToLocalGallery(
          frame.imageUrl!,
          `[Reel Studio] ${frame.title}: ${frame.prompt.slice(0, 100)}`,
          aspectRatio.value,
          'Reel Studio',
          userId,
        );
      }
    } catch (e: any) {
      setError(e.message || 'Failed to save to gallery');
    } finally {
      setIsSavingToGallery(false);
    }
  }, [storyboard, aspectRatio]);

  /* ── Ingredient management ────────────────────────────────────── */
  const addIngredient = useCallback((name: string, imageDataUrl: string) => {
    setIngredients(prev => [...prev, { id: `ing_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, imageDataUrl }]);
  }, []);

  const removeIngredient = useCallback((id: string) => {
    setIngredients(prev => prev.filter(ing => ing.id !== id));
  }, []);

  const updateIngredientName = useCallback((id: string, name: string) => {
    setIngredients(prev => prev.map(ing => ing.id === id ? { ...ing, name } : ing));
  }, []);

  /* ── Reset ───────────────────────────────────────────────────────── */
  const reset = useCallback(() => {
    setSourceImage(null);
    setStoryboard([]);
    setStorylineOptions([]);
    setSelectedStoryline(null);
    setActiveFrameIndex(0);
    setIsPlaying(false);
    setError(null);
    setIngredients([]);
  }, []);

  return (
    <ReelStudioCtx.Provider value={{
      sourceImage, setSourceImage, storyboard, aspectRatio, setAspectRatio,
      aspectOptions: ASPECT_OPTIONS,
      storylineOptions, selectedStoryline, isGeneratingOptions, generateStorylineOptions, selectStoryline,
      isGeneratingNarrative, generateFromNarrative,
      isScripting, generateScript, createCustomScript, isShooting, shootReel,
      activeFrameIndex, setActiveFrameIndex,
      isPlaying, setIsPlaying,
      isCreatingVideo, createVideo,
      updateFramePrompt, regenerateFrame, isRegenerating,
      ingredients, addIngredient, removeIngredient, updateIngredientName,
      saveAllToGallery, isSavingToGallery,
      reset, error,
    }}>
      {children}
    </ReelStudioCtx.Provider>
  );
};
