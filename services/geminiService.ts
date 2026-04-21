
// @google/genai Coding Guidelines
import { supabase } from '../services/supabaseClient';
import { GoogleGenAI } from '@google/genai';
import { saveToLocalGallery, triggerDownload } from './localStorageService';
import { smartCompress } from './imageCompressionService';

/**
 * GEMINI SERVICE (Secure Server-Side Proxy)
 * - API Key stays on server, never exposed to client
 * - Uses Vite middleware proxy for secure API calls
 * - No Resizing (Full 4K Quality)
 * - Direct Cloudinary Uploads
 */

// 1. Helper to Process & Save (local IndexedDB only — never Supabase)
async function resolveToBase64(uiUrl: string): Promise<string | null> {
  if (!uiUrl || typeof uiUrl !== 'string') return null;
  if (uiUrl.startsWith('data:')) return uiUrl;

  if (uiUrl.startsWith('blob:')) {
    try {
      const res = await fetch(uiUrl);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn('[GeminiService] Failed to resolve blob URL to base64', err);
      return null;
    }
  }

  if (uiUrl.startsWith('http://') || uiUrl.startsWith('https://')) {
    try {
      const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(uiUrl)}`);
      if (proxyRes.ok) {
        const json = await proxyRes.json();
        if (json.dataUrl) return json.dataUrl;
      }
    } catch (err) {
      console.warn('[GeminiService] Proxy fetch failed', err);
    }
  }

  return null;
}

async function processAndSave(base64Image: string, userId: string, prompt: string, _isByok: boolean, saveToGallery: boolean = true): Promise<string> {
  const inputDataUrl = base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`;
  if (saveToGallery) {
    await saveToLocalGallery(inputDataUrl, prompt, '1:1', 'gemini-edit', userId);
  }
  return inputDataUrl;
}

// Get API Key from environment
// Get API Key from environment (Build-time or Runtime)
function getApiKey(): string {
  // 1. Build-time env (Vite)
  const envKey = (import.meta as any).env.VITE_GEMINI_API_KEY;

  // 2. Runtime env (Injected by server.js into window)
  const runtimeKey = (window as any).__RUNTIME_CONFIG__?.VITE_GEMINI_API_KEY;

  // 3. User override
  const localKey = localStorage.getItem('user_gemini_key');

  const key = envKey || runtimeKey || localKey;

  if (!key) {
    console.error('[Gemini] API Key not found. Check VITE_GEMINI_API_KEY in .env or Cloud Run variables');
    // Don't throw immediately, let the call fail or prompt user, but for now throw as per original logic
    throw new Error("Missing API Key. Add VITE_GEMINI_API_KEY to .env");
  }

  return key;
}

// Helper to build API URL - ALWAYS use serverless function (no API key in browser)
function buildApiUrl(model: string): string {
  // Always use the API proxy endpoint
  // Locally: handled by dev-server.js on port 3002
  // Vercel: handled by serverless function at /api/gemini/[...path].ts
  // API key is read from process.env on the SERVER, never exposed to browser
  const apiPath = `models/${model}:generateContent`;
  const proxyUrl = `/api/gemini/${apiPath}`;

  console.log('[buildApiUrl] Using serverless proxy:', proxyUrl);

  return proxyUrl;
}

// --- MAIN EXPORTS ---

/**
 * EDIT IMAGE (Inpainting)
 */
export const editImage = async (
  image: string,
  mask: string,
  prompt: string,
  model: string,
  aspectRatio: string = '1:1',
  referenceImages: string[] = [],
  harmonize: boolean = false,
  /**
   * When true (default), the edited result is persisted to the local gallery
   * (IndexedDB). The Edit page passes `false` so iterative canvas edits don't
   * flood the gallery — users push a final result via the "Save to Gallery"
   * toolbar button instead.
   */
  saveToGallery: boolean = true
): Promise<string> => {
  try {
    console.log(`[Edit] Model: ${model}, Ratio: ${aspectRatio}, Refs: ${referenceImages.length}`);

    // A. Build Prompt - For editing, we need to be more specific
    let fullPrompt = `${prompt}. Edit the image according to the mask provided.`;
    if (harmonize) fullPrompt += " Ensure perfect lighting/color blending.";

    // B. Build Parts (Prompt + Input Images)
    const parts: any[] = [{ text: fullPrompt }];

    // Add Inputs (Img, Mask, Reference Images)
    const allImages = [image, mask, ...referenceImages];
    for (const b64 of allImages) {
      const resolvedDataUrl = await resolveToBase64(b64);
      if (!resolvedDataUrl) {
        console.warn('[Edit] Skipping invalid or unresolvable image data');
        continue;
      }

      // Compress if needed
      const processedB64 = await smartCompress(resolvedDataUrl);
      const mimeMatch = processedB64.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const clean = processedB64.replace(/^data:image\/\w+;base64,/, "");

      // Validate base64 format
      if (!/^[A-Za-z0-9+/=]+$/.test(clean)) {
        console.error('[Edit] Invalid base64 data detected');
        throw new Error('Invalid image data format');
      }
      parts.push({ inlineData: { mimeType, data: clean } });
    }

    // C. Use the model as-is, or default to Gemini 3 Pro if not specified
    const modelId = model.includes('gemini') ? model : 'gemini-3.1-flash-image-preview';

    // D. Build API URL (proxy in dev, direct in production) - EXACTLY like generateImage
    const apiUrl = buildApiUrl(modelId);
    console.log('[Edit] Calling API with model:', modelId, 'URL:', apiUrl.substring(0, 50) + '...');

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 0.4,
        imageConfig: {
          aspectRatio: aspectRatio || "1:1"
        }
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    console.log('[Edit] Request body:', JSON.stringify(requestBody).substring(0, 500) + '...');

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    console.log('[Edit] Response status:', response.status);

    if (!response.ok) {
      const err = await response.json();
      console.error('[Edit] Error response:', err);
      throw new Error(err.error?.message || response.statusText);
    }

    const data = await response.json();
    console.log('[Edit] Response data:', JSON.stringify(data).substring(0, 500) + '...');
    console.log('[Edit] Response structure:', {
      hasCandidates: !!data.candidates,
      candidatesLength: data.candidates?.length,
      firstCandidate: data.candidates?.[0] ? 'exists' : 'missing',
      hasContent: !!data.candidates?.[0]?.content,
      hasParts: !!data.candidates?.[0]?.content?.parts,
      partsLength: data.candidates?.[0]?.content?.parts?.length,
      firstPartKeys: data.candidates?.[0]?.content?.parts?.[0] ? Object.keys(data.candidates[0].content.parts[0]) : []
    });

    const resultB64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!resultB64) {
      console.error('[Edit] Full response for debugging:', JSON.stringify(data, null, 2));
      throw new Error("No image generated. Check console for full response.");
    }

    // D. Process & Save
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      return await processAndSave(resultB64, user.id, prompt, false, saveToGallery);
    }

    return `data:image/jpeg;base64,${resultB64}`; // Return base64 if no user

  } catch (error) {
    console.error("[Edit] Error:", error);
    throw error;
  }
};

/**
 * GENERATE IMAGE (Text-to-Image)
 */
export const generateImage = async ({
  prompt,
  model,
  aspectRatio = '1:1',
  quality = '4K',
  batchSize = 1,          // number of images to generate (maps to candidateCount)
  baseImages = [],
  userId = 'anonymous',
  saveToGallery = true,   // set false to skip IndexedDB (brand section)
  autoDownload = false,   // 🛑 Turned off per user request: explicitly downloaded or liked images only go for training.
  temperature,            // optional — pass 0.1 for brand generation to clamp hallucination
  ragContext = '',         // RAG context from brain training (injected by caller)
}: any): Promise<string[]> => {
  try {
    console.log(`[Generate] Model: ${model}, Ratio: ${aspectRatio}, User: ${userId}, RAG: ${ragContext ? 'yes' : 'no'}`);

    // A. Build Prompt — inject RAG context if available
    const fullPrompt = ragContext
      ? `${ragContext}\n\nGenerate: ${prompt}`
      : prompt;

    // B. Build Parts - images BEFORE text when references are present
    const imageParts: any[] = [];
    for (const img of baseImages) {
      const dataUrl = await resolveToBase64(img);
      if (!dataUrl) {
        console.warn('[Generate] Skipping invalid or unresolvable reference image');
        continue;
      }

      const processedB64 = await smartCompress(dataUrl);
      const mimeMatch = processedB64.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const clean = processedB64.replace(/^data:image\/\w+;base64,/, "");
      imageParts.push({ inlineData: { mimeType, data: clean } });
    }
    const parts: any[] = baseImages.length > 0
      ? [...imageParts, { text: fullPrompt }]
      : [{ text: fullPrompt }];

    // C. Use the model as-is, or default to Gemini 3.1 Flash if not specified
    const modelId = (model.includes('gemini') || model.includes('nano-banana')) ? model : 'gemini-3.1-flash-image-preview';

    // D. Build API URL (proxy in dev, direct in production)
    const apiUrl = buildApiUrl(modelId);
    console.log('[Generate] Calling API with model:', modelId, 'URL:', apiUrl.substring(0, 50) + '...');

    // Per official Google docs: generationConfig.imageConfig.imageSize
    // Values: "1K" (default), "2K", "4K" — uppercase K required, lowercase rejected
    const imageSizeMap: Record<string, string> = {
      '1K': '1K',
      '2K': '2K',
      '4K': '4K',
    };
    const imageSize = imageSizeMap[quality] || '1K';

    const generationConfig: any = {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: aspectRatio || "1:1",
        imageSize: imageSize,
      }
    };
    if (temperature !== undefined) generationConfig.temperature = temperature;

    const requestBody = {
      contents: [{ parts }],
      generationConfig,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      // Clone response to read it multiple times if needed
      const responseClone = response.clone();
      let errorMessage = `API Error (${response.status}): ${response.statusText}`;
      try {
        const err = await responseClone.json();
        errorMessage = err.error?.message || errorMessage;
        console.error('[Generate] API Error Response:', err);
      } catch (e) {
        try {
          const text = await response.text();
          console.error('[Generate] API Error Text:', text);
          errorMessage = text || errorMessage;
        } catch (textError) {
          console.error('[Generate] Could not read error response');
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();
    const allCandidates = data.candidates || [];
    console.log(`[Generate] API returned ${allCandidates.length} candidates, batchSize requested: ${batchSize}`);
    if (allCandidates.length > 0) {
      const partsCount = allCandidates[0]?.content?.parts?.length || 0;
      console.log(`[Generate] First candidate has ${partsCount} parts`);
    }
    if (allCandidates.length === 0) throw new Error("No image generated.");
    // Limit to requested batch size to avoid generating extra images and wasting tokens
    const candidates = allCandidates.slice(0, batchSize || 1);

    // D. Process Results (Local Storage + Auto Download)
    // Use the userId passed from the frontend to ensure sync
    const finalUrls: string[] = [];


    for (const cand of candidates) {
      const b64 = cand.content?.parts?.[0]?.inlineData?.data;
      if (b64) {
        const base64Str = `data:image/jpeg;base64,${b64}`;

        let displayUrl = base64Str;
        try {
          // Convert the massive base64 string directly into a Blob URL
          // This ensures the React UI never tries to diff or render megabytes of string data,
          // instantly fixing the UI hanging/freezing issues.
          const res = await fetch(base64Str);
          const blob = await res.blob();
          displayUrl = URL.createObjectURL(blob);
        } catch (err) {
          console.warn('[Generate] Failed to create blob URL, returning base64 fallback');
        }

        // 1. Auto-Download to User's Computer
        if (autoDownload) triggerDownload(displayUrl, prompt);

        // 2. Save to Browser IndexedDB for Gallery
        // (We pass base64Str so `saveToLocalGallery` can securely do its own Blob extraction)
        if (saveToGallery) await saveToLocalGallery(base64Str, prompt, aspectRatio, model, userId);

        finalUrls.push(displayUrl);
      }
    }

    // E. Deduct Credits (1 Credit per Image)
    if (userId && userId !== 'anonymous' && finalUrls.length > 0) {
      try {
        const cost = finalUrls.length * 1; // 1 Credit per image
        const { data: profile } = await supabase.from('profiles').select('credits').eq('id', userId).single();
        if (profile) {
          const newBalance = Math.max(0, (profile.credits || 0) - cost);
          await supabase.from('profiles').update({ credits: newBalance }).eq('id', userId);
          console.log(`[Credits] Deducted ${cost}. New Balance: ${newBalance}`);
        }
      } catch (err) {
        console.error('[Credits] Failed to deduct:', err);
      }
    }

    return finalUrls;

  } catch (error) {
    console.error("[Generate] Error:", error);
    throw error;
  }
};

/**
 * ANALYZE IMAGE TO TEXT (Vision → Text description)
 * Uses Gemini's multimodal text generation to describe an image in detail.
 */
export const analyzeImageToText = async ({
  prompt,
  imageDataUrl,
  model = 'gemini-2.5-flash',
}: {
  prompt: string;
  imageDataUrl: string;
  model?: string;
}): Promise<string> => {
  try {
    console.log(`[AnalyzeImage] Model: ${model}`);

    // Build image part
    const resolvedDataUrl = await resolveToBase64(imageDataUrl);
    if (!resolvedDataUrl) throw new Error('Failed to resolve image data');

    const processedB64 = await smartCompress(resolvedDataUrl);
    const mimeMatch = processedB64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const clean = processedB64.replace(/^data:image\/\w+;base64,/, "");

    const parts: any[] = [
      { inlineData: { mimeType, data: clean } },
      { text: prompt },
    ];

    const apiUrl = buildApiUrl(model);

    const requestBody = {
      contents: [{ parts }],
      generationConfig: {
        // TEXT modality — no image generation, just text analysis
        responseModalities: ["TEXT"],
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error (${response.status})`);
    }

    const data = await response.json();
    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) throw new Error('No text response from Gemini');

    return textContent;
  } catch (error) {
    console.error('[AnalyzeImage] Error:', error);
    throw error;
  }
};

/**
 * GENERATE VIDEO (Using Google Veo 3.1)
 * - Veo is an asynchronous (Long-Running) operation
 */
export const generateVideo = async (config: any): Promise<string> => {
  try {
    console.log('[Video] Starting generation with config:', config);
    const apiKey = getApiKey();
    const ai = new GoogleGenAI({ apiKey });

    // Map config to payload
    // Default to a model that works with the SDK. User's code didn't specify, but Veo is implied.
    // User requested Veo 3.1 explicitly.
    const model = config.model || 'veo-3.1-fast-generate-preview';

    // Construct payload for generateVideos
    const generateVideoPayload: any = {
      model: model,
      prompt: config.prompt,
      config: {
        numberOfVideos: 1,
        // Ensure resolution uses supported values e.g. '1280x720' or '1920x1080' or enum if typed, 
        // but SDK might take string. 
        resolution: config.resolution || "720p",
        aspectRatio: config.aspectRatio || "16:9",
      }
    };

    // Handle Image-to-Video
    if (config.startImage) {
      console.log('[Video] Adding start frame...');
      const clean = config.startImage.replace(/^data:image\/\w+;base64,/, "");
      // Need mime type. Assume jpeg if not known, or extract from base64 header
      let mimeType = "image/jpeg";
      const match = config.startImage.match(/^data:(image\/\w+);base64,/);
      if (match) mimeType = match[1];

      generateVideoPayload.image = {
        imageBytes: clean,
        mimeType: mimeType
      };
    }

    // Call the API
    console.log('[Video] Submitting request...', JSON.stringify(generateVideoPayload).substring(0, 200));

    let operation = await ai.models.generateVideos(generateVideoPayload);
    console.log('[Video] Operation started:', operation);

    // Polling Loop
    while (!operation.done) {
      // User used 10s wait
      await new Promise((resolve) => setTimeout(resolve, 10000));
      console.log('[Video] ...Generating...');
      operation = await ai.operations.getVideosOperation({ operation: operation });
    }

    // Process Result
    if (operation?.response) {
      const videos = operation.response.generatedVideos;
      if (!videos || videos.length === 0) {
        throw new Error('No videos were generated.');
      }

      const firstVideo = videos[0];
      if (!firstVideo?.video?.uri) {
        throw new Error('Generated video is missing a URI.');
      }

      let videoUri = firstVideo.video.uri;
      console.log('[Video] Generation complete. URI:', videoUri);

      // Fetch the video content
      // Logic: Use local proxy to fetch to avoid CORS and handle auth transparently if needed, 
      // OR use the Key extraction method if proxy isn't flexible enough.
      // Current system has a proxy at /api/gemini/ that appends the key.

      let fetchUrl = videoUri;

      // If it's a google API URL, we can try to route through our proxy
      if (videoUri.startsWith('https://generativelanguage.googleapis.com/v1beta/')) {
        fetchUrl = videoUri.replace('https://generativelanguage.googleapis.com/v1beta/', '/api/gemini/');
        console.log('[Video] Fetching via proxy:', fetchUrl);
        // Proxy appends key automatically
      } else {
        // Fallback to user's method: append key directly
        fetchUrl = `${videoUri}${videoUri.includes('?') ? '&' : '?'}key=${apiKey}`;
        console.log('[Video] Fetching directly with key...');
      }

      const res = await fetch(fetchUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch video: ${res.status} ${res.statusText}`);
      }

      const videoBlob = await res.blob();
      const objectUrl = URL.createObjectURL(videoBlob);
      console.log('[Video] Created Blob URL:', objectUrl);

      return objectUrl;

    } else {
      console.error('[Video] Operation failed or no response:', operation);
      throw new Error('Video generation operation failed.');
    }

  } catch (error: any) {
    console.error("[Video] Error:", error);
    // Enhance error message
    if (error.message?.includes('404')) {
      throw new Error("Model not found. Try a different model (e.g. veo-2.0-generate-uhd-preview). " + error.message);
    }
    throw error;
  }
};
