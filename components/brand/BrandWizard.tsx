import React, { useState, useRef } from 'react';
import { Link, Globe, Loader2, Check, Upload, X, Plus, Edit2, Sparkles, ArrowRight, Package, ImageIcon, Tag, Target, ChevronDown } from 'lucide-react';
import { BrandDNA, BrandProduct, BrandCompetitor } from '../../types/brand.types';
import { scanWebsiteForBrandDNA, saveProductImages, extractVisualAesthetic } from '../../services/brandService';

type WizardStep = 'url' | 'scanning' | 'dna';

interface Props {
  userId: string;
  onComplete: (dna: BrandDNA) => Promise<void>;
  initialDNA?: BrandDNA;
}

const TagPill: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-surface border border-border rounded-full text-xs text-text-secondary">
    {label}
    <button onClick={onRemove} className="text-text-secondary hover:text-red-400 transition-colors ml-0.5">
      <X size={10} />
    </button>
  </span>
);

const AddTagInput: React.FC<{ onAdd: (tag: string) => void; placeholder: string }> = ({ onAdd, placeholder }) => {
  const [val, setVal] = useState('');
  return (
    <input
      value={val}
      onChange={e => setVal(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && val.trim()) { onAdd(val.trim()); setVal(''); }
      }}
      placeholder={placeholder}
      className="px-2 py-1 text-xs bg-surface border border-dashed border-border rounded-full text-text-secondary placeholder-text-secondary/50 focus:outline-none focus:border-brand w-28"
    />
  );
};

/** Single image tile used in both product and lifestyle grids */
const ImageTile: React.FC<{
  img: string;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onMoveLabel: string;
  onMove: () => void;
}> = ({ img, selected, onToggle, onRemove, onMoveLabel, onMove }) => (
  <div
    onClick={onToggle}
    className={`relative group aspect-square rounded-xl overflow-hidden cursor-pointer transition-all duration-150 ${selected ? 'border-2 border-brand ring-1 ring-brand/50' : 'border-2 border-transparent opacity-40 hover:opacity-70'
      }`}
  >
    <img
      src={img}
      alt=""
      className="w-full h-full object-cover"
      onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
    />
    {/* Selected checkmark */}
    <div className={`absolute top-1 right-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selected ? 'bg-brand border-brand' : 'bg-black/50 border-white/40'
      }`}>
      {selected && <Check size={10} className="text-bg" />}
    </div>
    {/* Hover actions */}
    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-1">
      <button
        onClick={e => { e.stopPropagation(); onMove(); }}
        className="w-full text-[9px] font-bold bg-brand/90 text-bg rounded-md py-1 px-1.5 hover:bg-brand transition-colors truncate"
      >
        {onMoveLabel}
      </button>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        className="w-full text-[9px] font-bold bg-red-700/90 text-white rounded-md py-1 px-1.5 hover:bg-red-600 transition-colors"
      >
        Remove
      </button>
    </div>
  </div>
);

export const BrandWizard: React.FC<Props> = ({ userId, onComplete, initialDNA }) => {
  const [step, setStep] = useState<WizardStep>(initialDNA ? 'dna' : 'url');
  const [url, setUrl] = useState(initialDNA?.website_url || '');
  const [urlError, setUrlError] = useState('');
  const [scanProgress, setScanProgress] = useState('Analyzing your website…');
  const [dna, setDna] = useState<BrandDNA | null>(initialDNA || null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const productFileRef = useRef<HTMLInputElement>(null);
  const lifestyleFileRef = useRef<HTMLInputElement>(null);
  const logoFileRef = useRef<HTMLInputElement>(null);

  // Product naming state — each scraped product image gets a user-assigned name
  // { imageDataUrl, name } — named ones become BrandProduct on save
  const [productEntries, setProductEntries] = useState<Array<{ imageDataUrl: string; name: string }>>([]);

  // ── Social presence + Competitors (new fields for Scout agent) ────────────
  const [socialHandles, setSocialHandles] = useState({
    instagram: initialDNA?.instagram_handle || '',
    tiktok: initialDNA?.tiktok_handle || '',
    facebook: initialDNA?.facebook_url || '',
    youtube: initialDNA?.youtube_handle || '',
    linkedin: initialDNA?.linkedin_handle || '',
    x: initialDNA?.x_handle || '',
    pinterest: initialDNA?.pinterest_handle || '',
    threads: initialDNA?.threads_handle || '',
  });
  const [competitors, setCompetitors] = useState<BrandCompetitor[]>(initialDNA?.competitors || []);
  const [newComp, setNewComp] = useState({
    name: '', website: '',
    instagram: '', tiktok: '', facebook: '', youtube: '',
    linkedin: '', x: '', pinterest: '', threads: ''
  });
  const [compSocialOpen, setCompSocialOpen] = useState(false);

  // Product entries are now populated directly in handleScan — no useEffect needed

  // Lifestyle images selection (unchanged)
  const [selectedLifestyle, setSelectedLifestyle] = useState<Set<string>>(new Set());
  const prevLifestyleRef = React.useRef<string>('');
  React.useEffect(() => {
    if (!dna) return;
    const key = (dna.lifestyle_images?.join('|') || '');
    if (key === prevLifestyleRef.current) return;
    prevLifestyleRef.current = key;
    setSelectedLifestyle(new Set(dna.lifestyle_images || []));
  }, [dna?.lifestyle_images]);

  const patch = (p: Partial<BrandDNA>) => setDna(d => d ? { ...d, ...p } : d);

  const handleScan = async () => {
    const cleaned = url.trim();
    if (!cleaned) { setUrlError('Please enter a website URL'); return; }
    const finalUrl = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
    setUrlError('');
    setStep('scanning');

    const messages = [
      'Connecting to website…',
      'Extracting CSS colors & fonts…',
      'Classifying product images…',
      'Analyzing brand identity…',
      'Detecting values & tone…',
      'Generating Business DNA…',
    ];
    let i = 0;
    const interval = setInterval(() => { setScanProgress(messages[i % messages.length]); i++; }, 2500);

    try {
      const result = await scanWebsiteForBrandDNA(finalUrl);
      clearInterval(interval);

      // Build product entries from dna.products (named) + remaining product_images (unnamed)
      const entries: Array<{ imageDataUrl: string; name: string }> = [];
      const usedImages = new Set<string>();
      // Named products first (from Shopify API / JSON-LD)
      for (const p of (result.products || [])) {
        entries.push({ imageDataUrl: p.imageDataUrl, name: p.name });
        usedImages.add(p.imageDataUrl);
      }
      // Remaining product images without names
      for (const img of (result.product_images || [])) {
        if (!usedImages.has(img)) {
          entries.push({ imageDataUrl: img, name: '' });
          usedImages.add(img);
        }
      }
      setProductEntries(entries.slice(0, 12));

      setDna(result);
      setStep('dna');
    } catch (err: any) {
      clearInterval(interval);
      setUrlError(err.message || 'Scan failed. Please try again.');
      setStep('url');
    }
  };

  const handleFileUpload = (bucket: 'product' | 'lifestyle') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    Promise.all(files.map(f => new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = ev => res(ev.target!.result as string); r.onerror = rej; r.readAsDataURL(f);
    }))).then(dataUrls => {
      if (bucket === 'product') {
        setProductEntries(prev => [...prev, ...dataUrls.map(u => ({ imageDataUrl: u, name: '' }))]);
      } else {
        patch({ lifestyle_images: [...(dna?.lifestyle_images || []), ...dataUrls].slice(0, 20) });
        setSelectedLifestyle(prev => { const n = new Set(prev); dataUrls.forEach(u => n.add(u)); return n; });
      }
    });
    e.target.value = '';
  };

  const removeFromLifestyle = (img: string) => {
    patch({ lifestyle_images: (dna?.lifestyle_images || []).filter(u => u !== img) });
    setSelectedLifestyle(prev => { const n = new Set(prev); n.delete(img); return n; });
  };

  const moveToProduct = (img: string) => {
    removeFromLifestyle(img);
    setProductEntries(prev => [...prev, { imageDataUrl: img, name: '' }]);
  };

  const handleFinish = async () => {
    if (!dna) return;
    setSaveError('');
    setSaving(true);
    try {
      const named = productEntries.filter(p => p.name.trim());

      // Build products — base64 images go to localStorage, HTTP URLs go to DB as-is
      const namedProducts: BrandProduct[] = named.map(p => {
        const id = crypto.randomUUID();
        const isBase64 = p.imageDataUrl.startsWith('data:');
        return {
          id,
          name: p.name.trim(),
          // HTTP URLs are short — store directly. Base64 stays in localStorage only.
          imageDataUrl: isBase64 ? `local:${id}` : p.imageDataUrl,
        };
      });

      // Save base64 images to localStorage keyed by product ID
      saveProductImages(
        named.map((p, i) => ({ id: namedProducts[i].id, imageDataUrl: p.imageDataUrl }))
      );

      const finalLifestyleImages = (dna.lifestyle_images || []).filter(u => selectedLifestyle.has(u));
      const productUrls = namedProducts.map(p => p.imageDataUrl);

      // --- THE DISTILLATION ENGINE (Visual RAG) ---
      // Instead of saving heavy base64 lifestyle images to IDB (which breaks OPFS ZIPs and API limits),
      // we extract their aesthetic rules to text using Gemini Vision, and discard the heavy raw images.
      let visualRules = '';
      if (finalLifestyleImages.length > 0) {
        setScanProgress('Distilling aesthetics from your uploaded images...');
        visualRules = await extractVisualAesthetic(finalLifestyleImages);
      }

      const finalDna: BrandDNA = {
        ...dna,
        products: namedProducts,
        product_images: productUrls,
        // We throw away the massive Base64 arrays to keep the Backup ZIP tiny!
        lifestyle_images: [],
        example_images: [...productUrls],
        visual_style_rules: visualRules,
        // Social presence + competitors (for Scout agent)
        instagram_handle: socialHandles.instagram.replace('@', '').trim() || undefined,
        tiktok_handle: socialHandles.tiktok.replace('@', '').trim() || undefined,
        facebook_url: socialHandles.facebook.trim() || undefined,
        youtube_handle: socialHandles.youtube.replace('@', '').trim() || undefined,
        linkedin_handle: socialHandles.linkedin.trim() || undefined,
        x_handle: socialHandles.x.replace('@', '').trim() || undefined,
        pinterest_handle: socialHandles.pinterest.replace('@', '').trim() || undefined,
        threads_handle: socialHandles.threads.replace('@', '').trim() || undefined,
        competitors: competitors.length ? competitors : undefined,
      };
      await onComplete(finalDna);
    } catch (err: any) {
      const msg = err?.message || JSON.stringify(err) || 'Unknown error';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  // ── Step: URL input ───────────────────────────────────────────────────────
  if (step === 'url') {
    return (
      <div className="h-full bg-bg flex items-center justify-center p-6 overflow-y-auto">
        <div className="w-full max-w-lg text-center space-y-8">
          <div className="space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand/10 border border-brand/20 mb-2">
              <Globe size={28} className="text-brand" />
            </div>
            <h1 className="text-3xl font-bold text-text-primary" style={{ fontFamily: 'serif' }}>
              Generating your Business DNA
            </h1>
            <p className="text-text-secondary text-sm leading-relaxed max-w-sm mx-auto">
              We scan your website CSS and HTML to extract real colors, fonts, product images, and brand identity — no guessing.
            </p>
          </div>

          <div className="bg-panel border border-border rounded-2xl p-6 space-y-4 text-left">
            <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest">
              Your Website URL
            </label>
            <div className="relative">
              <Link size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
              <input
                value={url}
                onChange={e => { setUrl(e.target.value); setUrlError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') handleScan(); }}
                placeholder="https://www.yourbrand.com"
                className="w-full bg-surface border border-border rounded-xl pl-9 pr-4 py-3 text-text-primary text-sm placeholder-text-secondary focus:outline-none focus:border-brand transition-colors"
              />
            </div>
            {urlError && <p className="text-red-400 text-xs">{urlError}</p>}
            <button
              onClick={handleScan}
              disabled={!url.trim()}
              className="w-full py-3 rounded-xl bg-brand text-bg font-bold text-sm hover:opacity-90 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              <Sparkles size={16} /> Scan My Brand
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: Scanning animation ───────────────────────────────────────────────
  if (step === 'scanning') {
    return (
      <div className="h-full bg-black flex items-center justify-center p-6">
        <div className="text-center space-y-8">
          <div className="relative w-64 mx-auto bg-panel/80 border border-border rounded-2xl p-8 shadow-2xl" style={{ boxShadow: '0 0 60px rgba(202,255,0,0.08)' }}>
            <h2 className="text-2xl font-bold text-text-primary mb-2" style={{ fontFamily: 'serif', fontStyle: 'italic' }}>
              Generating your Business DNA
            </h2>
            <p className="text-text-secondary text-xs leading-relaxed mb-6">
              Extracting real CSS colors, classifying images, and analyzing your brand identity.
            </p>
            <div className="flex items-center justify-center gap-2 bg-brand/10 border border-brand/30 rounded-full px-4 py-2 mb-4">
              <Loader2 size={13} className="text-brand animate-spin" />
              <span className="text-brand text-xs font-medium">{scanProgress}</span>
            </div>
            <div className="flex items-center justify-center gap-2 bg-surface border border-border rounded-full px-4 py-2">
              <Link size={12} className="text-text-secondary" />
              <span className="text-text-secondary text-xs truncate max-w-[180px]">{url}</span>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-text-secondary text-xs">
            <div className="w-4 h-4 rounded-full border-2 border-text-secondary/30 border-t-brand animate-spin" />
            About 3 minutes left
          </div>
        </div>
      </div>
    );
  }

  // ── Step: DNA Review ──────────────────────────────────────────────────────
  if (step === 'dna' && dna) {
    const lifestyleImages = dna.lifestyle_images || [];
    const namedCount = productEntries.filter(p => p.name.trim()).length;

    return (
      <div className="h-full bg-black flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto py-6 px-4">
          <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="text-2xl mb-2">🧬</div>
              <h1 className="text-3xl font-bold text-text-primary" style={{ fontFamily: 'serif', fontStyle: 'italic' }}>
                Your Business DNA
              </h1>
              <p className="text-text-secondary text-sm mt-2">
                Colors and fonts extracted directly from your CSS. Review and edit anything below.
              </p>
            </div>

            <div className="bg-panel border border-border rounded-2xl overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">

                {/* ── Left: Brand details ─────────────────────────────────── */}
                <div className="p-6 space-y-5">
                  {/* Brand name + URL */}
                  <div>
                    <input
                      value={dna.name}
                      onChange={e => patch({ name: e.target.value })}
                      className="text-2xl font-bold text-text-primary bg-transparent border-none outline-none w-full focus:underline"
                    />
                    <div className="flex items-center gap-1.5 mt-1">
                      <Link size={12} className="text-text-secondary" />
                      <span className="text-text-secondary text-xs">{dna.website_url}</span>
                    </div>
                  </div>

                  {/* Logo + Font preview */}
                  <div className="bg-surface rounded-xl p-4 grid grid-cols-2 gap-4">
                    <div
                      className="flex flex-col items-center justify-center gap-2 border border-border rounded-lg p-3 cursor-pointer hover:border-brand transition-colors group relative"
                      onClick={() => logoFileRef.current?.click()}
                      title="Click to upload your logo"
                    >
                      <span className="text-text-secondary text-[10px] font-bold uppercase tracking-widest">Logo</span>
                      {dna.logo_url ? (
                        <img src={dna.logo_url} alt="logo" className="h-8 max-w-full object-contain" onError={() => patch({ logo_url: '' })} />
                      ) : (
                        <div className="text-sm font-bold text-text-primary text-center leading-tight">{dna.name}</div>
                      )}
                      <span className="text-[9px] text-text-secondary group-hover:text-brand transition-colors flex items-center gap-0.5">
                        <Upload size={8} /> {dna.logo_url ? 'Change' : 'Upload'}
                      </span>
                      <input
                        ref={logoFileRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onClick={e => e.stopPropagation()}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const r = new FileReader();
                          r.onload = ev => patch({ logo_url: ev.target!.result as string });
                          r.readAsDataURL(f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-center justify-center gap-2 border border-border rounded-lg p-3">
                      <span className="text-text-secondary text-[10px] font-bold uppercase tracking-widest">Primary Font</span>
                      <div className="text-2xl font-medium text-brand">Aa</div>
                      <div className="text-text-secondary text-[10px] font-mono text-center leading-tight">{dna.fonts?.[0] || 'System Font'}</div>
                      {dna.fonts?.[1] && (
                        <div className="text-text-secondary text-[9px] opacity-60">{dna.fonts[1]}</div>
                      )}
                    </div>
                  </div>

                  {/* Colors — real CSS swatches */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-text-secondary text-xs font-medium">Brand Colors</p>
                      <span className="text-[9px] bg-brand/10 text-brand border border-brand/20 rounded-full px-2 py-0.5">from CSS</span>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {dna.colors.map((c, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          <div
                            className="w-10 h-10 rounded-full border-2 border-border cursor-pointer hover:ring-2 ring-white/20 shadow-sm"
                            style={{ backgroundColor: c }}
                            title={c}
                          />
                          <span className="text-[9px] text-text-secondary font-mono">{c}</span>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const hex = prompt('Enter hex color (#rrggbb)');
                          if (hex && /^#[0-9a-fA-F]{6}$/.test(hex)) patch({ colors: [...dna.colors, hex] });
                        }}
                        className="w-10 h-10 rounded-full border-2 border-dashed border-border flex items-center justify-center text-text-secondary hover:border-brand hover:text-brand transition-colors"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Tagline */}
                  <div>
                    <p className="text-text-secondary text-xs font-medium mb-1">Tagline</p>
                    <textarea
                      value={dna.tagline}
                      onChange={e => patch({ tagline: e.target.value })}
                      rows={2}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-brand italic focus:outline-none focus:border-brand resize-none"
                    />
                  </div>

                  {/* Brand values */}
                  <div>
                    <p className="text-text-secondary text-xs font-medium mb-2 flex items-center gap-1">
                      Brand values <Edit2 size={10} className="text-text-secondary" />
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {dna.brand_values.map((v, i) => (
                        <TagPill key={i} label={v} onRemove={() => patch({ brand_values: dna.brand_values.filter((_, j) => j !== i) })} />
                      ))}
                      <AddTagInput onAdd={v => patch({ brand_values: [...dna.brand_values, v] })} placeholder="+ Add value" />
                    </div>
                  </div>

                  {/* Brand aesthetic */}
                  <div>
                    <p className="text-text-secondary text-xs font-medium mb-2">Brand aesthetic</p>
                    <div className="flex flex-wrap gap-2">
                      {dna.aesthetic.map((a, i) => (
                        <TagPill key={i} label={a} onRemove={() => patch({ aesthetic: dna.aesthetic.filter((_, j) => j !== i) })} />
                      ))}
                      <AddTagInput onAdd={a => patch({ aesthetic: [...dna.aesthetic, a] })} placeholder="+ Add" />
                    </div>
                  </div>

                  {/* Brand tone */}
                  <div>
                    <p className="text-text-secondary text-xs font-medium mb-2">Brand tone of voice</p>
                    <div className="flex flex-wrap gap-2">
                      {dna.tone.map((t, i) => (
                        <TagPill key={i} label={t} onRemove={() => patch({ tone: dna.tone.filter((_, j) => j !== i) })} />
                      ))}
                      <AddTagInput onAdd={t => patch({ tone: [...dna.tone, t] })} placeholder="+ Add tone" />
                    </div>
                  </div>

                  {/* Business overview */}
                  <div>
                    <p className="text-text-secondary text-xs font-medium mb-1">Business overview</p>
                    <textarea
                      value={dna.overview}
                      onChange={e => patch({ overview: e.target.value })}
                      rows={4}
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-brand resize-none"
                    />
                  </div>
                </div>

                {/* ── Right: Product + Lifestyle image buckets ────────────── */}
                <div className="p-6 flex flex-col gap-6">

                  {/* ── Your Products — name each one ───────────────────── */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Package size={13} className="text-brand" />
                        <p className="text-xs font-bold text-text-primary">Your Products</p>
                        <span className="text-[9px] bg-brand/10 text-brand border border-brand/20 rounded-full px-2 py-0.5">
                          name each one
                        </span>
                      </div>
                      <button
                        onClick={() => productFileRef.current?.click()}
                        className="flex items-center gap-1 text-[10px] text-brand border border-brand/30 rounded-full px-2.5 py-1 hover:bg-brand/10 transition-colors"
                      >
                        <Upload size={10} /> Upload photo
                      </button>
                    </div>

                    {productEntries.length === 0 && (
                      <div
                        onClick={() => productFileRef.current?.click()}
                        className="flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed border-border rounded-xl text-text-secondary text-xs cursor-pointer hover:border-brand hover:text-brand transition-colors"
                      >
                        <Upload size={18} />
                        <span>No products found on site — upload product photos</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      {productEntries.map((entry, i) => (
                        <div key={i} className="flex items-center gap-3 bg-surface border border-border rounded-xl p-2">
                          <img
                            src={entry.imageDataUrl}
                            alt=""
                            className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
                            onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                          />
                          <div className="flex-1 min-w-0">
                            <input
                              value={entry.name}
                              onChange={e => setProductEntries(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))}
                              placeholder="Name this product… e.g. Signature Latte"
                              className="w-full bg-transparent border-b border-border focus:border-brand text-sm text-text-primary placeholder-text-secondary/50 outline-none pb-0.5 transition-colors"
                            />
                            {entry.name.trim() && (
                              <div className="flex items-center gap-1 mt-1">
                                <Tag size={9} className="text-brand" />
                                <span className="text-[10px] text-brand">Will be used for content + locked in image gen</span>
                              </div>
                            )}
                            {!entry.name.trim() && (
                              <span className="text-[10px] text-text-secondary opacity-50">Add a name to include this product</span>
                            )}
                          </div>
                          <button
                            onClick={() => setProductEntries(prev => prev.filter((_, j) => j !== i))}
                            className="text-text-secondary hover:text-red-400 transition-colors flex-shrink-0"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>

                    <p className="text-[10px] text-text-secondary opacity-60 mt-2 leading-relaxed">
                      Named products are used for calendar content ideas and as the locked base image for generation — the AI will never change the product itself.
                    </p>
                  </div>

                  {/* Lifestyle Images bucket */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <ImageIcon size={13} className="text-text-secondary" />
                        <p className="text-xs font-bold text-text-primary">Brand Imagery</p>
                        <span className="text-[9px] bg-surface text-text-secondary border border-border rounded-full px-2 py-0.5">
                          style reference
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectedLifestyle(new Set(lifestyleImages))} className="text-[10px] text-text-secondary hover:text-brand transition-colors">All</button>
                        <span className="text-border">·</span>
                        <button onClick={() => setSelectedLifestyle(new Set())} className="text-[10px] text-text-secondary hover:text-red-400 transition-colors">None</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <button
                        onClick={() => lifestyleFileRef.current?.click()}
                        className="aspect-square rounded-xl bg-surface border border-dashed border-border flex flex-col items-center justify-center gap-1 text-text-secondary hover:border-brand hover:text-brand transition-colors"
                      >
                        <Upload size={14} />
                        <span className="text-[9px] font-medium">Upload</span>
                      </button>
                      {lifestyleImages.map((img, i) => (
                        <ImageTile
                          key={i}
                          img={img}
                          selected={selectedLifestyle.has(img)}
                          onToggle={() => {
                            setSelectedLifestyle(prev => { const n = new Set(prev); n.has(img) ? n.delete(img) : n.add(img); return n; });
                          }}
                          onRemove={() => removeFromLifestyle(img)}
                          onMoveLabel="→ Product"
                          onMove={() => moveToProduct(img)}
                        />
                      ))}
                      {lifestyleImages.length === 0 && (
                        <div className="col-span-3 flex items-center justify-center h-20 text-text-secondary text-xs opacity-50">
                          No lifestyle images found
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-text-secondary opacity-60 mt-1.5 leading-relaxed">
                      Hero shots, backgrounds, lifestyle photography. Hover an image to move it to Products if misclassified.
                    </p>
                  </div>

                  <input ref={productFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload('product')} />
                  <input ref={lifestyleFileRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileUpload('lifestyle')} />
                </div>
              </div>

              {/* ── Social Presence + Competitors (for Scout agent) ──────── */}
              <div className="pt-6 mt-6 border-t border-white/[0.05] space-y-5">
                {/* Social Presence — all platforms */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">📱</span>
                    <h3 className="text-sm font-bold text-text-primary">Your Social Presence</h3>
                  </div>
                  <p className="text-xs text-text-secondary/60 mb-3">Scout agent will research your social accounts to understand your current strategy across platforms.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { key: 'instagram' as const, emoji: '📸', label: 'Instagram', placeholder: '@handle', prefix: '@' },
                      { key: 'tiktok' as const, emoji: '🎵', label: 'TikTok', placeholder: '@handle', prefix: '@' },
                      { key: 'facebook' as const, emoji: '👤', label: 'Facebook', placeholder: 'URL or page name', prefix: '' },
                      { key: 'youtube' as const, emoji: '▶️', label: 'YouTube', placeholder: '@channel', prefix: '@' },
                      { key: 'linkedin' as const, emoji: '💼', label: 'LinkedIn', placeholder: 'URL or company name', prefix: '' },
                      { key: 'x' as const, emoji: '𝕏', label: 'X (Twitter)', placeholder: '@handle', prefix: '@' },
                      { key: 'pinterest' as const, emoji: '📌', label: 'Pinterest', placeholder: '@handle', prefix: '@' },
                      { key: 'threads' as const, emoji: '🧵', label: 'Threads', placeholder: '@handle', prefix: '@' },
                    ] as const).map(p => (
                      <div key={p.key} className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs">{p.emoji}</span>
                        <input
                          type="text"
                          value={socialHandles[p.key]}
                          onChange={e => setSocialHandles(prev => ({ ...prev, [p.key]: e.target.value }))}
                          placeholder={`${p.label}: ${p.placeholder}`}
                          className="w-full pl-8 pr-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-xs placeholder-text-secondary/40 focus:outline-none focus:border-brand/50 transition"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-text-secondary/40 mt-1.5">All optional. Instagram recommended.</p>
                </div>

                {/* Competitors */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={14} className="text-brand" />
                    <h3 className="text-sm font-bold text-text-primary">Competitors</h3>
                    <span className="text-[10px] text-text-secondary/40">({competitors.length} added)</span>
                  </div>
                  <p className="text-xs text-text-secondary/60 mb-3">Scout agent will scrape these competitors to find gaps and opportunities your brand can exploit.</p>

                  {/* Existing competitors */}
                  {competitors.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {competitors.map((c) => {
                        const handles = [
                          c.instagram && `📸 @${c.instagram}`,
                          c.tiktok && `🎵 @${c.tiktok}`,
                          c.facebook && `👤 ${c.facebook}`,
                          c.youtube && `▶️ @${c.youtube}`,
                          c.linkedin && `💼 ${c.linkedin}`,
                          c.x && `𝕏 @${c.x}`,
                          c.pinterest && `📌 @${c.pinterest}`,
                          c.threads && `🧵 @${c.threads}`,
                        ].filter(Boolean);
                        return (
                          <div key={c.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-border">
                            <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-xs">🏢</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-text-primary truncate">{c.name}</p>
                              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                {c.website && <span className="text-[10px] text-text-secondary/40 truncate">{c.website}</span>}
                                {handles.length > 0 && <span className="text-[10px] text-text-secondary/60">{handles.join(' · ')}</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => setCompetitors(prev => prev.filter(x => x.id !== c.id))}
                              className="text-text-secondary/60 hover:text-red-400 transition p-1"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Add competitor form */}
                  <div className="space-y-2 mb-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newComp.name}
                        onChange={e => setNewComp(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Brand name *"
                        className="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-xs placeholder-text-secondary/40 focus:outline-none focus:border-brand/50 transition"
                      />
                      <input
                        type="text"
                        value={newComp.website}
                        onChange={e => setNewComp(prev => ({ ...prev, website: e.target.value }))}
                        placeholder="website.com"
                        className="px-3 py-2 rounded-lg bg-surface border border-border text-text-primary text-xs placeholder-text-secondary/40 focus:outline-none focus:border-brand/50 transition"
                      />
                    </div>
                    {/* Collapsible social handles */}
                    <button
                      type="button"
                      onClick={() => setCompSocialOpen(prev => !prev)}
                      className="flex items-center gap-1.5 text-[10px] text-text-secondary/60 hover:text-text-secondary transition"
                    >
                      <ChevronDown size={10} className={`transition-transform ${compSocialOpen ? 'rotate-180' : ''}`} />
                      Social Handles {!compSocialOpen && '(expand)'}
                    </button>
                    {compSocialOpen && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {([
                          { key: 'instagram' as const, emoji: '📸', placeholder: '@instagram' },
                          { key: 'tiktok' as const, emoji: '🎵', placeholder: '@tiktok' },
                          { key: 'facebook' as const, emoji: '👤', placeholder: 'facebook URL' },
                          { key: 'youtube' as const, emoji: '▶️', placeholder: '@youtube' },
                          { key: 'linkedin' as const, emoji: '💼', placeholder: 'linkedin URL' },
                          { key: 'x' as const, emoji: '𝕏', placeholder: '@x_handle' },
                          { key: 'pinterest' as const, emoji: '📌', placeholder: '@pinterest' },
                          { key: 'threads' as const, emoji: '🧵', placeholder: '@threads' },
                        ] as const).map(p => (
                          <div key={p.key} className="relative">
                            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px]">{p.emoji}</span>
                            <input
                              type="text"
                              value={newComp[p.key]}
                              onChange={e => setNewComp(prev => ({ ...prev, [p.key]: e.target.value }))}
                              placeholder={p.placeholder}
                              className="w-full pl-7 pr-2 py-1.5 rounded-md bg-surface border border-border text-text-primary text-xs placeholder-text-secondary/40 focus:outline-none focus:border-brand/50 transition"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      if (!newComp.name.trim()) return;
                      setCompetitors(prev => [...prev, {
                        id: crypto.randomUUID(),
                        name: newComp.name.trim(),
                        website: newComp.website.trim() || undefined,
                        instagram: newComp.instagram.replace('@', '').trim() || undefined,
                        tiktok: newComp.tiktok.replace('@', '').trim() || undefined,
                        facebook: newComp.facebook.trim() || undefined,
                        youtube: newComp.youtube.replace('@', '').trim() || undefined,
                        linkedin: newComp.linkedin.trim() || undefined,
                        x: newComp.x.replace('@', '').trim() || undefined,
                        pinterest: newComp.pinterest.replace('@', '').trim() || undefined,
                        threads: newComp.threads.replace('@', '').trim() || undefined,
                      }]);
                      setNewComp({ name: '', website: '', instagram: '', tiktok: '', facebook: '', youtube: '', linkedin: '', x: '', pinterest: '', threads: '' });
                      setCompSocialOpen(false);
                    }}
                    disabled={!newComp.name.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand/10 text-brand text-xs font-bold hover:bg-brand/20 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <Plus size={12} /> Add Competitor
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky footer */}
        <div className="flex-shrink-0 border-t border-border px-4 py-3 bg-panel space-y-2">
          {saveError && (
            <div className="bg-red-950/60 border border-red-500/40 rounded-xl px-4 py-3">
              <p className="text-red-400 text-xs font-bold mb-1">Save failed</p>
              <pre className="text-red-300 text-[10px] whitespace-pre-wrap leading-relaxed">{saveError}</pre>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-text-secondary text-xs">Scout agent will research your brand + competitors next</span>
              <p className="text-text-secondary text-[10px] opacity-60">
                {namedCount} product{namedCount !== 1 ? 's' : ''} · {competitors.length} competitor{competitors.length !== 1 ? 's' : ''} · {Object.values(socialHandles).filter(v => v.trim()).length} platform{Object.values(socialHandles).filter(v => v.trim()).length !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={handleFinish}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-brand text-bg font-bold text-sm hover:opacity-90 transition-all disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              {saving ? 'Saving…' : 'Looks good'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
