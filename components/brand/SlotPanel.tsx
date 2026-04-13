import React, { useState, useEffect, useRef } from 'react';
import { X, Wand2, ImageIcon, Check, ChevronDown, ChevronUp, Loader2, AlertCircle, Upload, RefreshCw, Package, Send } from 'lucide-react';
import { BrandProfile, BrandProduct, ContentSlot, ContentBrief, ContentFormat } from '../../types/brand.types';
import { generateBrief, upsertSlot } from '../../services/brandService';
import { generateImage } from '../../services/geminiService';
import { getUserGenerations } from '../../services/generationsService';
import { SocialPublishPanel } from './SocialPublishPanel';
import QualityScoreBadge from './QualityScoreBadge';

interface Props {
  brand: BrandProfile;
  userId: string;
  slotDate: string;
  format: ContentFormat;
  existing: ContentSlot | null;
  onClose: () => void;
  onSaved: (slot: ContentSlot) => void;
}

const FORMAT_LABELS: Record<ContentFormat, string> = {
  post: 'Feed Post',
  story: 'Story',
  reel: 'Reel',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const IMG_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: 'NB2 — Default' },
  { value: 'gemini-3-pro-image-preview', label: 'Pro — Best Quality' },
  { value: 'gemini-2.5-flash-image', label: 'Fast — Quick Gen' },
];

const IMG_QUALITIES = ['1K', '2K', '4K'] as const;
type Quality = typeof IMG_QUALITIES[number];

function formatDate(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${MONTH_NAMES[parseInt(m) - 1]} ${parseInt(d)}`;
}

export const SlotPanel: React.FC<Props> = ({ brand, userId, slotDate, format, existing, onClose, onSaved }) => {
  const [idea, setIdea] = useState(existing?.idea || '');
  const [brief, setBrief] = useState<ContentBrief | null>(existing?.brief || null);
  const [generatedImage, setGeneratedImage] = useState<string | null>(existing?.generated_image || null);
  const [approved, setApproved] = useState(existing?.approved || false);

  // Image generation options
  const [imgModel, setImgModel] = useState(IMG_MODELS[0].value);
  const [imgQuality, setImgQuality] = useState<Quality>('1K');
  const [productImage, setProductImage] = useState<string | null>(null);

  // Selected product from brand.products — the locked reference for image-to-image
  // Auto-select from slot's matched product, or default to single product
  const products: BrandProduct[] = brand.products || [];
  const [selectedProduct, setSelectedProduct] = useState<BrandProduct | null>(() => {
    if (existing?.selected_product) {
      const matched = products.find(p => p.name.toLowerCase() === existing.selected_product!.toLowerCase());
      if (matched) return matched;
    }
    return products.length === 1 ? products[0] : null;
  });

  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(true);
  const [showImageOptions, setShowImageOptions] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showGalleryPicker, setShowGalleryPicker] = useState(false);
  const [galleryImages, setGalleryImages] = useState<{ id: string; url: string; prompt: string }[]>([]);
  const [loadingGallery, setLoadingGallery] = useState(false);

  const productFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIdea(existing?.idea || '');
    setBrief(existing?.brief || null);
    setGeneratedImage(existing?.generated_image || null);
    setApproved(existing?.approved || false);
    setError(null);
    setProductImage(null);
    // Auto-select product from slot's matched product
    if (existing?.selected_product) {
      const matched = products.find(p => p.name.toLowerCase() === existing.selected_product!.toLowerCase());
      if (matched) setSelectedProduct(matched);
    } else if (products.length === 1) {
      setSelectedProduct(products[0]);
    } else {
      setSelectedProduct(null);
    }
  }, [slotDate, format, existing]);

  const save = async (patch: Partial<ContentSlot>) => {
    setSaving(true);
    try {
      const saved = await upsertSlot(userId, brand.id, slotDate, format, patch);
      if (saved) onSaved(saved);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateBrief = async () => {
    if (!idea.trim()) { setError('Add an idea first.'); return; }
    setError(null);
    setGeneratingBrief(true);
    try {
      const b = await generateBrief(brand, { slot_date: slotDate, format, idea });
      setBrief(b);
      await save({ idea, brief: b, status: 'briefed' });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGeneratingBrief(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!brief?.image_prompt) { setError('Generate a brief first.'); return; }
    setError(null);
    setGeneratingImage(true);
    try {
      const aspectRatio = format === 'story' || format === 'reel' ? '9:16' : '1:1';
      let finalPrompt: string;
      let baseImages: string[] = [];

      if (selectedProduct) {
        // Image-to-image: start FROM the product photo, paint the scene around it
        finalPrompt = `Edit this image. The ${selectedProduct.name} must remain absolutely identical — same shape, packaging, colors, labels, proportions, and every detail. Do not alter the product in any way whatsoever. Change ONLY the background and surrounding scene to: ${brief.image_prompt}`;
        baseImages = [selectedProduct.imageDataUrl];
        if (productImage) baseImages.unshift(productImage); // user-uploaded takes priority
      } else if (productImage) {
        // Manual upload fallback
        finalPrompt = `Edit this image. Keep the product exactly as shown. Change only the background/scene to: ${brief.image_prompt}`;
        baseImages = [productImage];
      } else {
        // No product reference — pure lifestyle scene, absolutely no invented products
        finalPrompt = `${brief.image_prompt}. IMPORTANT: Do NOT include any product objects, bottles, packaging, or branded items in this image. This must be a pure atmospheric lifestyle scene — textures, lighting, setting, and mood only.`;
      }

      const urls = await generateImage({
        prompt: finalPrompt,
        model: imgModel,
        aspectRatio,
        quality: imgQuality,
        baseImages,
        temperature: baseImages.length > 0 ? 0.1 : undefined,
        userId,
      });
      if (!urls || urls.length === 0) throw new Error('No image returned.');
      setGeneratedImage(urls[0]);
      await save({ generated_image: urls[0], status: 'generated' });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleApprove = async () => {
    setApproved(true);
    await save({ approved: true, status: 'approved' });
  };

  const handleIdeaSave = async () => {
    if (!idea.trim()) return;
    await save({ idea, status: 'ideated' });
  };

  const handleRecoverFromGallery = async () => {
    setLoadingGallery(true);
    try {
      const gens = await getUserGenerations(userId, 'image');
      // Convert blob URLs to displayable URLs
      const items = gens.slice(0, 20).map(g => ({
        id: g.id,
        url: g.content_url,
        prompt: g.prompt || '',
      }));
      setGalleryImages(items);
      setShowGalleryPicker(true);
    } catch (e) {
      setError('Failed to load gallery images');
    } finally {
      setLoadingGallery(false);
    }
  };

  const handlePickGalleryImage = async (url: string) => {
    setGeneratedImage(url);
    setShowGalleryPicker(false);
    await save({ generated_image: url, status: 'generated' });
  };

  const handlePublished = async (platforms: string[], requestId: string) => {
    await save({
      published_platforms: platforms,
      published_at: new Date().toISOString(),
      publish_request_id: requestId,
    });
  };

  const handleProductImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setProductImage(ev.target!.result as string);
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
        <div>
          <div className="text-xs text-text-secondary mb-0.5">{formatDate(slotDate)}</div>
          <h3 className="font-bold text-text-primary text-base">{FORMAT_LABELS[format]}</h3>
        </div>
        <div className="flex items-center gap-2">
          {approved && (
            <span className="flex items-center gap-1 px-2 py-1 bg-emerald-950/50 border border-emerald-800/60 text-emerald-400 rounded-full text-xs font-bold">
              <Check size={10} /> Approved
            </span>
          )}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-red-400 text-xs">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {/* ── Idea ─────────────────────────────────────────────────────────── */}
        <section>
          <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">Your Idea</label>
          <textarea
            className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm placeholder-text-secondary focus:outline-none focus:border-brand transition-colors resize-none"
            placeholder={`What do you want to post? e.g. "Showcase our new morning routine product with sunrise vibes"`}
            value={idea}
            onChange={e => setIdea(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleIdeaSave}
              disabled={!idea.trim() || saving}
              className="px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs font-medium hover:border-text-secondary disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              {saving ? 'Saving…' : 'Save Idea'}
            </button>
            <button
              onClick={handleGenerateBrief}
              disabled={!idea.trim() || generatingBrief}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand text-bg text-xs font-bold disabled:opacity-50 disabled:pointer-events-none hover:opacity-90 transition-all"
            >
              {generatingBrief
                ? <><Loader2 size={12} className="animate-spin" /> Generating…</>
                : <><Wand2 size={12} /> Generate Brief</>}
            </button>
          </div>
        </section>

        {/* ── Brief ────────────────────────────────────────────────────────── */}
        {brief && (
          <section className="bg-surface border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setBriefExpanded(v => !v)}
              className="flex items-center justify-between w-full p-3 text-left"
            >
              <span className="text-xs font-bold text-text-secondary uppercase tracking-widest">Content Brief</span>
              {briefExpanded ? <ChevronUp size={14} className="text-text-secondary" /> : <ChevronDown size={14} className="text-text-secondary" />}
            </button>
            {briefExpanded && (
              <div className="px-3 pb-3 space-y-3">
                {[
                  { label: 'Hook', value: brief.hook },
                  { label: 'Caption', value: brief.caption },
                  { label: 'Call to Action', value: brief.call_to_action },
                  { label: 'Visual Direction', value: brief.visual_direction },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div className="text-[10px] font-bold text-brand uppercase tracking-widest mb-1">{label}</div>
                    <p className="text-text-secondary text-xs leading-relaxed whitespace-pre-line">{value}</p>
                  </div>
                ))}
                <div>
                  <div className="text-[10px] font-bold text-brand uppercase tracking-widest mb-1">Hashtags</div>
                  <div className="flex flex-wrap gap-1">
                    {brief.hashtags.map(h => (
                      <span key={h} className="px-1.5 py-0.5 bg-brand/10 text-brand text-[10px] rounded border border-brand/20">
                        #{h.replace(/^#/, '')}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-brand uppercase tracking-widest mb-1">Image Prompt</div>
                  <p className="text-text-secondary text-xs leading-relaxed italic">"{brief.image_prompt}"</p>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-brand uppercase tracking-widest mb-1">Target Emotion</div>
                  <span className="px-2 py-0.5 bg-violet-950/40 border border-violet-800/40 text-violet-400 text-xs rounded-full">{brief.target_emotion}</span>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Image Generation ─────────────────────────────────────────────── */}
        {brief && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-text-secondary uppercase tracking-widest">Visual</label>
              <button
                onClick={() => setShowImageOptions(v => !v)}
                className="text-[10px] text-text-secondary hover:text-brand transition-colors flex items-center gap-1"
              >
                Options {showImageOptions ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
            </div>

            {/* No products warning */}
            {products.length === 0 && !productImage && (
              <div className="bg-amber-950/40 border border-amber-600/30 rounded-xl p-3 mb-3">
                <p className="text-amber-400 text-xs font-bold mb-1">No products set up</p>
                <p className="text-amber-300/80 text-[10px] leading-relaxed">
                  To lock a real product in the image, go to <strong>Brand DNA → Edit</strong> and name your products in the wizard. Until then, generation will create abstract lifestyle scenes only — no product objects.
                </p>
              </div>
            )}

            {/* Product picker — shown always if brand has named products */}
            {products.length > 0 && (
              <div className="bg-surface border border-border rounded-xl p-3 mb-3">
                <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-2">
                  <Package size={10} className="inline mr-1" />Which product is this post about?
                </label>
                <div className="flex flex-wrap gap-2">
                  {products.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        const next = selectedProduct?.id === p.id ? null : p;
                        setSelectedProduct(next);
                        // Persist product selection to slot
                        save({ selected_product: next?.name || undefined });
                      }}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all ${selectedProduct?.id === p.id ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-secondary hover:border-text-secondary'}`}
                    >
                      <img src={p.imageDataUrl} alt="" className="w-5 h-5 rounded object-cover" />
                      {p.name}
                    </button>
                  ))}
                </div>
                {selectedProduct && (
                  <p className="text-[10px] text-brand mt-1.5">
                    Image will start from the {selectedProduct.name} photo — only the scene changes.
                  </p>
                )}
              </div>
            )}

            {/* Image generation options */}
            {showImageOptions && (
              <div className="bg-surface border border-border rounded-xl p-3 mb-3 space-y-3">
                {/* Model */}
                <div>
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5">Model</label>
                  <div className="flex gap-2">
                    {IMG_MODELS.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setImgModel(m.value)}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ${imgModel === m.value ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-secondary hover:border-text-secondary'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality */}
                <div>
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5">Quality</label>
                  <div className="flex gap-2">
                    {IMG_QUALITIES.map(q => (
                      <button
                        key={q}
                        onClick={() => setImgQuality(q)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${imgQuality === q ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-secondary hover:border-text-secondary'}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Product image upload */}
                <div>
                  <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block mb-1.5">Product / Reference Image</label>
                  {productImage ? (
                    <div className="flex items-center gap-2">
                      <img src={productImage} alt="Product" className="w-12 h-12 rounded-lg object-cover border border-border" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-text-primary font-medium">Product uploaded</p>
                        <p className="text-[10px] text-text-secondary">Will be sent as reference image</p>
                      </div>
                      <button
                        onClick={() => setProductImage(null)}
                        className="text-text-secondary hover:text-red-400 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => productFileRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-text-secondary text-xs hover:border-brand hover:text-brand transition-colors"
                    >
                      <Upload size={12} /> Upload Product Image
                    </button>
                  )}
                  <input
                    ref={productFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleProductImageFile}
                  />
                </div>
              </div>
            )}

            {/* Image preview / generate button */}
            {generatedImage ? (
              <div className="space-y-2">
                {generatedImage.startsWith('data:') || generatedImage.startsWith('http') || generatedImage.startsWith('blob:') ? (
                  <img src={generatedImage} alt="Generated" className="w-full rounded-xl border border-border object-cover" />
                ) : (
                  <div className="w-full aspect-square rounded-xl border border-border bg-surface flex flex-col items-center justify-center gap-3 p-4">
                    <AlertCircle size={20} className="text-amber-400" />
                    <p className="text-amber-400 text-xs font-medium">Image not found in storage</p>
                    <button
                      onClick={handleRecoverFromGallery}
                      disabled={loadingGallery}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-bg text-xs font-bold hover:opacity-90 disabled:opacity-50 transition-all"
                    >
                      {loadingGallery ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                      Recover from Gallery
                    </button>
                    <p className="text-text-secondary text-[10px]">Or click Regenerate below</p>
                  </div>
                )}
                <button
                  onClick={handleGenerateImage}
                  disabled={generatingImage}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-border text-text-secondary text-xs font-medium hover:border-text-secondary disabled:opacity-50 transition-colors"
                >
                  {generatingImage
                    ? <><Loader2 size={12} className="animate-spin" /> Regenerating…</>
                    : <><RefreshCw size={12} /> Regenerate</>}
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerateImage}
                disabled={generatingImage}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border text-text-secondary text-xs font-medium hover:border-brand hover:text-brand disabled:opacity-50 transition-colors"
              >
                {generatingImage
                  ? <><Loader2 size={14} className="animate-spin" /> Generating image…</>
                  : <><ImageIcon size={14} /> Generate Image</>}
              </button>
            )}
          </section>
        )}

        {/* ── Quality Scores (from Autopilot pipeline) ────────────────────── */}
        {existing?.quality_scores && (
          <section className="p-3 rounded-xl bg-zinc-800/50 border border-zinc-700/30 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-zinc-300">Quality Review</h4>
              {existing.pipeline_run_id && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-violet-500/20 text-violet-400 border border-violet-500/20">
                  Autopilot
                </span>
              )}
            </div>
            <QualityScoreBadge
              scores={existing.quality_scores}
              guardrails={existing.guardrail_flags}
              dedupScore={existing.dedup_score}
            />
          </section>
        )}

        {/* ── Approve ──────────────────────────────────────────────────────── */}
        {generatedImage && !approved && (
          <button
            onClick={handleApprove}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600/20 border border-emerald-700/60 text-emerald-400 text-sm font-bold hover:bg-emerald-600/30 transition-colors"
          >
            <Check size={16} /> Approve for Posting
          </button>
        )}

        {/* ── Publish ──────────────────────────────────────────────────────── */}
        {approved && (
          <button
            onClick={() => setShowPublish(true)}
            disabled={!!(generatedImage && !generatedImage.startsWith('data:') && !generatedImage.startsWith('http') && !generatedImage.startsWith('blob:'))}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand/20 border border-brand/40 text-brand text-sm font-bold hover:bg-brand/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} /> Publish to Social Media
          </button>
        )}

        {/* Published indicator */}
        {existing?.published_platforms && existing.published_platforms.length > 0 && (
          <div className="bg-surface border border-border rounded-xl p-3">
            <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1.5">Published</p>
            <div className="flex flex-wrap gap-1">
              {existing.published_platforms.map(p => (
                <span key={p} className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-[10px] rounded-full">{p}</span>
              ))}
            </div>
            {existing.published_at && (
              <p className="text-[10px] text-text-secondary mt-1">{new Date(existing.published_at).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>

      {/* Publish Modal */}
      {showPublish && (
        <SocialPublishPanel
          slot={{ ...existing!, idea, brief, generated_image: generatedImage, approved }}
          onClose={() => setShowPublish(false)}
          onPublished={handlePublished}
        />
      )}

      {/* Gallery Picker Modal */}
      {showGalleryPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGalleryPicker(false)}>
          <div className="bg-bg border border-border rounded-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="font-bold text-text-primary text-sm">Pick from Gallery</h3>
              <button onClick={() => setShowGalleryPicker(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {galleryImages.length === 0 ? (
                <p className="text-text-secondary text-sm text-center py-8">No images found in gallery.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {galleryImages.map(img => (
                    <button
                      key={img.id}
                      onClick={() => handlePickGalleryImage(img.url)}
                      className="aspect-square rounded-xl border border-border overflow-hidden hover:border-brand hover:scale-[1.02] transition-all"
                    >
                      <img src={img.url} alt={img.prompt} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
