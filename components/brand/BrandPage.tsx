import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles, Edit3, Trash2, Megaphone, Image as ImageIcon, Ratio, Loader2,
  ChevronRight, ChevronLeft, X, Copy, Check, Hash, Download, Plus,
  Calendar, MessageSquarePlus, Monitor, Smartphone, Square, Upload,
  FileDown, ChevronDown, Zap, Share2, Play
} from 'lucide-react';
import { BrandProfile, BrandDNA, BrandProduct, ContentSlot, ContentFormat } from '../../types/brand.types';
import { getAllBrandProfiles, getBrandProfile, saveBrandProfile, deleteBrandProfile, getSlotsForMonth, generateBrief, upsertSlot, generateMonthPlan, resolveBrandReferenceImages, PRODUCT_IDENTITY_LOCK, hydrateProductImages, saveProductImages } from '../../services/brandService';
import { generateImage } from '../../services/geminiService';
import { generateVideo as falGenerateVideo, uploadToFalStorage } from '../../services/falService';
import { saveVideoGeneration } from '../../services/localStorageService';
import { BrandWizard } from './BrandWizard';
import { BrandCalendar } from './BrandCalendar';
import { SlotPanel } from './SlotPanel';
import { BrandChatModal } from './BrandChatModal';
import { BrandCampaignAgent, AgentAnswers } from './BrandCampaignAgent';
import { BrandCampaignChat } from './BrandCampaignChat';
import { BrainActions } from '../BrainActions';
import { SocialAccountsPanel } from './SocialAccountsPanel';
import { AdCampaignsDashboard } from './AdCampaignsDashboard';
import { useAuth } from '../../context/AuthContext';

// Nano Banana 2 model ID
const NB2 = 'gemini-3.1-flash-image-preview';

// Asset format definitions
type AssetKey = '1:1' | '9:16' | '16:9';
const ASSET_FORMATS: { key: AssetKey; label: string; sub: string; Icon: React.ElementType }[] = [
  { key: '1:1', label: 'Post', sub: 'Square', Icon: Square },
  { key: '9:16', label: 'Story', sub: 'Vertical', Icon: Smartphone },
  { key: '16:9', label: 'Landscape', sub: 'Horizontal', Icon: Monitor },
];

// ── Type converters ───────────────────────────────────────────────────────────
const dnaToProfile = (dna: BrandDNA): Omit<BrandProfile, 'id' | 'user_id' | 'created_at' | 'updated_at'> => ({
  name: dna.name, website_url: dna.website_url || '', logo_url: dna.logo_url || '',
  tagline: dna.tagline || '', industry: dna.industry || '', audience: dna.audience || '',
  tone: dna.tone || [], colors: dna.colors || [], fonts: dna.fonts || [],
  visual_style: dna.visual_style || '', keywords: dna.keywords || [], avoid: dna.avoid || [],
  example_images: dna.example_images || [],
  product_images: dna.product_images || [],
  lifestyle_images: dna.lifestyle_images || [],
  products: dna.products || [],
  brand_values: dna.brand_values || [],
  aesthetic: dna.aesthetic || [], overview: dna.overview || '',
});

const profileToDNA = (p: BrandProfile): BrandDNA => ({
  name: p.name, website_url: p.website_url || '', logo_url: p.logo_url || '',
  tagline: p.tagline || '', industry: p.industry || '', audience: p.audience || '',
  tone: p.tone || [], colors: p.colors || [], fonts: p.fonts || [],
  visual_style: p.visual_style || '', keywords: p.keywords || [], avoid: p.avoid || [],
  example_images: p.example_images || [],
  product_images: p.product_images || [],
  lifestyle_images: p.lifestyle_images || [],
  products: p.products || [],
  brand_values: p.brand_values || [],
  aesthetic: p.aesthetic || [], overview: p.overview || '',
});

interface CampaignSuggestion {
  title: string;
  description: string;
  imagePrompt: string;
}



// ── Campaign Asset Modal (PDF-style: left sidebar + 3 format images + action bar) ─
const CampaignModal: React.FC<{
  campaign: CampaignSuggestion;
  brand: BrandProfile;
  onClose: () => void;
  onAddToDNA: (images: string[]) => void;
  onCreateCampaign: () => void;
  defaultAspectRatio?: AssetKey;
}> = ({ campaign, brand, onClose, onAddToDNA, onCreateCampaign, defaultAspectRatio = '1:1' }) => {
  const [brief, setBrief] = useState<{ hook: string; caption: string; hashtags: string[]; call_to_action: string } | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [activeFormat, setActiveFormat] = useState<AssetKey>(defaultAspectRatio);
  const [formatImages, setFormatImages] = useState<Record<AssetKey, string | null>>({ '1:1': null, '9:16': null, '16:9': null });
  const [formatLoading, setFormatLoading] = useState<Record<AssetKey, boolean>>({ '1:1': true, '9:16': true, '16:9': true });
  const [copied, setCopied] = useState(false);
  const [productImage, setProductImage] = useState<string | null>(null);
  const productFileRef = useRef<HTMLInputElement>(null);
  // Resolved base64 versions of brand DNA reference images (for baseImages param)
  const [brandRefImages, setBrandRefImages] = useState<string[] | null>(null);

  // Resolve brand reference images once on mount
  useEffect(() => {
    resolveBrandReferenceImages(brand).then(setBrandRefImages);
  }, [brand.id]);

  // Build a rich brand-aware image prompt
  const baseImagePrompt = `Professional social media marketing visual for ${brand.name}. Campaign: "${campaign.title}". ${campaign.imagePrompt}. Brand aesthetic: ${(brand.aesthetic || []).join(', ')}. Primary brand colors: ${(brand.colors || []).slice(0, 3).join(', ')}. Visual style: ${brand.visual_style}. No text, no words, no logos. Clean professional commercial photography, high production value, editorial quality.`;

  // Generate brief in parallel with images
  useEffect(() => {
    const gen = async () => {
      try {
        const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Social media strategist for ${brand.name}.
Campaign: "${campaign.title}" — ${campaign.description}
Tone: ${(brand.tone || []).join(', ')} | Values: ${(brand.brand_values || []).join(', ')} | Tagline: ${brand.tagline}
Return ONLY valid JSON (no markdown):
{"hook":"short punchy opening line","caption":"2-3 paragraph caption without hashtags","hashtags":["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8"],"call_to_action":"CTA line"}` }]
            }],
            generationConfig: { responseModalities: ['TEXT'], temperature: 0.7 },
          }),
        });
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text?.trim() || '{}';
        setBrief(JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()));
      } catch { setBrief({ hook: '', caption: '', hashtags: [], call_to_action: '' }); }
      finally { setLoadingBrief(false); }
    };
    gen();
  }, []);

  // Auto-generate images once brand reference images are resolved
  useEffect(() => {
    if (brandRefImages === null) return; // wait for resolution
    const identityPrefix = brandRefImages.length > 0 ? PRODUCT_IDENTITY_LOCK : '';
    const imagePrompt = identityPrefix + baseImagePrompt;
    ASSET_FORMATS.forEach(async ({ key }) => {
      try {
        const urls = await generateImage({
          prompt: imagePrompt,
          model: NB2,
          aspectRatio: key,
          quality: '1K',
          baseImages: brandRefImages,
          temperature: brandRefImages.length > 0 ? 0.1 : undefined,
          saveToGallery: false,
          autoDownload: false,
        });
        if (urls.length > 0) setFormatImages(prev => ({ ...prev, [key]: urls[0] }));
      } catch (err) {
        console.error(`[Brand] Image gen failed (${key}):`, err);
      } finally {
        setFormatLoading(prev => ({ ...prev, [key]: false }));
      }
    });
  }, []);

  const allGeneratedImages = Object.values(formatImages).filter(Boolean) as string[];

  const handleProductUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => setProductImage(ev.target!.result as string);
    r.readAsDataURL(f);
  };

  const copyCaption = () => {
    if (!brief) return;
    navigator.clipboard.writeText(`${brief.hook}\n\n${brief.caption}\n\n${brief.hashtags.map(h => `#${h}`).join(' ')}`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const downloadAll = () => {
    ASSET_FORMATS.forEach(({ key, label }, idx) => {
      const img = formatImages[key];
      if (!img) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = img;
        a.download = `${campaign.title.replace(/\s+/g, '_')}_${label}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }, idx * 300);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-5xl bg-panel/80 backdrop-blur-2xl border border-white/5 rounded-3xl flex flex-col overflow-hidden shadow-2xl"
        style={{ height: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5 flex-shrink-0">
          <div>
            <div className="text-[10px] text-brand font-bold uppercase tracking-widest mb-0.5">Campaign Assets · Nano Banana 2</div>
            <h2 className="text-text-primary font-bold text-sm">{campaign.title}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-text-secondary hover:text-white hover:bg-white/10 transition-all">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Left sidebar */}
          <div className="w-44 flex-shrink-0 border-r border-white/5 flex flex-col overflow-y-auto bg-surface/30 backdrop-blur-md">

            {/* Product Image upload */}
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-text-secondary uppercase tracking-widest font-medium mb-2">Product Image</p>
              <button
                onClick={() => productFileRef.current?.click()}
                className="w-full aspect-square rounded-xl border-2 border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-1.5 hover:border-brand/30 hover:bg-brand/5 transition-all overflow-hidden"
              >
                {productImage ? (
                  <img src={productImage} alt="Product" className="w-full h-full object-cover rounded-xl" />
                ) : (
                  <>
                    <Upload size={16} className="text-text-secondary" />
                    <span className="text-[9px] text-text-secondary">Upload photo</span>
                  </>
                )}
              </button>
              <input ref={productFileRef} type="file" accept="image/*" className="hidden" onChange={handleProductUpload} />
            </div>

            {/* Template / Format selector */}
            <div className="p-3 border-b border-white/5">
              <p className="text-[10px] text-text-secondary uppercase tracking-widest font-medium mb-2">Template</p>
              <div className="space-y-1.5">
                {ASSET_FORMATS.map(({ key, label, Icon }) => {
                  const done = !!formatImages[key];
                  const loading = formatLoading[key];
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveFormat(key)}
                      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] transition-all ${activeFormat === key ? 'bg-brand text-bg font-bold shadow-lg shadow-brand/20' : 'bg-white/[0.03] border border-white/5 text-text-secondary hover:text-white hover:border-white/20'}`}
                    >
                      {loading ? <Loader2 size={11} className="animate-spin flex-shrink-0" /> : done ? <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" /> : <Icon size={11} className="flex-shrink-0" />}
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Brief */}
            <div className="p-3 flex-1 overflow-y-auto space-y-3">
              {loadingBrief ? (
                <div className="flex flex-col items-center py-6 gap-2">
                  <Loader2 size={14} className="text-brand animate-spin" />
                  <p className="text-text-secondary text-[10px]">Crafting copy…</p>
                </div>
              ) : brief ? (
                <>
                  {brief.hook && <p className="text-brand text-[10px] italic leading-relaxed">"{brief.hook}"</p>}
                  {brief.caption && <p className="text-text-secondary text-[10px] leading-relaxed line-clamp-6">{brief.caption}</p>}
                  {brief.call_to_action && <p className="text-text-primary text-[10px] font-semibold">{brief.call_to_action}</p>}
                  {brief.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {brief.hashtags.slice(0, 5).map((h, i) => (
                        <span key={i} className="text-[9px] text-text-secondary">#{h}</span>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={copyCaption}
                    className="flex items-center gap-1.5 text-[10px] text-text-secondary hover:text-white w-full justify-center py-1.5 rounded-lg border border-white/5 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06] transition-all"
                  >
                    {copied ? <Check size={10} className="text-brand" /> : <Copy size={10} />}
                    {copied ? 'Copied!' : 'Copy Caption'}
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {/* Main: 3 format images side by side */}
          <div className="flex-1 flex gap-3 p-4 bg-black/20 min-w-0 overflow-x-auto">
            {ASSET_FORMATS.map(({ key, label, sub }) => (
              <div
                key={key}
                className={`flex-1 min-w-[140px] flex flex-col gap-2 cursor-pointer`}
                onClick={() => setActiveFormat(key)}
              >
                <div className="flex items-center justify-between flex-shrink-0">
                  <p className="text-text-secondary text-[10px] uppercase tracking-widest font-medium">{label}</p>
                  <span className="text-[9px] text-text-secondary opacity-50">{sub}</span>
                </div>
                <div
                  className={`flex-1 rounded-xl overflow-hidden border flex items-center justify-center transition-all ${activeFormat === key ? 'border-brand ring-1 ring-brand shadow-lg shadow-brand/10' : 'border-white/5 hover:border-brand/40'}`}
                >
                  {formatLoading[key] ? (
                    <div className="flex flex-col items-center gap-3 p-4">
                      <Loader2 size={22} className="text-brand animate-spin" />
                      <p className="text-text-secondary text-[10px] text-center">Generating<br />{label}…</p>
                    </div>
                  ) : formatImages[key] ? (
                    <div className="relative group w-full h-full cursor-default">
                      <img
                        src={formatImages[key]!}
                        alt={label}
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <BrainActions imageUrl={formatImages[key]!} prompt={`Brand Campaign: ${campaign.title} - ${label}`} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-text-secondary text-[10px] opacity-40 p-4 text-center">Generation<br />failed</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-t border-white/5 flex-shrink-0">
          <button
            onClick={onCreateCampaign}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand text-bg font-bold text-xs hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-brand/20"
          >
            <Sparkles size={12} /> Create Campaign
          </button>
          <button
            onClick={() => allGeneratedImages.length > 0 && onAddToDNA(allGeneratedImages)}
            disabled={allGeneratedImages.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-text-secondary text-xs hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            <Plus size={12} /> Add all to Business DNA
          </button>
          <div className="flex-1" />
          <button
            onClick={downloadAll}
            disabled={allGeneratedImages.length === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-text-secondary text-xs hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all disabled:opacity-40"
          >
            <Download size={12} /> Download All
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Main BrandPage ─────────────────────────────────────────────────────────────
export const BrandPage: React.FC = () => {
  const { session } = useAuth();
  const userId = session?.user?.id || '';

  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandProfile | null | undefined>(undefined);
  const [showWizard, setShowWizard] = useState(false);
  const [showCampaignAgent, setShowCampaignAgent] = useState(false);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'calendar' | 'social' | 'ads'>('campaigns');

  // Add Product modal
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductImage, setNewProductImage] = useState<string | null>(null);
  const addProductFileRef = useRef<HTMLInputElement>(null);

  // Campaigns
  const [populatingCalendar, setPopulatingCalendar] = useState(false);

  // Calendar
  const today = new Date();
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [calMonth, setCalMonth] = useState(today.getMonth() + 1);
  const [slots, setSlots] = useState<ContentSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<{ date: string; format: ContentFormat; existing: ContentSlot | null } | null>(null);
  const [showChat, setShowChat] = useState(false);

  // Batch content generation
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0, currentDate: '', currentFormat: '' as string, status: '', imagesDone: 0, videosDone: 0, failed: 0 });
  const batchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!userId) return;
    getAllBrandProfiles(userId)
      .then(allBrands => {
        const hydrated = allBrands.map(b => {
          if (b.products?.length) {
            b.products = hydrateProductImages(b.products) as any;
          }
          return b;
        });
        setBrands(hydrated);

        const savedActiveId = localStorage.getItem(`klint_active_brand_${userId}`);
        const active = hydrated.find(b => b.id === savedActiveId) || hydrated[0] || null;

        setActiveBrandId(active?.id || null);
        setBrand(active);
      })
      .catch(err => {
        console.error('[Brand] Full profile load failed:', err);
        setBrand(null);
        setBrands([]);
      });
  }, [userId]);

  // Handle switching brands
  const handleSwitchBrand = (id: string) => {
    if (id === 'NEW') {
      setBrand(null);
      setActiveBrandId(null);
      setShowWizard(true);
      return;
    }
    const selected = brands.find(b => b.id === id);
    if (selected) {
      setActiveBrandId(selected.id);
      localStorage.setItem(`klint_active_brand_${userId}`, selected.id);
      setBrand(selected);
      setShowWizard(false);
    }
  };

  useEffect(() => {
    if (!brand || activeTab !== 'calendar') return;
    setLoadingSlots(true);
    getSlotsForMonth(brand.id, calYear, calMonth)
      .then(data => {
        setSlots(data);
        setLoadingSlots(false);
      })
      .catch(err => {
        console.error('[Brand] Failed to load calendar slots:', err);
        setSlots([]);
        setLoadingSlots(false);
      });
  }, [brand, calYear, calMonth, activeTab]);

  const handleWizardComplete = async (dna: BrandDNA) => {
    const saved = await saveBrandProfile(userId, dnaToProfile(dna));
    if (saved) {
      if (saved.products?.length) {
        saved.products = hydrateProductImages(saved.products) as any;
      }

      // Update local state arrays
      setBrands(prev => {
        const idx = prev.findIndex(b => b.id === saved.id);
        if (idx >= 0) {
          const n = [...prev]; n[idx] = saved; return n;
        }
        return [saved, ...prev];
      });

      setBrand(saved);
      setActiveBrandId(saved.id);
      localStorage.setItem(`klint_active_brand_${userId}`, saved.id);

      setShowWizard(false);
      setShowCampaignAgent(true);
    }
  };

  const handleDeleteBrand = async () => {
    if (!brand || !confirm('Delete your brand profile? This cannot be undone.')) return;
    await deleteBrandProfile(brand.id);

    // Remove from state
    const remaining = brands.filter(b => b.id !== brand.id);
    setBrands(remaining);

    // Switch to another or go back to setup
    const nextBrand = remaining[0] || null;
    setBrand(nextBrand);
    setActiveBrandId(nextBrand?.id || null);
    if (nextBrand) {
      localStorage.setItem(`klint_active_brand_${userId}`, nextBrand.id);
    } else {
      localStorage.removeItem(`klint_active_brand_${userId}`);
    }
  };



  const handleCreateCampaign = async (campaign: CampaignSuggestion, postCount: number) => {
    if (!brand) return;
    setPopulatingCalendar(true);
    setActiveTab('calendar');
    try {
      const context = `Campaign: "${campaign.title}" — ${campaign.description}. Build the entire month's content around this campaign theme.`;
      const planned = await generateMonthPlan(brand, calYear, calMonth, context, postCount);
      const saved: any[] = [];
      for (const item of planned) {
        const slot = await upsertSlot(userId, brand.id, item.date, item.format, { idea: item.idea, status: 'ideated' });
        if (slot) saved.push(slot);
        await new Promise(r => setTimeout(r, 250)); // small gap to avoid API rate limit
      }
      const newSlots = saved;
      setSlots(prev => {
        const updated = [...prev];
        for (const ns of newSlots) {
          const idx = updated.findIndex(s => s.slot_date === ns.slot_date && s.format === ns.format);
          if (idx >= 0) updated[idx] = ns; else updated.push(ns);
        }
        return updated;
      });
    } catch (err) {
      console.error('[Brand] Calendar population failed:', err);
    } finally {
      setPopulatingCalendar(false);
    }
  };

  const handleCalendarRequestFromChat = async (theme: string, postCount: number) => {
    // Adapter function to translate the Chat Agent's calendar request to the existing logic
    const fakeCampaign: CampaignSuggestion = {
      title: theme,
      description: "Custom campaign generated by the Brand Intelligence OS.",
      imagePrompt: "Brand-aligned visual"
    };
    await handleCreateCampaign(fakeCampaign, postCount);
  };

  const handleAgentComplete = async (answers: AgentAnswers) => {
    if (!brand) return;
    setShowCampaignAgent(false);
    setPopulatingCalendar(true);
    setActiveTab('calendar');

    try {
      // Build rich context for AI
      const contextLines = [
        `Campaign objective: ${answers.campaignGoal}`,
        `Target audience (Meta Advantage+): ${answers.targetAudience}`,
        `Target country: ${answers.targetCountry}`,
        answers.referenceUrl ? `Reference brand style URL: ${answers.referenceUrl}` : '',
      ].filter(Boolean);

      // Build multimodal parts from uploaded reference images
      const imageParts = answers.referenceImages.map(img => {
        const mimeMatch = img.match(/^data:(image\/\w+);base64,/);
        const mimeType = mimeMatch?.[1] || 'image/jpeg';
        const base64 = img.replace(/^data:image\/\w+;base64,/, '');
        return { inlineData: { mimeType, data: base64 } };
      });

      const planned = await generateMonthPlan(
        brand, calYear, calMonth,
        contextLines.join('\n'),
        answers.postCount,
        imageParts
      );

      // Sequential upserts with small delay to avoid rate limits
      // Auto-match product from idea text
      const saved: ContentSlot[] = [];
      for (const item of planned) {
        const slot = await upsertSlot(userId, brand.id, item.date, item.format, {
          idea: item.idea,
          status: 'ideated',
          selected_product: (item as any).matched_product || undefined,
        });
        if (slot) saved.push(slot as ContentSlot);
        await new Promise(r => setTimeout(r, 250));
      }

      setSlots(prev => {
        const updated = [...prev];
        for (const ns of saved) {
          const idx = updated.findIndex(s => s.slot_date === ns.slot_date && s.format === ns.format);
          if (idx >= 0) updated[idx] = ns; else updated.push(ns);
        }
        return updated;
      });

      setPopulatingCalendar(false);

      // Resolve brand DNA reference images once for all reel thumbnails
      const brandRefImgs = await resolveBrandReferenceImages(brand);
      const reelIdentityPrefix = brandRefImgs.length > 0 ? PRODUCT_IDENTITY_LOCK : '';

      // Generate 1st-scene thumbnail for every reel in background
      const reelItems = planned.filter(item => item.format === 'reel');
      for (const reel of reelItems) {
        try {
          const scene1Match = reel.idea.match(/Scene 1:\s*([^.]+)/i);
          const sceneDesc = scene1Match
            ? scene1Match[1].trim()
            : reel.idea.split('.')[0].trim();
          const imgPrompt = `${reelIdentityPrefix}${sceneDesc}, ${brand.visual_style} aesthetic, ${(brand.colors || [])[0] || ''} dominant color, vertical 9:16 social media visual, professional photography, no text overlay`;

          const imgs = await generateImage({
            prompt: imgPrompt,
            model: NB2,
            aspectRatio: '9:16',
            quality: '1K',
            baseImages: brandRefImgs,
            temperature: brandRefImgs.length > 0 ? 0.1 : undefined,
            userId,
            saveToGallery: false,
            autoDownload: false,
          });

          if (imgs[0]) {
            await upsertSlot(userId, brand.id, reel.date, 'reel', { generated_image: imgs[0] });
            setSlots(prev =>
              prev.map(s =>
                s.slot_date === reel.date && s.format === 'reel'
                  ? { ...s, generated_image: imgs[0] }
                  : s
              )
            );
          }
        } catch (err) {
          console.warn('[Brand] Reel thumbnail failed:', reel.date, err);
        }
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (err) {
      console.error('[Brand] Agent calendar generation failed:', err);
      setPopulatingCalendar(false);
    }
  };

  // ── Batch Generate All Content ──────────────────────────────────────────────
  const handleGenerateAllContent = async () => {
    if (!brand || !userId || batchRunning) return;

    // Collect slots that need generation (have idea/brief but no generated content)
    const eligible = slots.filter(s =>
      (s.idea || s.brief) && !s.generated_image && s.status !== 'generated' && s.status !== 'approved'
    );
    if (eligible.length === 0) return;

    // Sort: posts first, then stories, then reels (reels take longest)
    const formatOrder: Record<string, number> = { post: 0, story: 1, reel: 2 };
    eligible.sort((a, b) => {
      const fo = (formatOrder[a.format] ?? 9) - (formatOrder[b.format] ?? 9);
      return fo !== 0 ? fo : a.slot_date.localeCompare(b.slot_date);
    });

    const abortCtrl = new AbortController();
    batchAbortRef.current = abortCtrl;
    setBatchRunning(true);
    setBatchProgress({ current: 0, total: eligible.length, currentDate: '', currentFormat: '', status: 'Starting...', imagesDone: 0, videosDone: 0, failed: 0 });

    // Resolve brand reference images once
    let brandRefImgs: string[] = [];
    try {
      brandRefImgs = await resolveBrandReferenceImages(brand);
    } catch { /* ignore */ }
    const identityPrefix = brandRefImgs.length > 0 ? PRODUCT_IDENTITY_LOCK : '';

    let imagesDone = 0;
    let videosDone = 0;
    let failed = 0;

    for (let i = 0; i < eligible.length; i++) {
      if (abortCtrl.signal.aborted) break;

      const slot = eligible[i];
      const dateLabel = new Date(slot.slot_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const formatLabel = slot.format.charAt(0).toUpperCase() + slot.format.slice(1);

      setBatchProgress(p => ({ ...p, current: i + 1, currentDate: dateLabel, currentFormat: formatLabel, status: slot.format === 'reel' ? 'Generating video...' : 'Generating image...' }));

      try {
        if (slot.format === 'reel') {
          // ── Generate VIDEO via Kling 3.0 Pro ──
          const prompt = slot.brief?.image_prompt || slot.idea || '';
          const modelId = 'fal-ai/kling-video/v3/pro/text-to-video';
          const input: Record<string, any> = {
            prompt: `${identityPrefix}${prompt}`,
            duration: '15',
            aspect_ratio: '9:16',
            generate_audio: true,
          };

          // If slot has a thumbnail, use image-to-video instead
          if (slot.generated_image) {
            try {
              const falUrl = await uploadToFalStorage(slot.generated_image);
              input.start_image_url = falUrl;
              // Switch to i2v model
              const i2vModel = 'fal-ai/kling-video/v3/pro/image-to-video';
              const videoUrl = await falGenerateVideo({
                modelId: i2vModel,
                input,
                onStatus: (_phase, msg) => {
                  if (msg) setBatchProgress(p => ({ ...p, status: msg }));
                },
                signal: abortCtrl.signal,
              });

              await saveVideoGeneration({
                id: `reel-${brand.id}-${slot.slot_date}`,
                url: videoUrl,
                prompt,
                modelName: 'Kling 3.0 Pro',
                aspectRatio: '9:16',
                createdAt: Date.now(),
              });
              await upsertSlot(userId, brand.id, slot.slot_date, 'reel', { status: 'generated' });
              setSlots(prev => prev.map(s => s.slot_date === slot.slot_date && s.format === 'reel' ? { ...s, status: 'generated' } : s));
              videosDone++;
            } catch (i2vErr) {
              // Fallback to text-to-video if i2v fails
              console.warn('[Batch] I2V failed, trying T2V:', i2vErr);
              delete input.start_image_url;
              const videoUrl = await falGenerateVideo({
                modelId,
                input,
                onStatus: (_phase, msg) => {
                  if (msg) setBatchProgress(p => ({ ...p, status: msg }));
                },
                signal: abortCtrl.signal,
              });

              await saveVideoGeneration({
                id: `reel-${brand.id}-${slot.slot_date}`,
                url: videoUrl,
                prompt,
                modelName: 'Kling 3.0 Pro',
                aspectRatio: '9:16',
                createdAt: Date.now(),
              });
              await upsertSlot(userId, brand.id, slot.slot_date, 'reel', { status: 'generated' });
              setSlots(prev => prev.map(s => s.slot_date === slot.slot_date && s.format === 'reel' ? { ...s, status: 'generated' } : s));
              videosDone++;
            }
          } else {
            // Pure text-to-video
            const videoUrl = await falGenerateVideo({
              modelId,
              input,
              onStatus: (_phase, msg) => {
                if (msg) setBatchProgress(p => ({ ...p, status: msg }));
              },
              signal: abortCtrl.signal,
            });

            await saveVideoGeneration({
              id: `reel-${brand.id}-${slot.slot_date}`,
              url: videoUrl,
              prompt,
              modelName: 'Kling 3.0 Pro',
              aspectRatio: '9:16',
              createdAt: Date.now(),
            });
            await upsertSlot(userId, brand.id, slot.slot_date, 'reel', { status: 'generated' });
            setSlots(prev => prev.map(s => s.slot_date === slot.slot_date && s.format === 'reel' ? { ...s, status: 'generated' } : s));
            videosDone++;
          }

          // Longer delay after video generation
          await new Promise(r => setTimeout(r, 2000));
        } else {
          // ── Generate STATIC IMAGE for post/story ──
          const aspectRatio = slot.format === 'story' ? '9:16' : '1:1';
          const prompt = slot.brief?.image_prompt || slot.idea || '';

          // Use slot's matched product as base image if available
          const slotProduct = slot.selected_product
            ? (brand.products || []).find(p => p.name.toLowerCase() === slot.selected_product!.toLowerCase())
            : null;

          let imgPrompt: string;
          let baseImgs = brandRefImgs;
          if (slotProduct?.imageDataUrl) {
            imgPrompt = `Edit this image. The ${slotProduct.name} must remain absolutely identical — same shape, packaging, colors, labels, proportions, and every detail. Do not alter the product in any way whatsoever. Change ONLY the background and surrounding scene to: ${prompt}`;
            baseImgs = [slotProduct.imageDataUrl];
          } else {
            imgPrompt = `${identityPrefix}${prompt}, ${brand.visual_style || ''} aesthetic, professional photography, no text overlay`;
          }

          const imgs = await generateImage({
            prompt: imgPrompt,
            model: NB2,
            aspectRatio,
            quality: '1K',
            baseImages: baseImgs,
            temperature: baseImgs.length > 0 ? 0.1 : undefined,
            userId,
            saveToGallery: false,
            autoDownload: false,
          });

          if (imgs[0]) {
            await upsertSlot(userId, brand.id, slot.slot_date, slot.format, {
              generated_image: imgs[0],
              status: 'generated',
            });
            setSlots(prev => prev.map(s =>
              s.slot_date === slot.slot_date && s.format === slot.format
                ? { ...s, generated_image: imgs[0], status: 'generated' }
                : s
            ));
            imagesDone++;
          } else {
            failed++;
          }

          // Short delay between image generations
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (err) {
        console.warn(`[Batch] Failed ${slot.format} for ${slot.slot_date}:`, err);
        failed++;
      }

      setBatchProgress(p => ({ ...p, imagesDone, videosDone, failed }));
    }

    // Done
    setBatchProgress(p => ({
      ...p,
      current: eligible.length,
      status: abortCtrl.signal.aborted ? 'Cancelled' : `Done! ${imagesDone} images, ${videosDone} videos generated${failed ? `, ${failed} failed` : ''}`,
      imagesDone,
      videosDone,
      failed,
    }));

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setBatchRunning(false);
      batchAbortRef.current = null;
    }, 5000);
  };

  const cancelBatch = () => {
    batchAbortRef.current?.abort();
  };

  const handleDownloadCalendar = () => {
    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = MONTH_NAMES[calMonth - 1];
    const byDate: Record<string, ContentSlot[]> = {};
    for (const slot of slots) {
      if (!byDate[slot.slot_date]) byDate[slot.slot_date] = [];
      byDate[slot.slot_date].push(slot);
    }
    const formatBadge = (f: string) =>
      f === 'reel' ? `<span style="background:#caff00;color:#000;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">REEL</span>`
        : f === 'story' ? `<span style="background:#a78bfa;color:#fff;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">STORY</span>`
          : `<span style="background:#3b82f6;color:#fff;padding:1px 7px;border-radius:999px;font-size:10px;font-weight:700">POST</span>`;

    const rows = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, daySlots]) => {
      const d = new Date(date + 'T00:00:00');
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
      const cells = daySlots.map(s =>
        `<div style="margin-bottom:6px">${formatBadge(s.format)}<p style="margin:4px 0 0;font-size:12px;color:#1f2937;line-height:1.4">${s.idea || 'No idea yet'}</p></div>`
      ).join('');
      return `<tr><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;vertical-align:top;white-space:nowrap;font-weight:600;font-size:13px;color:#374151;width:90px">${dayLabel}</td><td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">${cells}</td></tr>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${brand.name} — ${monthName} ${calYear} Campaign Calendar</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111;padding:40px}
@media print{body{padding:20px}.no-print{display:none}}</style></head>
<body>
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:32px;padding-bottom:16px;border-bottom:2px solid #111">
  <div>
    <div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#6b7280;text-transform:uppercase;margin-bottom:4px">Content Calendar</div>
    <h1 style="font-size:28px;font-weight:800">${brand.name}</h1>
    <p style="font-size:15px;color:#6b7280;margin-top:2px">${monthName} ${calYear} · ${slots.length} pieces</p>
  </div>
  <div style="display:flex;gap:6px">${(brand.colors || []).slice(0, 5).map(c => `<div style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid #e5e7eb"></div>`).join('')}</div>
</div>
<table style="width:100%;border-collapse:collapse">${rows}</table>
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af">
  Generated by Gods Eye Studio · ${brand.name} · ${new Date().toLocaleDateString()}
</div>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) setTimeout(() => win.print(), 600);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const handleAddImagesToDNA = (images: string[]) => {
    if (!brand) return;
    const updated = { ...brand, example_images: [...(brand.example_images || []), ...images].slice(0, 20) };
    setBrand(updated);
    saveBrandProfile(userId, dnaToProfile(profileToDNA(updated)));
  };

  const handleAddProduct = async () => {
    if (!brand || !newProductName.trim() || !newProductImage) return;
    const newProduct: BrandProduct = {
      id: crypto.randomUUID(),
      name: newProductName.trim(),
      imageDataUrl: newProductImage,
    };
    // Save image to localStorage
    saveProductImages([newProduct]);
    // Update brand profile with new product
    const updatedProducts = [...(brand.products || []), newProduct];
    const updated = { ...brand, products: updatedProducts };
    setBrand(updated);
    setBrands(prev => prev.map(b => b.id === updated.id ? updated : b));
    await saveBrandProfile(userId, dnaToProfile(profileToDNA(updated)));
    // Reset modal
    setNewProductName('');
    setNewProductImage(null);
    setShowAddProduct(false);
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (brand === undefined) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand" size={24} /></div>;
  }

  if (showWizard) {
    return <BrandWizard userId={userId} onComplete={handleWizardComplete} initialDNA={brand ? profileToDNA(brand) : undefined} />;
  }

  // ── Setup screen ──────────────────────────────────────────────────────────
  if (!brand) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-brand/10 border border-brand/20 mb-6">
          <Sparkles size={36} className="text-brand" />
        </div>
        <h1 className="text-3xl font-bold text-text-primary mb-3">Brand Studio</h1>
        <p className="text-text-secondary max-w-md mb-8 leading-relaxed">
          Enter your website URL and we'll scan it to build your complete Business DNA — then generate campaigns automatically.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-xl mb-10 text-left">
          {[
            { icon: '🧬', title: 'Business DNA', desc: 'AI scans your brand — colors, fonts, voice & values' },
            { icon: '📣', title: 'Campaign Ideas', desc: 'Instant campaign concepts based on your DNA' },
            { icon: '📅', title: 'Content Calendar', desc: 'Plan a full month of posts, stories & reels with AI' },
          ].map(f => (
            <div key={f.title} className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-4 hover:-translate-y-1 hover:shadow-lg hover:border-white/10 transition-all duration-300">
              <div className="text-2xl mb-2">{f.icon}</div>
              <div className="text-sm font-bold text-text-primary mb-1">{f.title}</div>
              <div className="text-xs text-text-secondary leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
        <button onClick={() => setShowWizard(true)} className="px-8 py-3 rounded-full bg-brand text-bg font-bold text-sm hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-brand/20 mb-8">
          Scan My Brand
        </button>
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col overflow-hidden pt-20">
      {/* Brand header bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 flex-shrink-0">
        <div className="flex gap-1.5">
          {(brand.colors || []).slice(0, 3).map(c => (
            <div key={c} className="w-4 h-4 rounded-full border border-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="flex-1 min-w-0 relative max-w-[240px]">
          <select
            value={brand.id}
            onChange={(e) => handleSwitchBrand(e.target.value)}
            className="w-full appearance-none bg-surface/50 border border-white/10 hover:border-white/20 text-sm font-bold text-text-primary pl-3 pr-8 py-1.5 rounded-xl outline-none transition-all cursor-pointer truncate"
          >
            {brands.map(b => (
              <option key={b.id} value={b.id} className="bg-[#1a1a1a] text-white">{b.name}</option>
            ))}
            <option disabled className="bg-[#1a1a1a] text-gray-500">──────────</option>
            <option value="NEW" className="bg-[#1a1a1a] text-white">+ Create New Brand</option>
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
        </div>
        <div className="hidden md:flex gap-1.5">
          {(brand.tone || []).slice(0, 3).map(t => (
            <span key={t} className="px-2 py-0.5 bg-white/5 backdrop-blur-md border border-white/10 text-text-secondary text-[10px] rounded-full">{t}</span>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-surface/40 backdrop-blur-md border border-white/5 rounded-full p-0.5">
          <button onClick={() => setActiveTab('campaigns')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'campaigns' ? 'bg-brand text-bg shadow-lg shadow-brand/20' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}>
            <Megaphone size={12} /> Campaigns
          </button>
          <button onClick={() => setActiveTab('calendar')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'calendar' ? 'bg-brand text-bg shadow-lg shadow-brand/20' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}>
            <Calendar size={12} /> Calendar
          </button>
          <button onClick={() => setActiveTab('social')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'social' ? 'bg-brand text-bg shadow-lg shadow-brand/20' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}>
            <Share2 size={12} /> Social
          </button>
          <button onClick={() => setActiveTab('ads')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-300 ${activeTab === 'ads' ? 'bg-brand text-bg shadow-lg shadow-brand/20' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}>
            <Megaphone size={12} /> Ad Campaigns
          </button>
        </div>

        {activeTab === 'calendar' && (
          <>
            <button
              onClick={() => setShowCampaignAgent(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand text-bg text-xs font-bold hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-brand/20"
            >
              <Zap size={12} /> New Campaign
            </button>
            {slots.length > 0 && (
              <>
                <button
                  onClick={handleDownloadCalendar}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5 text-text-secondary text-xs hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all"
                  title="Download calendar as PDF"
                >
                  <FileDown size={12} /> Download
                </button>
                <button
                  onClick={handleGenerateAllContent}
                  disabled={batchRunning}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-medium hover:text-violet-200 hover:border-violet-500/40 hover:bg-violet-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Generate images for posts/stories and videos for reels"
                >
                  {batchRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  Generate All Content
                </button>
              </>
            )}
          </>
        )}
        <button onClick={() => setShowAddProduct(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.03] border border-white/5 text-text-secondary text-xs hover:text-white hover:border-white/20 hover:bg-white/[0.06] transition-all">
          <Plus size={12} /> Product
        </button>
        <button onClick={() => setShowWizard(true)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-text-primary hover:bg-white/[0.06] hover:border-white/10 transition-all" title="Edit Brand DNA">
          <Edit3 size={14} />
        </button>
        <button onClick={handleDeleteBrand} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-red-400 hover:border-red-900/50 hover:bg-red-500/5 transition-all">
          <Trash2 size={14} />
        </button>
      </div>

      {/* ── Campaigns tab ─────────────────────────────────────────────────── */}
      {activeTab === 'campaigns' && (
        <div className="flex-1 w-full overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="text-center space-y-2 pt-8 pb-4">
              <h2 className="text-xl font-bold text-text-primary">Campaign Studio</h2>
              <p className="text-sm text-text-secondary">Launch campaigns and generate content for {brand.name}</p>
            </div>

            {/* Quick Actions Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setShowCampaignAgent(true);
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl bg-brand/5 border border-brand/20 hover:bg-brand/10 hover:border-brand/40 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-brand/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Zap size={18} className="text-brand" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">New Campaign</p>
                  <p className="text-xs text-text-secondary mt-0.5">Generate a full month of content with AI</p>
                </div>
              </button>

              <button
                onClick={() => {
                  setActiveTab('calendar');
                }}
                className="group flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Calendar size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">View Calendar</p>
                  <p className="text-xs text-text-secondary mt-0.5">See your content calendar and manage slots</p>
                </div>
              </button>

              <button
                onClick={() => setShowAddProduct(true)}
                className="group flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Plus size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Add Product</p>
                  <p className="text-xs text-text-secondary mt-0.5">Upload product images for branded content</p>
                </div>
              </button>

              <button
                onClick={() => setShowWizard(true)}
                className="group flex items-start gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                  <Edit3 size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">Edit Brand DNA</p>
                  <p className="text-xs text-text-secondary mt-0.5">Update colors, tone, audience, and style</p>
                </div>
              </button>
            </div>

            {/* Brand quick info */}
            {brand.products && brand.products.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-medium text-text-secondary uppercase tracking-widest">Products</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {brand.products.map((p: any, i: number) => (
                    <div key={i} className="rounded-xl border border-white/5 overflow-hidden bg-white/[0.02]">
                      {p.image && <img src={p.image} alt={p.name} className="w-full aspect-square object-cover" />}
                      <p className="text-[10px] text-text-secondary p-2 truncate">{p.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Calendar tab ──────────────────────────────────────────────────── */}
      {activeTab === 'calendar' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Campaign population banner */}
          {populatingCalendar && (
            <div className="flex items-center gap-3 px-6 py-3 bg-brand/10 border-b border-brand/20 flex-shrink-0">
              <Loader2 size={14} className="text-brand animate-spin flex-shrink-0" />
              <span className="text-brand text-xs font-medium">Generating your campaign calendar — filling this month with content ideas…</span>
            </div>
          )}

          {/* Batch generation progress bar */}
          {batchRunning && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[420px] bg-surface/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {batchProgress.current < batchProgress.total ? (
                    <Loader2 size={14} className="text-violet-400 animate-spin" />
                  ) : (
                    <Check size={14} className="text-emerald-400" />
                  )}
                  <span className="text-white text-sm font-medium">
                    {batchProgress.currentFormat} {batchProgress.current}/{batchProgress.total}
                    {batchProgress.currentDate && <span className="text-text-secondary ml-1">— {batchProgress.currentDate}</span>}
                  </span>
                </div>
                {batchProgress.current < batchProgress.total && (
                  <button
                    onClick={cancelBatch}
                    className="text-text-secondary hover:text-red-400 transition-colors p-1"
                    title="Cancel batch generation"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 mb-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-brand transition-all duration-500"
                  style={{ width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-xs">{batchProgress.status}</span>
                <div className="flex items-center gap-3 text-xs text-text-secondary">
                  {batchProgress.imagesDone > 0 && <span>{batchProgress.imagesDone} images</span>}
                  {batchProgress.videosDone > 0 && <span>{batchProgress.videosDone} videos</span>}
                  {batchProgress.failed > 0 && <span className="text-red-400">{batchProgress.failed} failed</span>}
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 flex overflow-hidden">
            <div className={`flex-1 overflow-hidden p-6 transition-all duration-300 ${selectedSlot ? 'max-w-[65%]' : 'max-w-full'}`}>
              {loadingSlots ? (
                <div className="h-full flex items-center justify-center"><Loader2 className="animate-spin text-brand" size={20} /></div>
              ) : (
                <BrandCalendar
                  year={calYear} month={calMonth} slots={slots}
                  onMonthChange={(y, m) => { setCalYear(y); setCalMonth(m); }}
                  onSlotClick={(date, format, existing) => setSelectedSlot({ date, format, existing })}
                />
              )}
            </div>
            {selectedSlot && (
              <div className="w-[35%] min-w-[300px] max-w-sm border-l border-white/5 bg-panel/80 backdrop-blur-xl overflow-hidden flex flex-col">
                <SlotPanel
                  brand={brand} userId={userId}
                  slotDate={selectedSlot.date} format={selectedSlot.format} existing={selectedSlot.existing}
                  onClose={() => setSelectedSlot(null)}
                  onSaved={saved => {
                    setSlots(prev => {
                      const idx = prev.findIndex(s => s.id === saved.id);
                      if (idx >= 0) return prev.map((s, i) => i === idx ? saved : s);
                      return [...prev, saved];
                    });
                    setSelectedSlot(sel => sel ? { ...sel, existing: saved } : sel);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Social Accounts tab ───────────────────────────────────────────── */}
      {activeTab === 'social' && (
        <div className="flex-1 overflow-y-auto px-6">
          <SocialAccountsPanel brandName={brand.name} />
        </div>
      )}

      {/* ── Ad Campaigns tab ───────────────────────────────────────────── */}
      {activeTab === 'ads' && (
        <div className="flex-1 overflow-y-auto">
          <AdCampaignsDashboard brandId={brand?.id} />
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Campaign Agent — shown automatically after DNA setup or via New Campaign button */}
      {showCampaignAgent && brand && (
        <BrandCampaignAgent
          brandName={brand.name}
          onComplete={handleAgentComplete}
          onClose={() => setShowCampaignAgent(false)}
        />
      )}

      {/* Add Product Modal */}
      {showAddProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowAddProduct(false)}>
          <div className="w-full max-w-sm bg-panel/80 backdrop-blur-2xl border border-white/5 rounded-3xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-text-primary">Add Product</h3>
              <button onClick={() => setShowAddProduct(false)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-text-secondary hover:text-white transition-all">
                <X size={14} />
              </button>
            </div>

            {/* Product image upload */}
            <button
              onClick={() => addProductFileRef.current?.click()}
              className="w-full aspect-square rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] flex flex-col items-center justify-center gap-2 hover:border-brand/30 hover:bg-brand/5 transition-all overflow-hidden mb-4"
            >
              {newProductImage ? (
                <img src={newProductImage} alt="Product" className="w-full h-full object-cover rounded-2xl" />
              ) : (
                <>
                  <Upload size={24} className="text-text-secondary" />
                  <span className="text-xs text-text-secondary">Upload product photo</span>
                </>
              )}
            </button>
            <input ref={addProductFileRef} type="file" accept="image/*" className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = ev => setNewProductImage(ev.target!.result as string);
              r.readAsDataURL(f);
            }} />

            {/* Product name */}
            <input
              type="text"
              value={newProductName}
              onChange={e => setNewProductName(e.target.value)}
              placeholder="Product name (e.g. Signature Latte)"
              className="w-full bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 text-sm text-text-primary placeholder-text-secondary outline-none focus:border-brand/30 focus:ring-1 focus:ring-brand/20 transition-all mb-4"
            />

            <button
              onClick={handleAddProduct}
              disabled={!newProductName.trim() || !newProductImage}
              className="w-full py-3 rounded-xl bg-brand text-bg font-bold text-sm hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-brand/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Product
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
