
import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { ControlBar } from './components/ControlBar';
import { AdminPanel } from './components/AdminPanel';
import { DrawEditor } from './components/DrawEditor';
import { ImageGallery } from './components/ImageGallery';
import { ExplorePage } from './components/ExplorePage';
import { HomePage } from './components/home/HomePage';
import { VideoPage } from './components/VideoPage';
import { EditPage } from './components/EditPage';
import { CharacterPage } from './components/CharacterPage';
import { AssistPage } from './components/AssistPage';
import { ProfilePage } from './components/ProfilePage';
import { CronJobsPage } from './components/CronJobsPage';
import { AgenticPage } from './components/AgenticPage';
import { ConnectorsPage } from './components/ConnectorsPage';
import { SpacesPage } from './components/spaces/SpacesPage';
import { BrandPage } from './components/brand/BrandPage';
import { FalVideoPage } from './components/fal-video/FalVideoPage';
import { VideoProjectProvider } from './context/VideoProjectContext';
import { AppMode, GeneratedAsset, GenerationConfig, ModelType, PerspectiveConfig, DEFAULT_PERSPECTIVE, buildPerspectiveText } from './types';
import { SAMPLE_IMAGES, MODELS } from './constants';
import { generateImage } from './services/geminiService';
import { generateFalImage } from './services/falService';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthPage } from './components/AuthPage';
import { OnboardingQuestionnaire } from './components/OnboardingQuestionnaire';
import { FeatureGate } from './components/FeatureGate';
import { BrainProvider, useBrain } from './context/BrainContext';
import { BrandProfile } from './types/brand.types';
import { AppsPage } from './components/apps/AppsPage';
import { ReelStudioApp } from './components/apps/ReelStudioApp';
import { ReelStudioProvider } from './context/ReelStudioContext';
import { ImageToPromptApp } from './components/apps/ImageToPromptApp';

// ─── Realism pipeline constants ───────────────────────────────────────────────
// Appended invisibly to every user prompt (skip for utility models like Topaz/Qwen).
const REALISM_SUFFIX =
  ', hyper-realistic photography, physically accurate, laws of physics apply, structural integrity, 8k resolution, raw photo';
// Injected as negative_prompt for models that support it.
const NEGATIVE_PROMPT =
  'floating, gravity-defying, mutated, surreal, distorted, impossible physics, bad anatomy, deformed, cartoon, illustration, vector';
// ──────────────────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.EXPLORE);
  const { session, loading, isAdmin, profile, refreshProfile } = useAuth(); // Use Global Admin State

  // const [isAdmin, setIsAdmin] = useState(true); // REMOVED local state
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [activeAppId, setActiveAppId] = useState<string | null>(null);
  const MAX_IMAGE_CONCURRENT = 4;
  const [activeImageGens, setActiveImageGens] = useState(0);
  const isGenerating = activeImageGens >= MAX_IMAGE_CONCURRENT;
  // Ref-based guard to prevent double-click triggering duplicate generations
  const generatingRef = useRef(false);

  // Reset active app when navigating away from Apps mode
  useEffect(() => { if (mode !== AppMode.APPS) setActiveAppId(null); }, [mode]);

  // ── Base + Delta edit-session state ──────────────────────────────────────────
  // Stores the original reference image so sequential edits always apply to the
  // same base pixels (preventing VAE / latent-space quality degradation).
  const [sessionBaseImage, setSessionBaseImage] = useState<string | null>(null);
  const [sessionPromptChain, setSessionPromptChain] = useState<string[]>([]);
  // ─────────────────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [videoReferenceImageUrl, setVideoReferenceImageUrl] = useState<string | null>(null);

  // Global Brand Context State
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const { setProjectTag, getRAGContext, isConnected: brainConnected } = useBrain();

  // Theme Management
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // App State
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>([]);

  // Fetch Generations on Load
  useEffect(() => {
    // ALWAYS load local gallery, regardless of Auth (Local First)
    console.log("🟢 APP: Fetching Local Gallery...");
    const loadGen = async () => {
      try {
        const { getLocalGallery } = await import('./services/localStorageService');
        // Pass User ID to filter gallery. If user is null, it might return anonymous or nothing.
        const userId = session?.user?.id;
        const gens = await getLocalGallery(userId);
        console.log("🟢 APP: Local Generations fetched:", gens.length, "for user:", userId);

        const dbAssets: GeneratedAsset[] = gens.map(g => ({
          id: g.id,
          url: g.url,
          prompt: g.prompt || '',
          model: g.model || 'Unknown',
          aspectRatio: g.aspectRatio || '1:1',
          createdAt: g.timestamp
        }));

        // MERGE, never replace — prevents the "blip" race condition where a
        // Supabase token-refresh triggers loadGen while a fresh generation is
        // already sitting in React state but not yet flushed to IndexedDB.
        setGeneratedAssets(prev => {
          const dbIds = new Set(dbAssets.map(a => a.id));
          // Keep any in-memory assets that aren't in DB yet (skeleton cards,
          // just-generated images whose save is still in flight, etc.)
          const inFlightAssets = prev.filter(a => !dbIds.has(a.id));
          return [...dbAssets, ...inFlightAssets];
        });
      } catch (err) {
        console.error("🔴 APP: Local Fetch Error:", err);
      }
    };

    // Load User Brands
    const loadBrands = async () => {
      try {
        const { getAllLocalBrandProfiles } = await import('./services/localStorageService');
        const userId = session?.user?.id;
        if (userId) {
          const userBrands = await getAllLocalBrandProfiles(userId);
          setBrands(userBrands);
        }
      } catch (err) {
        console.error("🔴 APP: Load Brands Error:", err);
      }
    };

    loadGen();
    loadBrands();
  }, [session]); // Reload if session changes (optional, but good trigger)

  // Refresh gallery when switching to IMAGE tab (picks up chat-generated images)
  useEffect(() => {
    if (mode === AppMode.IMAGE) {
      const refreshGallery = async () => {
        try {
          const { getLocalGallery } = await import('./services/localStorageService');
          const userId = session?.user?.id;
          const gens = await getLocalGallery(userId);
          const assets: GeneratedAsset[] = gens.map(g => ({
            id: g.id,
            url: g.url,
            prompt: g.prompt || '',
            model: g.model || 'Unknown',
            aspectRatio: g.aspectRatio || '1:1',
            createdAt: g.timestamp
          }));
          setGeneratedAssets(assets);
        } catch (err) {
          console.error('[App] Gallery refresh error:', err);
        }
      };
      refreshGallery();
    }
  }, [mode, session]);

  // Check for auto-paste prompt from lightbox
  useEffect(() => {
    const autoPrompt = localStorage.getItem('klint_auto_prompt');
    if (autoPrompt && mode === AppMode.IMAGE) {
      setConfig(prev => ({ ...prev, prompt: autoPrompt }));
      localStorage.removeItem('klint_auto_prompt');
    }
  }, [mode]);

  const [config, setConfig] = useState<GenerationConfig>({
    model: ModelType.NANO_BANANA_2,
    aspectRatio: '16:9',
    quality: '1K',
    batchSize: 1,
    prompt: ''
  });

  const [inputImages, setInputImages] = useState<string[]>([]);
  const [perspective, setPerspective] = useState<PerspectiveConfig>(DEFAULT_PERSPECTIVE);

  // Auto-reset aspect ratio & batch size when switching models if current selection is unsupported
  useEffect(() => {
    const modelDef = MODELS.find(m => m.id === config.model);
    if (!modelDef) return;

    const updates: Partial<GenerationConfig> = {};

    // Check aspect ratio
    if (modelDef.supportedAspectRatios !== undefined) {
      if (modelDef.supportedAspectRatios.length === 0) {
        // Model has no aspect ratio (Topaz, Qwen) — leave as-is, it won't be sent
      } else if (!modelDef.supportedAspectRatios.includes(config.aspectRatio)) {
        updates.aspectRatio = modelDef.supportedAspectRatios[0] || '1:1';
      }
    }

    // Clamp batch size
    const maxBatch = modelDef.maxBatchSize ?? 4;
    if (maxBatch === 0 && config.batchSize !== 1) {
      updates.batchSize = 1;
    } else if (maxBatch > 0 && config.batchSize > maxBatch) {
      updates.batchSize = maxBatch;
    }

    if (Object.keys(updates).length > 0) {
      setConfig(prev => ({ ...prev, ...updates }));
    }
  }, [config.model]);

  const handleGenerate = async () => {
    if (generatingRef.current) return; // Block duplicate calls
    if (!config.prompt && config.model !== 'fal-ai/qwen-image-layered') return;
    if (config.model === 'fal-ai/qwen-image-layered' && inputImages.length === 0) {
      alert('Qwen Layered requires at least one reference image. Add an image using the + button.');
      return;
    }
    if (activeImageGens >= MAX_IMAGE_CONCURRENT) {
      alert(`Max ${MAX_IMAGE_CONCURRENT} concurrent image generations. Wait for one to finish.`);
      return;
    }
    generatingRef.current = true;

    // Capture current values before clearing — unblock input immediately
    const capturedPrompt = config.prompt;
    const capturedImages = [...inputImages];
    const capturedModel = config.model;
    const capturedAspect = config.aspectRatio;
    const capturedQuality = config.quality;
    const capturedBatch = config.batchSize;
    // Capture edit-session state (avoid stale closure)
    const capturedBaseImage = sessionBaseImage;
    const capturedPromptChain = [...sessionPromptChain];

    // Clear prompt immediately so user can type the next edit
    setConfig(prev => ({ ...prev, prompt: '' }));
    // Keep the reference image in the dock while an edit chain is active so the
    // user can see which base they are editing from.  Only clear when there is
    // no image (pure text-to-image) or when a brand-new image was just added.
    if (capturedImages.length === 0) {
      setInputImages([]);
    }

    // Inject skeleton loading cards
    const skeletonIds = Array.from({ length: capturedBatch || 1 }, () => crypto.randomUUID());
    const skeletonAssets: GeneratedAsset[] = skeletonIds.map(id => ({
      id,
      url: '',
      prompt: capturedPrompt,
      model: capturedModel,
      aspectRatio: capturedAspect,
      createdAt: Date.now(),
      loading: true,
    }));
    setGeneratedAssets(prev => [...skeletonAssets, ...prev]);

    setActiveImageGens(prev => prev + 1);

    // ── Base + Delta: update edit session ──────────────────────────────────────
    if (capturedImages.length > 0) {
      if (!capturedBaseImage || capturedImages[0] !== capturedBaseImage) {
        // New reference image → start a fresh edit chain
        setSessionBaseImage(capturedImages[0]);
        setSessionPromptChain([capturedPrompt]);
      } else {
        // Same base image → extend the prompt chain
        setSessionPromptChain(prev => [...prev, capturedPrompt]);
      }
    } else {
      // No image input → clear any active chain
      setSessionBaseImage(null);
      setSessionPromptChain([]);
    }

    // ── Build combined prompt (Base+Delta) + realism suffix ───────────────────
    // If this is a continuation of an edit chain, prepend all prior edit prompts
    // so the model receives the full cumulative intent against the original image.
    const isUtilityModel =
      capturedModel === ModelType.TOPAZ || capturedModel === ModelType.QWEN_LAYERED;

    let combinedPrompt = capturedPrompt;
    if (
      capturedImages.length > 0 &&
      capturedBaseImage &&
      capturedImages[0] === capturedBaseImage &&
      capturedPromptChain.length > 0
    ) {
      combinedPrompt = [...capturedPromptChain, capturedPrompt].join(', ');
    }

    // Append invisible realism suffix (skipped for Topaz upscaler / Qwen Layered)
    const realisticPrompt = isUtilityModel
      ? combinedPrompt
      : `${combinedPrompt}${REALISM_SUFFIX}`;

    // Inject perspective text if set
    const perspText = buildPerspectiveText(perspective);
    let finalPrompt = perspText ? `${realisticPrompt}, ${perspText}` : realisticPrompt;

    // Phase 4.5: Global Brand Context Injection
    if (activeBrandId) {
      const activeBrand = brands.find(b => b.id === activeBrandId);
      if (activeBrand) {
        const dna = activeBrand.visual_style_rules || activeBrand.aesthetic;
        if (dna) {
          console.log(`[Brand Injector] Injecting DNA for ${activeBrand.name}`);
          finalPrompt = `${finalPrompt}\n\nCRITICAL BRAND GUIDELINES (DO NOT IGNORE):\n${dna}`;
        }
      }
    }

    try {
      let imageUrls: string[] = [];

      if (capturedModel.startsWith('fal-ai/')) {
        // fal.ai model path — build model-specific input
        let falInput: Record<string, any>;
        // May be overridden below to switch a text-to-image endpoint to its
        // image-to-image counterpart when the user uploads a reference image.
        let effectiveModelId = capturedModel;

        if (capturedModel === ModelType.QWEN_LAYERED) {
          // Qwen Layered requires a reference image and specific params
          falInput = {
            ...(capturedImages[0] ? { image_url: capturedImages[0] } : {}),
            ...(finalPrompt ? { prompt: finalPrompt } : {}),
            num_layers: 4,
            num_inference_steps: 28,
            guidance_scale: 7.5,
            output_format: 'png',
          };
        } else if (capturedModel === ModelType.TOPAZ) {
          // Topaz upscaler — needs image_url, no prompt
          if (!capturedImages[0]) throw new Error('Topaz upscaler requires an input image.');
          falInput = {
            image_url: capturedImages[0],
            model: 'Standard V2',
            upscale_factor: 2,
            output_format: 'png',
            face_enhancement: true,
          };
        } else if (capturedModel === ModelType.REVE) {
          // Reve uses aspect_ratio string (not image_size), num_images
          const reveRatioMap: Record<string, string> = {
            '1:1': '1:1', '16:9': '16:9', '9:16': '9:16',
            '4:3': '4:3', '3:4': '3:4', '3:2': '3:2', '2:3': '2:3',
            '21:9': '16:9', '9:21': '9:16', '4:5': '3:4',
          };
          falInput = {
            prompt: finalPrompt,
            aspect_ratio: reveRatioMap[capturedAspect] || '3:2',
            num_images: capturedBatch || 1,
            output_format: 'png',
            negative_prompt: NEGATIVE_PROMPT,
          };
        } else if (capturedModel === ModelType.FLUX2) {
          // FLUX.2 Ultra uses aspect_ratio string
          const fluxRatioMap: Record<string, string> = {
            '1:1': '1:1', '16:9': '16:9', '9:16': '9:16',
            '4:3': '4:3', '3:4': '3:4', '21:9': '21:9', '9:21': '9:21',
            '3:2': '3:2', '2:3': '2:3', '4:5': '3:4',
          };
          falInput = {
            prompt: finalPrompt,
            aspect_ratio: fluxRatioMap[capturedAspect] || '16:9',
            num_images: capturedBatch || 1,
            negative_prompt: NEGATIVE_PROMPT,
            // image_prompt_strength 0.75 = low denoising (~0.25) → preserves
            // original pixel quality for the Base+Delta edit-chain approach.
            ...(capturedImages[0] ? { image_url: capturedImages[0], image_prompt_strength: 0.75 } : {}),
          };
        } else if (capturedModel === ModelType.GPT_IMAGE_15 || capturedModel === ModelType.GPT_IMAGE) {
          // GPT Image 1.5 & 1 use fixed pixel-size strings
          const gptSizeMap: Record<string, string> = {
            '1:1': '1024x1024',
            '16:9': '1536x1024',
            '9:16': '1024x1536',
            '4:3': '1536x1024',
            '3:4': '1024x1536',
            '21:9': '1536x1024',
            '9:21': '1024x1536',
            '3:2': '1536x1024',
            '2:3': '1024x1536',
            '4:5': '1024x1536',
          };
          const gptSize = gptSizeMap[capturedAspect] || '1024x1024';

          if (capturedImages[0] && capturedModel === ModelType.GPT_IMAGE) {
            // GPT Image 1 with reference → dedicated /edit endpoint
            // All fal.ai /edit endpoints require image_urls (plural, array)
            effectiveModelId = 'fal-ai/gpt-image-1/edit';
            falInput = {
              prompt: finalPrompt,
              image_urls: [capturedImages[0]],
              image_size: gptSize,
              num_images: capturedBatch || 1,
              quality: 'high',
            };
          } else if (capturedImages[0] && capturedModel === ModelType.GPT_IMAGE_15) {
            // GPT Image 1.5 with reference → dedicated /edit endpoint
            effectiveModelId = 'fal-ai/gpt-image-1.5/edit';
            falInput = {
              prompt: finalPrompt,
              image_urls: [capturedImages[0]],
              image_size: gptSize,
              num_images: capturedBatch || 1,
              quality: 'high',
            };
          } else {
            // No reference image — pure text-to-image
            const defaultSize = capturedModel === ModelType.GPT_IMAGE_15 ? '1024x1024' : 'auto';
            falInput = {
              prompt: finalPrompt,
              image_size: gptSizeMap[capturedAspect] || defaultSize,
              num_images: capturedBatch || 1,
              quality: 'high',
            };
          }
        } else {
          // Generic fal.ai image model (Seedream v3/v4/v4.5, Z-Image, etc.)
          const falSizeMap: Record<string, string> = {
            '1:1': 'square',
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
            '4:3': 'landscape_4_3',
            '3:4': 'portrait_4_3',
            '21:9': 'landscape_16_9',
            '9:21': 'portrait_16_9',
            '3:2': 'landscape_4_3',
            '2:3': 'portrait_4_3',
            '4:5': 'portrait_4_3',
          };
          const falSize = falSizeMap[capturedAspect] || 'landscape_16_9';

          if (capturedImages[0] && capturedModel.endsWith('/text-to-image')) {
            // The /text-to-image endpoint ignores image_url entirely.
            // Switch to the /edit sibling endpoint which is the correct image-to-image path.
            effectiveModelId = capturedModel.replace('/text-to-image', '/edit');
            falInput = {
              prompt: finalPrompt,
              // Seedream /edit requires image_urls (plural, array) — NOT image_url
              image_urls: [capturedImages[0]],
              image_size: falSize,
              num_images: capturedBatch || 1,
              negative_prompt: NEGATIVE_PROMPT,
              // strength: how strongly the output deviates from the source image.
              // 0.75 = significant edit while preserving overall structure.
              strength: 0.75,
            };
          } else {
            // No reference image, or model doesn't follow /text-to-image naming
            falInput = {
              prompt: finalPrompt,
              image_size: falSize,
              num_images: capturedBatch || 1,
              negative_prompt: NEGATIVE_PROMPT,
              ...(capturedImages[0] ? { image_url: capturedImages[0] } : {}),
            };
          }
        }

        imageUrls = await generateFalImage({
          modelId: effectiveModelId,
          input: falInput,
        });
      } else {
        // Gemini path — inject RAG context from brain training
        let ragContext = '';
        if (brainConnected) {
          try {
            ragContext = await getRAGContext(capturedPrompt, 5);
          } catch (e) {
            console.warn('[App] RAG context retrieval failed, generating without context');
          }
        }

        imageUrls = await generateImage({
          prompt: finalPrompt,
          model: capturedModel,
          aspectRatio: capturedAspect,
          quality: capturedQuality,
          batchSize: capturedBatch,
          baseImages: capturedImages.length > 0 ? capturedImages : undefined,
          userId: session?.user?.id,
          saveToGallery: false, // App.tsx handles its own save via saveGeneratedAsset below
          ragContext,
        });
      }

      // For Qwen Layered: group all layer URLs into one asset
      let newAssets: GeneratedAsset[];
      if (capturedModel === 'fal-ai/qwen-image-layered' && imageUrls.length > 1) {
        newAssets = [{
          id: crypto.randomUUID(),
          url: imageUrls[0],
          prompt: capturedPrompt,
          model: capturedModel,
          aspectRatio: capturedAspect,
          createdAt: Date.now(),
          layers: imageUrls,
        }];
      } else {
        newAssets = imageUrls.map(url => ({
          id: crypto.randomUUID(),
          url,
          prompt: capturedPrompt,
          model: capturedModel,
          aspectRatio: capturedAspect,
          createdAt: Date.now()
        }));
      }

      // ── Persist to IndexedDB immediately, before touching React state ────────
      // Using saveGeneratedAsset: Phase 1 writes the URL atomically (no CORS
      // needed, no remapping). Phase 2 upgrades to Blob in the background.
      // We fire all saves in parallel then update state once — this guarantees
      // the DB record exists before loadGen could ever see a stale snapshot.
      const { saveGeneratedAsset } = await import('./services/localStorageService');
      await Promise.all(
        newAssets.map(asset =>
          saveGeneratedAsset(
            asset.id,
            asset.url,
            capturedPrompt,
            capturedAspect,
            capturedModel,
            session?.user?.id || 'anonymous'
          ).catch(err =>
            console.warn('[Gallery] Persistence failed for asset', asset.id, err)
          )
        )
      );

      // Replace skeleton placeholders with the new assets (IDs unchanged)
      setGeneratedAssets(prev => {
        const withoutSkeletons = prev.filter(a => !skeletonIds.includes(a.id));
        return [...newAssets, ...withoutSkeletons];
      });
    } catch (error) {
      console.error("Generation failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Generation failed: ${msg}`);
      // Remove skeleton placeholders on error
      setGeneratedAssets(prev => prev.filter(a => !skeletonIds.includes(a.id)));
    } finally {
      setActiveImageGens(prev => Math.max(0, prev - 1));
      generatingRef.current = false;
    }
  };

  const handleAssetGeneratedFromEdit = (url: string, prompt: string) => {
    const newAsset: GeneratedAsset = {
      id: Date.now().toString(),
      url: url,
      prompt: prompt,
      model: "Gemini 3.0 Pro (Edit)",
      aspectRatio: "Custom",
      createdAt: Date.now()
    };
    setGeneratedAssets(prev => [newAsset, ...prev]);
  };

  const handleUseSketch = (base64: string) => {
    const dataUri = `data:image/png;base64,${base64}`;
    setInputImages(prev => [...prev, dataUri]);
    setIsDrawMode(false);
    if (!config.prompt) setConfig(prev => ({ ...prev, prompt: "A drawing of..." }));
  };

  const handleEditImage = (url: string) => {
    setEditingImageUrl(url);
    setMode(AppMode.EDIT);
  };

  const handleToVideo = (url: string) => {
    setVideoReferenceImageUrl(url);
    setMode(AppMode.VIDEO);
  };

  const handleDeleteAsset = async (id: string, url: string) => {
    if (!confirm("Are you sure you want to delete this image? This cannot be undone.")) return;

    // Optimistic Update
    setGeneratedAssets(prev => prev.filter(asset => asset.id !== id));

    try {
      // Local Deletion
      const { deleteLocalImage } = await import('./services/localStorageService');
      await deleteLocalImage(id);

      setGeneratedAssets(prev => prev.filter(a => a.id !== id));
      console.log("Deleted local asset:", id);
    } catch (err) {
      console.error("Delete failed", err);
    }
  };

  // const { session, loading } = useAuth(); // Removed redundant call

  if (loading) {
    return (
      <div className="h-screen w-full bg-bg flex items-center justify-center text-text-primary">
        Loading Studio...
      </div>
    );
  }

  if (!session) {
    return <AuthPage onLogin={() => { }} />;
  }

  // Onboarding gate — show questionnaire for first-time users
  const onboardingDoneLocal = session?.user?.id ? localStorage.getItem(`godseye_onboarding_done_${session.user.id}`) === 'true' : false;
  if (session && profile && profile.onboarding_completed !== true && !onboardingDoneLocal) {
    return <OnboardingQuestionnaire userId={session.user.id} onComplete={refreshProfile} />;
  }

  return (
    <div className="min-h-screen text-text-primary font-sans selection:bg-brand selection:text-bg overflow-hidden transition-colors duration-300">

      <Header
        currentMode={mode}
        setMode={setMode}
        theme={theme}
        toggleTheme={toggleTheme}
        isAdmin={isAdmin}
      />

      <main className="relative z-10 h-screen pt-0 overflow-hidden">
        {mode === AppMode.ADMIN ? (
          isAdmin ? (
            <div className="h-full overflow-y-auto"><AdminPanel /></div>
          ) : (
            <div className="h-full flex items-center justify-center text-neutral-500">Access Denied</div>
          )
        ) : null}

        {/* HomePage stays mounted to preserve state (greeting, conversations) across tab switches */}
        <div className="h-full overflow-hidden" style={{ display: mode === AppMode.EXPLORE ? 'block' : 'none' }}>
          <HomePage onNavigate={setMode} />
        </div>

        {mode === AppMode.VIDEO ? (
          <FeatureGate feature="video">
            <VideoProjectProvider>
              <FalVideoPage initialImage={videoReferenceImageUrl || undefined} />
            </VideoProjectProvider>
          </FeatureGate>
        ) : mode === AppMode.EDIT ? (
          <EditPage
            key={editingImageUrl || 'default'}
            initialImage={editingImageUrl}
            onAssetGenerated={handleAssetGeneratedFromEdit}
          />
        ) : mode === AppMode.CHARACTER ? (
          <div className="h-full overflow-y-auto"><CharacterPage onUseCharacter={(char) => {
            setInputImages(char.images.slice(0, 3));
            setMode(AppMode.IMAGE);
          }} /></div>
        ) : mode === AppMode.ASSIST ? (
          <div className="h-full flex flex-col"><AssistPage /></div>
        ) : mode === AppMode.SPACES ? (
          <FeatureGate feature="spaces">
            <SpacesPage />
          </FeatureGate>
        ) : mode === AppMode.APPS ? (
          activeAppId === 'reel-studio' ? (
            <ReelStudioProvider>
              <ReelStudioApp onBack={() => setActiveAppId(null)} />
            </ReelStudioProvider>
          ) : activeAppId === 'image-to-prompt' ? (
            <ImageToPromptApp
              onBack={() => setActiveAppId(null)}
              onUseInImages={(prompt) => {
                setConfig(prev => ({ ...prev, prompt }));
                setMode(AppMode.IMAGE);
                setActiveAppId(null);
              }}
            />
          ) : (
            <AppsPage onOpenApp={(appId) => setActiveAppId(appId)} />
          )
        ) : mode === AppMode.BRAND ? (
          <BrandPage />
        ) : mode === AppMode.COMMUNITY ? (
          <div className="h-full flex items-center justify-center opacity-50"><h1 className="text-2xl font-medium">Community is landing shortly</h1></div>
        ) : mode === 'PROFILE' ? ( // Hidden mode for Profile
          <div className="h-full overflow-y-auto"><ProfilePage /></div>
        ) : mode === 'CRON_JOBS' || mode === AppMode.CRON_JOBS ? (
          <CronJobsPage />
        ) : mode === AppMode.AGENTIC || mode === 'agentic' ? (
          <AgenticPage />
        ) : mode === AppMode.CONNECTORS || mode === 'connectors' ? (
          <ConnectorsPage />
        ) : mode === AppMode.EXPLORE ? (
          null
        ) : (
          <div className="h-full overflow-y-auto">
            <ImageGallery
              assets={generatedAssets}
              onEdit={handleEditImage}
              onDelete={handleDeleteAsset}
              onToVideo={handleToVideo}
              onAssetsUpdated={async () => {
                // Reload gallery after sync
                const { getLocalGallery } = await import('./services/localStorageService');
                const userId = session?.user?.id;
                const gens = await getLocalGallery(userId);
                const assets: GeneratedAsset[] = gens.map(g => ({
                  id: g.id,
                  url: g.url,
                  prompt: g.prompt || '',
                  model: g.model || 'Unknown',
                  aspectRatio: g.aspectRatio || '1:1',
                  createdAt: g.timestamp
                }));
                setGeneratedAssets(assets);
              }}
            />
          </div>
        )}
      </main>

      {mode === AppMode.IMAGE && !isDrawMode && (
        <ControlBar
          config={config}
          setConfig={setConfig}
          onGenerate={handleGenerate}
          onEnterDrawMode={() => setIsDrawMode(true)}
          isGenerating={isGenerating}
          inputImages={inputImages}
          setInputImages={setInputImages}
          perspective={perspective}
          setPerspective={setPerspective}
          brands={brands}
          activeBrandId={activeBrandId}
          onSwitchBrand={(id) => {
            setActiveBrandId(id);
            // Sync with Local Brain instantly - routes likes/downloads to folder
            if (id) {
              const brand = brands.find(b => b.id === id);
              if (brand) setProjectTag(brand.name);
            } else {
              setProjectTag('Default_Project');
            }
          }}
        />
      )}

      {isDrawMode && (
        <DrawEditor
          onClose={() => setIsDrawMode(false)}
          onUseSketch={handleUseSketch}
        />
      )}



    </div>
  );
};

const AppWithAuth: React.FC = () => {
  return (
    <AuthProvider>
      <BrainProvider>
        <App />
      </BrainProvider>
    </AuthProvider>
  );
};

export default AppWithAuth;
