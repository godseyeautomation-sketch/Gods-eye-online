import { supabase } from './supabaseClient';
import { smartCompress } from './imageCompressionService';
import { BrandProfile, BrandDNA, BrandProduct, ContentSlot, ContentBrief, ContentFormat } from '../types/brand.types';
import {
  saveSlotImage, getSlotImage,
  getLocalBrandProfile, getAllLocalBrandProfiles, saveLocalBrandProfile, deleteLocalBrandProfile,
  getLocalSlotsForMonth, upsertLocalSlot
} from './localStorageService';

const IDB_PREFIX = 'idb:';

function slotImageKey(brandId: string, slotDate: string, format: string): string {
  return `slot_${brandId}_${slotDate}_${format}`;
}

async function hydrateSlots(slots: ContentSlot[]): Promise<ContentSlot[]> {
  return Promise.all(slots.map(async (slot) => {
    const raw = slot as any;

    // ── Strategy 1: Inline Blob (new approach — most reliable) ──
    if (raw._image_blob instanceof Blob) {
      return { ...slot, generated_image: URL.createObjectURL(raw._image_blob) };
    }

    // ── Strategy 2: Already a displayable URL (http/https/data:) ──
    if (slot.generated_image?.startsWith('http') || slot.generated_image?.startsWith('data:')) {
      return slot;
    }

    // ── Strategy 3: Legacy idb: key — try slot_images store ──
    if (slot.generated_image?.startsWith(IDB_PREFIX)) {
      const key = slot.generated_image.slice(IDB_PREFIX.length);
      const dataUrl = await getSlotImage(key);
      if (dataUrl) return { ...slot, generated_image: dataUrl };
    }

    // ── Strategy 4: Expired blob: URL or broken idb: — image is lost ──
    if (slot.generated_image && slot.generated_image !== '__blob__') {
      // Mark as null so UI shows recovery option
      return { ...slot, generated_image: null };
    }

    // __blob__ marker without actual blob = broken record
    if (slot.generated_image === '__blob__') {
      return { ...slot, generated_image: null };
    }

    return slot;
  }));
}

// ── Product Image Local Storage ────────────────────────────────────────────
// Product images are never stored in the database — they live in localStorage
// and are passed directly to Gemini as the first reference image during generation.
// Supabase only stores { id, name, imageDataUrl } where imageDataUrl is either:
//   - An HTTP URL (for scraped images — short, fine in DB)
//   - "local:{id}" (marker meaning "load from localStorage")

const PRODUCT_IMAGES_KEY = 'klint_product_images';

export function saveProductImages(products: Array<{ id: string; imageDataUrl: string }>): void {
  const existing = loadAllProductImages();
  for (const p of products) {
    if (p.imageDataUrl.startsWith('data:')) {
      existing[p.id] = p.imageDataUrl;
    }
  }
  try { localStorage.setItem(PRODUCT_IMAGES_KEY, JSON.stringify(existing)); } catch { }
}

export function loadAllProductImages(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PRODUCT_IMAGES_KEY) || '{}'); } catch { return {}; }
}

export function clearProductImages(): void {
  try { localStorage.removeItem(PRODUCT_IMAGES_KEY); } catch { }
}

/** Hydrate products from Supabase with their images from localStorage.
 *  Call this after loading a brand profile — returns products with imageDataUrl populated. */
export function hydrateProductImages(products: Array<{ id: string; name: string; imageDataUrl: string }>): Array<{ id: string; name: string; imageDataUrl: string }> {
  const store = loadAllProductImages();
  return products.map(p => ({
    ...p,
    imageDataUrl: p.imageDataUrl.startsWith('local:') ? (store[p.id] || '') : p.imageDataUrl,
  }));
}

// ── Website DNA Scanner ────────────────────────────────────────────────────

export const scanWebsiteForBrandDNA = async (websiteUrl: string): Promise<BrandDNA> => {
  // Step 1: Real website scrape — CSS colors, fonts, classified images
  let scrapedLogoUrl = '';
  let scrapedImages: string[] = [];
  let scrapedProductImages: string[] = [];
  let scrapedLifestyleImages: string[] = [];
  let scrapedCssColors: string[] = [];
  let scrapedCssFonts: string[] = [];
  let scrapedDetectedProducts: Array<{ name: string; imageUrl: string }> = [];

  try {
    const scrapeRes = await fetch(`/api/scrape-brand?url=${encodeURIComponent(websiteUrl)}`);
    if (scrapeRes.ok) {
      const scraped = await scrapeRes.json();
      scrapedLogoUrl = scraped.logoUrl || '';
      scrapedImages = scraped.images || [];
      scrapedProductImages = scraped.productImages || [];
      scrapedLifestyleImages = scraped.lifestyleImages || [];
      scrapedCssColors = scraped.cssColors || [];
      scrapedCssFonts = scraped.cssFonts || [];
      scrapedDetectedProducts = scraped.detectedProducts || [];
      console.log('[brandDNA] Scraped logo:', scrapedLogoUrl, '| product:', scrapedProductImages.length, '| lifestyle:', scrapedLifestyleImages.length, '| named:', scrapedDetectedProducts.length, '| colors:', scrapedCssColors.length, '| fonts:', scrapedCssFonts.length);
    }
  } catch (err) {
    console.warn('[brandDNA] Scrape failed, continuing with Gemini only:', err);
  }

  // Step 2: Gemini text analysis — with real CSS data as ground truth
  const cssColorNote = scrapedCssColors.length > 0
    ? `GROUND TRUTH — actual hex colors extracted from the website's CSS: ${scrapedCssColors.join(', ')}. Use EXACTLY these colors for the "colors" array (pick the 5 most prominent). Do NOT invent colors.`
    : 'Colors: infer from the brand\'s well-known visual identity.';
  const cssFontNote = scrapedCssFonts.length > 0
    ? `GROUND TRUTH — actual font-family names extracted from the website's CSS: ${scrapedCssFonts.join(', ')}. Use EXACTLY these for the "fonts" array. Do NOT invent font names.`
    : 'Fonts: identify the primary and secondary typefaces the brand uses.';

  const prompt = `You are a brand analyst AI. Analyze the brand at URL: ${websiteUrl}

${cssColorNote}
${cssFontNote}

Extract the following brand signals and return ONLY valid JSON with no markdown fences, no explanation:
{
  "name": "brand name",
  "website_url": "${websiteUrl}",
  "logo_url": "",
  "tagline": "brand tagline or slogan",
  "industry": "industry category",
  "audience": "target audience description (1-2 sentences)",
  "tone": ["tone1", "tone2", "tone3"],
  "colors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "fonts": ["Primary Font Name", "Secondary Font Name"],
  "visual_style": "one of: Minimalist / Vibrant & Bold / Editorial / Dark & Moody / Light & Airy / Natural & Organic / Graphic & Geometric",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "avoid": [],
  "example_images": [],
  "product_images": [],
  "lifestyle_images": [],
  "brand_values": ["value1", "value2", "value3", "value4", "value5"],
  "aesthetic": ["aesthetic1", "aesthetic2", "aesthetic3"],
  "overview": "2-3 sentence business overview describing what the company does, its history, and positioning"
}

Guidelines:
- Colors: MUST use the ground truth CSS hex codes above when provided — do not deviate
- Fonts: MUST use the ground truth CSS font names above when provided — do not deviate
- Brand values: e.g. Innovation, Quality, Trust, Sustainability
- Aesthetic: e.g. industrial heritage, high-contrast utility, approachable expertise
- Tone: e.g. Reliable, Practical, Authoritative, Warm, Energetic
- Be specific and accurate based on the brand's known identity.`;

  // Use gemini-2.5-flash for text analysis with timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90s timeout
  const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, thinkingConfig: { thinkingBudget: 0 } },
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim() || '';
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const dna = JSON.parse(cleaned) as BrandDNA;
    dna.website_url = websiteUrl;
    // Inject real scraped data — override Gemini's guesses with ground truth
    dna.logo_url = scrapedLogoUrl || dna.logo_url || '';
    // CSS colors take priority over Gemini's guess when available
    if (scrapedCssColors.length > 0) dna.colors = scrapedCssColors.slice(0, 7);
    // CSS fonts take priority over Gemini's guess when available
    if (scrapedCssFonts.length > 0) dna.fonts = scrapedCssFonts.slice(0, 3);
    // Classified image buckets
    dna.product_images = scrapedProductImages.length > 0 ? scrapedProductImages : (dna.product_images || []);
    dna.lifestyle_images = scrapedLifestyleImages.length > 0 ? scrapedLifestyleImages : (dna.lifestyle_images || []);
    dna.example_images = scrapedImages.length > 0 ? scrapedImages : dna.example_images || [];

    // ── Auto-detected products → convert to BrandProduct[] directly ──
    // This bypasses any _detected_products / useEffect issues
    const finalProducts: BrandProduct[] = [];
    if (scrapedDetectedProducts.length > 0) {
      for (const dp of scrapedDetectedProducts) {
        finalProducts.push({
          id: crypto.randomUUID(),
          name: dp.name,
          imageDataUrl: dp.imageUrl, // HTTP URL from Shopify/scrape
        });
      }
    }
    dna.products = finalProducts;
    // Also ensure product_images includes detected product images
    const imgSet = new Set(dna.product_images);
    for (const dp of scrapedDetectedProducts) {
      if (dp.imageUrl && !imgSet.has(dp.imageUrl)) {
        dna.product_images.unshift(dp.imageUrl);
      }
    }
    return dna;
  } catch {
    throw new Error('Brand scan returned invalid data. Please try again.');
  }
};

// ── Visual RAG (The Distillation Engine) ───────────────────────────────────

/**
 * Takes an array of raw reference images and distills them into a dense
 * text-based prompt defining the brand's core aesthetic.
 * This prevents context limits and API bloat by allowing us to discard the heavy images
 * after they are "read" once.
 */
export const extractVisualAesthetic = async (base64Images: string[]): Promise<string> => {
  if (!base64Images || base64Images.length === 0) return '';

  const imageParts = base64Images.map(b64 => {
    // strip "data:image/jpeg;base64," header for gemini
    const cleanBase64 = b64.includes(',') ? b64.split(',')[1] : b64;
    return {
      inlineData: {
        data: cleanBase64,
        mimeType: 'image/jpeg' // simplify to jpeg for Gemini
      }
    };
  });

  const prompt = `You are a world-class Art Director and Brand Strategist.
I am giving you a batch of reference images that define a brand's core aesthetic.
I need you to extract the deep visual DNA from these images so I can use it as a persistent style guide.

Extract and synthesize the following:
1. Primary Lighting setup (e.g. moody, high-key, neon, natural sunlight)
2. Camera & Composition rules (e.g. low angle, extreme macro, symmetrical)
3. Color Treatment & Grading (e.g. high contrast, desaturated, warm cinematic)
4. Core Vibe / Mood (e.g. aggressive & athletic, soft & approachable)

Format your response as a single, highly dense paragraph (max 3 sentences) that can be injected directly into an image generation prompt. 
Be highly specific with aesthetic keywords. Do not explain your reasoning. Just return the prompt block.`;

  try {
    const res = await fetch('/api/gemini/models/gemini-2.5-pro:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { responseModalities: ['TEXT'], temperature: 0.4 },
      }),
    });

    if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
    const json = await res.json();
    return json.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim() || '';
  } catch (err) {
    console.error('[DistillationEngine] Failed to extract visual aesthetic:', err);
    return '';
  }
};

// ── Brand Profile ──────────────────────────────────────────────────────────

export const getAllBrandProfiles = async (userId: string): Promise<BrandProfile[]> => {
  try {
    const data = await getAllLocalBrandProfiles(userId);
    return data || [];
  } catch (err) {
    console.error('[Brand] getAllBrandProfiles local error:', err);
    return [];
  }
};

export const getBrandProfile = async (userId: string): Promise<BrandProfile | null> => {
  try {
    const data = await getLocalBrandProfile(userId);
    return data || null;
  } catch (err) {
    console.error('[Brand] getBrandProfile local error:', err);
    return null;
  }
};

export const saveBrandProfile = async (
  userId: string,
  profile: Omit<BrandProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'> | Partial<BrandProfile>
): Promise<BrandProfile | null> => {
  try {
    const saved = await saveLocalBrandProfile(userId, profile);
    return saved || null;
  } catch (err) {
    console.error('[Brand] saveBrandProfile error:', err);
    throw err;
  }
};

export const deleteBrandProfile = async (brandId: string): Promise<void> => {
  // 1. Clear product images from localStorage
  clearProductImages();

  // 2. Delete the brand profile row — content_slots cascade automatically via our manual logic
  await deleteLocalBrandProfile(brandId);
};

// ── Content Slots ──────────────────────────────────────────────────────────

export const getSlotsForMonth = async (
  brandId: string,
  year: number,
  month: number
): Promise<ContentSlot[]> => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  try {
    const allSlots = await getLocalSlotsForMonth(brandId, year, month);
    // Filter locally by date range
    const inMonth = allSlots.filter((s: any) => s.slot_date >= start && s.slot_date <= end);
    return hydrateSlots(inMonth || []);
  } catch (err) {
    console.error('[Brand] getSlotsForMonth local error:', err);
    return [];
  }
};

export const upsertSlot = async (
  userId: string,
  brandId: string,
  slotDate: string,
  format: ContentFormat,
  patch: Partial<Pick<ContentSlot, 'idea' | 'brief' | 'generated_image' | 'approved' | 'status' | 'selected_product' | 'platform'>>
): Promise<ContentSlot | null> => {
  let dbPatch = { ...patch };
  const img = patch.generated_image;

  // Convert any image (data: URI or blob: URL) to a Blob and store INLINE in the slot record.
  // No more separate slot_images store or idb: keys — the Blob lives directly in content_slots.
  if (img && (img.startsWith('data:') || img.startsWith('blob:'))) {
    try {
      const res = await fetch(img);
      const blob = await res.blob();
      // Store the Blob directly in the slot record under _image_blob
      dbPatch = { ...patch, generated_image: '__blob__', _image_blob: blob };
    } catch {
      // If fetch fails (shouldn't for valid data: or blob:), store raw
      dbPatch = { ...patch };
    }
  }

  try {
    const saved = await upsertLocalSlot(userId, brandId, slotDate, format, dbPatch);
    if (!saved) return null;
    // Return with a usable object URL for the caller
    const displayUrl = saved._image_blob instanceof Blob
      ? URL.createObjectURL(saved._image_blob)
      : (img || saved.generated_image);
    return { ...saved, generated_image: displayUrl };
  } catch (err) {
    console.error('[Brand] upsertSlot local error:', err);
    throw err;
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a single image URL (http or data URI) to a base64 data URL. Returns null on failure. */
async function resolveImageToBase64(img: string): Promise<string | null> {
  try {
    if (img.startsWith('data:')) return img;
    if (img.startsWith('http://') || img.startsWith('https://')) {
      const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(img)}`);
      if (!proxyRes.ok) return null;
      const json = await proxyRes.json();
      return json.dataUrl || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve brand reference images to base64 data URLs for passing as baseImages
 * to generateImage(). Uses a strict priority chain:
 *
 * Priority 1: Approved slot images for this brand (proven correct visuals)
 * Priority 2: product_images from brand DNA (actual product shots)
 * Priority 3: lifestyle_images / example_images (fallback for style reference)
 *
 * Returns up to `maxImages` resolved images; skips failures silently.
 */
export async function resolveBrandReferenceImages(
  brand: BrandProfile,
  maxImages = 4
): Promise<string[]> {
  const results: string[] = [];

  // ── Priority 1: Approved slot images (newest first, max 2) ────────────────
  try {
    const allSlots = await getLocalSlotsForMonth(brand.id, 0, 0); // Need to fetch all or write a new index in future, but for now fetch all slots for this brand
    const approvedSlots = allSlots
      .filter((s: any) => s.approved === true && !!s.generated_image)
      .sort((a: any, b: any) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 2);

    for (const slot of approvedSlots) {
      if (results.length >= maxImages) continue;
      // New inline blob approach
      if ((slot as any)._image_blob instanceof Blob) {
        results.push(URL.createObjectURL((slot as any)._image_blob));
        continue;
      }
      let img = slot.generated_image;
      if (!img) continue;
      if (img.startsWith(IDB_PREFIX)) {
        img = (await getSlotImage(img.slice(IDB_PREFIX.length))) ?? '';
      }
      if (img) results.push(img);
    }
  } catch { /* skip if query fails */ }

  // ── Priority 2: product_images from brand DNA ──────────────────────────────
  const productImgs = brand.product_images || [];
  for (const img of productImgs.slice(0, maxImages)) {
    if (results.length >= maxImages) break;
    const resolved = await resolveImageToBase64(img);
    if (resolved) results.push(resolved);
  }

  // ── Priority 3: lifestyle_images / example_images as fallback ─────────────
  if (results.length < 2) {
    const fallback = (brand.lifestyle_images?.length ? brand.lifestyle_images : brand.example_images) || [];
    for (const img of fallback.slice(0, maxImages)) {
      if (results.length >= maxImages) break;
      const resolved = await resolveImageToBase64(img);
      if (resolved) results.push(resolved);
    }
  }

  return results;
}

/** Prefix to enforce pixel-perfect product fidelity when reference images are provided. */
export const PRODUCT_IDENTITY_LOCK =
  'CRITICAL — PRODUCT IDENTITY LOCK: The reference images show the EXACT product(s) that must appear in this creative. Reproduce every product with 100% visual fidelity — identical packaging shape, label design, colors, materials, typography, and proportions. Do NOT invent, reimagine, or stylize the product. It must be indistinguishable from the reference. ';

function buildBrandContext(brand: BrandProfile): string {
  const products = brand.products || [];
  return [
    `Brand: ${brand.name}`,
    brand.tagline ? `Tagline: "${brand.tagline}"` : '',
    `Industry: ${brand.industry}`,
    `Audience: ${brand.audience}`,
    `Tone: ${brand.tone.join(', ')}`,
    `Visual style: ${brand.visual_style}`,
    `Aesthetic Rules (CRITICAL FOR IMAGE GEN): ${brand.visual_style_rules || brand.aesthetic?.join(', ')}`,
    brand.keywords.length > 0 ? `Keywords: ${brand.keywords.join(', ')}` : '',
    brand.avoid.length > 0 ? `Avoid: ${brand.avoid.join(', ')}` : '',
    `Brand colours: ${brand.colors.join(', ')}`,
    products.length > 0
      ? `PRODUCTS TO PROMOTE (ONLY these — do not invent others): ${products.map(p => p.name).join(', ')}`
      : '',
  ].filter(Boolean).join('\n');
}

/** Build multimodal parts from brand inspiration images (max 3).
 *
 *  - data: URIs  → used directly (e.g. images manually added by the user)
 *  - HTTP/S URLs → fetched server-side via /api/proxy-image (handles CORS, filters SVGs)
 *
 *  This means scraped website images work automatically — no user action needed.
 */
async function buildInspirationImageParts(brand: BrandProfile): Promise<any[]> {
  const parts: any[] = [];
  const images = brand.example_images.slice(0, 3);

  for (const img of images) {
    try {
      let dataUrl: string;

      if (img.startsWith('data:')) {
        // Already a base64 data URI — use directly
        dataUrl = img;
      } else if (img.startsWith('http://') || img.startsWith('https://')) {
        // HTTP URL — proxy through our server to get base64
        // (browser can't fetch arbitrary external URLs cross-origin,
        //  and SVGs/non-raster types are rejected by the proxy automatically)
        const proxyRes = await fetch(`/api/proxy-image?url=${encodeURIComponent(img)}`);
        if (!proxyRes.ok) continue; // SVG, too large, fetch failed — skip silently
        const json = await proxyRes.json();
        if (!json.dataUrl) continue;
        dataUrl = json.dataUrl;
      } else {
        continue; // Unknown format — skip
      }

      // Compress if oversized before sending to Gemini
      const compressed = await smartCompress(dataUrl);
      const mimeMatch = compressed.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch?.[1] || 'image/jpeg';
      const base64 = compressed.replace(/^data:image\/\w+;base64,/, '');
      if (base64) parts.push({ inlineData: { mimeType, data: base64 } });
    } catch {
      // skip bad images silently — brief generation continues without them
    }
  }
  return parts;
}

async function callGeminiText(prompt: string, extraParts: any[] = []): Promise<string> {
  const parts = [{ text: prompt }, ...extraParts];
  const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT'], temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim() || '';
}

// ── AI Brief Generation ────────────────────────────────────────────────────

export const generateBrief = async (
  brand: BrandProfile,
  slot: { slot_date: string; format: ContentFormat; idea: string }
): Promise<ContentBrief> => {
  const products = brand.products || [];
  const hasProducts = products.length > 0;
  const imagePromptInstruction = hasProducts
    ? '"image_prompt": "Describe ONLY the background, setting, and lighting around the product — e.g. \'warm café interior, afternoon golden light, marble surface, soft bokeh\'. Do NOT describe the product itself; it will be provided as the locked reference image and must not change.",'
    : '"image_prompt": "Pure lifestyle/mood scene — NO product objects, NO bottles, NO packaging. Describe only setting, lighting, textures, colors, atmosphere that evoke the brand aesthetic. Example: warm earthy tones, soft morning light through a window, Ayurvedic herbs on a wooden surface.",';

  const prompt = [
    `You are a brand content strategist for ${brand.name}.`,
    '',
    'Brand Profile:',
    buildBrandContext(brand),
    '',
    hasProducts
      ? `Products confirmed for this brand: ${products.map(p => p.name).join(', ')}. The content brief must be about one of these specific products.`
      : 'IMPORTANT: No specific products have been confirmed for this brand. Do NOT invent or name any products. Write content about brand values, lifestyle, education, and community — no product-specific claims.',
    brand.example_images.length > 0
      ? 'The brand\'s inspiration images are attached — study the visual style, colour palette, mood, and aesthetic carefully.'
      : '',
    '',
    'Content brief request:',
    `- Format: ${slot.format} (${slot.format === 'reel' ? 'short video concept' : slot.format === 'story' ? 'Instagram/social story' : 'feed post'})`,
    `- Date: ${slot.slot_date}`,
    `- Creative idea: ${slot.idea}`,
    '',
    'Generate a detailed content brief as valid JSON only (no markdown, no explanation):',
    '{',
    '  "hook": "attention-grabbing opening line for the caption",',
    '  "caption": "full caption (2-3 paragraphs, brand voice, no hashtags)",',
    '  "hashtags": ["hashtag1", "hashtag2", "...up to 15 relevant hashtags"],',
    `  ${imagePromptInstruction}`,
    '  "visual_direction": "specific art direction: lighting, composition, color treatment, mood",',
    '  "call_to_action": "CTA line",',
    '  "target_emotion": "primary emotion to evoke in the audience"',
    '}',
  ].filter(s => s !== '').join('\n');

  // Include inspiration images as multimodal context
  const imageParts = brand.example_images.length > 0
    ? await buildInspirationImageParts(brand)
    : [];

  const text = await callGeminiText(prompt, imageParts);
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned) as ContentBrief;
  } catch {
    throw new Error('Brief generation returned invalid JSON. Try again.');
  }
};

// ── AI Monthly Plan Generation ─────────────────────────────────────────────

export const generateMonthPlan = async (
  brand: BrandProfile,
  year: number,
  month: number,
  conversationContext: string,
  postCount: number = 20,
  referenceImageParts: any[] = []
): Promise<Array<{ date: string; format: ContentFormat; idea: string }>> => {
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = MONTH_NAMES[month - 1];
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Format distribution based on postCount
  const distLine = postCount >= 90
    ? '- Distribution: 30 posts, 30 stories, 30 reels — exactly 1 post + 1 story + 1 reel per day for all 30 days'
    : postCount >= 60
      ? `- Distribution: ${Math.round(postCount * 0.4)} posts, ${Math.round(postCount * 0.37)} stories, ${Math.round(postCount * 0.23)} reels — schedule 2 per day`
      : postCount >= 30
        ? `- Distribution: ${Math.round(postCount * 0.4)} posts, ${Math.round(postCount * 0.37)} stories, ${Math.round(postCount * 0.23)} reels — roughly 1 per day`
        : `- Distribution: ${Math.round(postCount * 0.4)} posts, ${Math.round(postCount * 0.37)} stories, ${Math.round(postCount * 0.23)} reels — space across ~3 weeks`;

  const products = brand.products || [];
  const productConstraint = products.length > 0
    ? [
      '',
      `CRITICAL PRODUCT RULE — The brand has ${products.length} confirmed product(s): ${products.map(p => p.name).join(', ')}.`,
      'Every content idea MUST feature one of these specific products by name.',
      'DO NOT invent, guess, or mention any product not in this list.',
      'Cycle through the products so each one gets roughly equal coverage across the month.',
    ].join('\n')
    : [
      '',
      'CRITICAL — No specific products have been confirmed for this brand.',
      'DO NOT invent, name, or describe any products whatsoever.',
      'Content ideas must focus ONLY on: brand values, educational tips, lifestyle aesthetics, customer stories, behind-the-scenes, community engagement, and general wellness topics aligned with the brand.',
      'Never mention a specific product name, ingredient benefit claim, or SKU.',
    ].join('\n');

  const prompt = [
    `You are an expert social media content strategist for ${brand.name}.`,
    '',
    'Brand Profile:',
    buildBrandContext(brand),
    productConstraint,
    '',
    `Monthly Planning Session — ${monthName} ${year}:`,
    conversationContext,
    '',
    `Generate a content calendar for ${monthName} ${year} (${monthStart} to ${monthEnd}).`,
    '',
    `Create EXACTLY ${postCount} content pieces. This is a firm requirement — return exactly ${postCount} items.`,
    distLine,
    '- Each idea must be specific, actionable, and aligned with the brand voice and monthly direction',
    '- Spread dates evenly across the month — no more than 3 per day',
    '- MANDATORY: Check the context for "Target country:" — identify ALL public holidays, festivals, national days, and cultural celebrations in that country during this exact month+year. Add a dedicated post for each one. These festival posts are REQUIRED on top of the content count.',
    '- For festival/holiday posts: name the specific event in the idea and authentically tie it to the brand',
    '',
    'IMPORTANT — Format-specific idea rules:',
    '- post/story: 1-2 sentence content idea (caption hook + visual description)',
    '- reel: Write a SHORT SCRIPT with 3-4 scenes. Format: "Scene 1: [action/visual]. Scene 2: [action/visual]. Scene 3: [action/visual]. VO: [voiceover line or on-screen text]." Keep it punchy and filmable.',
    '',
    `Return ONLY a valid JSON array (no markdown fences, no explanation). All dates must be between ${monthStart} and ${monthEnd}:`,
    '[',
    '  {"date": "YYYY-MM-DD", "format": "post", "idea": "1-2 sentence specific content idea"},',
    '  {"date": "YYYY-MM-DD", "format": "reel", "idea": "Scene 1: ... Scene 2: ... Scene 3: ... VO: ..."},',
    '  ...',
    ']',
  ].join('\n');

  const text = await callGeminiText(prompt, referenceImageParts);
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  let raw: any[];
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new Error('Calendar generation returned invalid JSON. Please try again.');
  }

  // Validate and filter items, auto-match product from idea text
  return raw
    .filter(item => item.date && item.format && item.idea)
    .filter(item => ['post', 'story', 'reel'].includes(item.format))
    .filter(item => item.date >= monthStart && item.date <= monthEnd)
    .map(item => ({
      date: item.date,
      format: item.format as ContentFormat,
      idea: String(item.idea),
      matched_product: matchProductFromText(String(item.idea), products),
    }));
};

/** Match a product name from idea/caption text. Returns product name or undefined. */
export const matchProductFromText = (text: string, products: BrandProduct[]): string | undefined => {
  if (!products.length || !text) return undefined;
  const lower = text.toLowerCase();
  // Find the product whose name appears in the text (case-insensitive)
  const match = products.find(p => lower.includes(p.name.toLowerCase()));
  return match?.name;
};

// ── AI Chat Turn ───────────────────────────────────────────────────────────

export const chatPlannerTurn = async (
  brand: BrandProfile,
  monthName: string,
  year: number,
  conversationHistory: Array<{ role: 'user' | 'model'; text: string }>
): Promise<string> => {
  const systemContext = [
    `You are an enthusiastic brand content planner helping ${brand.name} plan their ${monthName} ${year} social media content.`,
    '',
    'Brand Profile:',
    buildBrandContext(brand),
    '',
    'Your role: ask focused questions to understand the monthly direction (theme, products, campaigns, key dates). Keep answers short and friendly. After 3-4 exchanges, offer to generate the calendar.',
    'Never generate the calendar yourself in chat — just gather information and offer to generate it when ready.',
    '',
    `The user has just opened the ${monthName} ${year} content planner. Start by asking about their monthly direction.`,
  ].join('\n');

  // Build alternating contents: system baked into first user turn
  const contents: any[] = [
    { role: 'user', parts: [{ text: systemContext }] },
  ];

  for (const msg of conversationHistory) {
    contents.push({ role: msg.role, parts: [{ text: msg.text }] });
  }

  const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { responseModalities: ['TEXT'], temperature: 0.8 },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim()
    || 'Sorry, I had trouble responding. Please try again.';
};
