
import React, { useState, useEffect } from 'react';
import { ArrowUpRight, Sparkles, Image, Video, Wand2, Maximize, Play, ChevronRight, Zap, X } from 'lucide-react';
import { EXPLORE_TOP_CHOICES, EXPLORE_VISUAL_EFFECTS } from '../constants';
import { Footer } from './Footer';
import { getKlintProGallery, KlintProImage } from '../services/klintProGalleryService';
import { AppMode } from '../types';

// --- Styled Components ---

const BentoCard: React.FC<{
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
}> = ({ children, className = '', onClick }) => (
    <div
        onClick={onClick}
        className={`bg-panel/60 backdrop-blur-xl border border-white/5 rounded-[32px] overflow-hidden relative group hover:-translate-y-1 hover:border-white/10 hover:shadow-xl hover:shadow-brand/5 transition-all duration-300 ${className} ${onClick ? 'cursor-pointer' : ''}`}
    >
        {children}
    </div>
);

interface ExplorePageProps {
  onNavigate?: (mode: AppMode) => void;
}

const HeroSection: React.FC<{ onNavigate?: (mode: AppMode) => void }> = ({ onNavigate }) => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-auto lg:h-[65vh] min-h-[600px]">
        {/* Main Promo Card */}
        <BentoCard className="lg:col-span-9 relative flex items-end p-10 md:p-14 group cursor-pointer">
            <img
                src="https://picsum.photos/1920/1080?random=hero"
                alt="Hero"
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105 will-change-transform"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div 
                className="absolute top-8 right-8 bg-[#FF3333] text-white text-xs font-bold px-4 py-2 rounded-full uppercase tracking-wider shadow-lg"
                style={{
                    transform: 'rotate(3deg)',
                    transition: 'transform 0.3s ease-out'
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'rotate(6deg)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'rotate(3deg)'}
            >
                Black Friday -67%
            </div>

            <div className="relative z-10 w-full max-w-4xl animate-slide-up">
                <div className="flex items-center gap-3 mb-6 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-100">
                    <span className="bg-white/10 backdrop-blur-xl border border-white/20 text-white text-[10px] font-mono px-3 py-1.5 rounded-lg tracking-wider">PROMO . v2</span>
                </div>
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-white uppercase leading-[0.85] tracking-tighter mb-6 drop-shadow-2xl">
                    Unleash<br /> Creative <span className="text-brand">Power</span>
                </h1>
                <p className="text-neutral-300 text-base md:text-lg font-medium max-w-xl leading-relaxed opacity-90">
                    Get unlimited access to Nano Banana Pro and our new video generation models for one year.
                </p>
            </div>
        </BentoCard>

        {/* Secondary Vertical Stack */}
        <div className="lg:col-span-3 flex flex-col gap-6">
            <BentoCard 
                className="flex-1 p-8 relative group hover:border-brand/50 cursor-pointer"
                onClick={() => onNavigate?.(AppMode.IMAGE)}
            >
                <div className="absolute top-0 right-0 p-8 opacity-50 group-hover:opacity-100 transition-opacity">
                    <ArrowUpRight size={28} className="text-brand" />
                </div>
                <div className="h-full flex flex-col justify-end relative z-10">
                    <div 
                        className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mb-6 text-bg shadow-lg shadow-brand/20"
                        style={{
                            transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        <Zap size={32} fill="currentColor" />
                    </div>
                    <h3 className="text-text-primary text-3xl font-bold uppercase tracking-tight mb-2">GODS EYE 2.1 PRO</h3>
                    <p className="text-text-secondary text-sm leading-relaxed">Video generation with audio sync.</p>
                </div>
                {/* Abstract bg element */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-brand/5 blur-[80px] rounded-full pointer-events-none group-hover:bg-brand/10 transition-colors" />
            </BentoCard>

            <BentoCard 
                className="h-[200px] p-8 flex flex-row items-center justify-between group hover:bg-black/5 dark:hover:bg-[#111] hover:border-brand/50 transition-colors cursor-pointer"
                onClick={() => onNavigate?.(AppMode.EDIT)}
            >
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 rounded-full bg-white/[0.03] border border-white/5 flex items-center justify-center group-hover:bg-text-primary group-hover:text-bg transition-all">
                        <Wand2 size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-text-primary group-hover:text-brand uppercase text-lg tracking-wide transition-colors">Magic Edit</h4>
                        <p className="text-sm text-text-secondary mt-1">Inpaint & Outpaint</p>
                    </div>
                </div>
                <ArrowUpRight size={24} className="text-text-secondary group-hover:text-text-primary transition-colors" />
            </BentoCard>
        </div>
    </div>
);

const ToolsStrip: React.FC = () => (
    <div className="relative">
        <div className="flex items-center justify-between mb-6 px-2">
            <h2 className="text-xs font-bold text-text-secondary font-mono uppercase tracking-[0.2em]">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
                { label: 'Text to Image', icon: Image, img: 'https://picsum.photos/600/600?random=tool1' },
                { label: 'Text to Video', icon: Video, img: 'https://picsum.photos/600/600?random=tool2' },
                { label: 'Generative Fill', icon: Wand2, img: 'https://picsum.photos/600/600?random=tool3' },
                { label: 'Upscale', icon: Maximize, img: 'https://picsum.photos/600/600?random=tool4' },
                { label: 'Character', icon: Sparkles, img: 'https://picsum.photos/600/600?random=tool5' },
                { label: 'View All', icon: ArrowUpRight, img: null, isAction: true },
            ].map((tool, i) => (
                <BentoCard key={i} className={`aspect-[4/3] relative p-6 flex flex-col justify-end border-transparent ${tool.isAction ? 'bg-surface hover:bg-brand hover:border-brand group' : 'hover:border-brand'} transition-transform hover:-translate-y-1`}>
                    {!tool.isAction && (
                        <>
                            <img src={tool.img!} alt={tool.label} className="absolute inset-0 w-full h-full object-cover opacity-50 grayscale group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-500 scale-100 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                        </>
                    )}
                    <div className="relative z-10">
                        <div className={`mb-3 ${tool.isAction ? 'text-text-primary group-hover:text-bg' : 'text-brand'}`}>
                            <tool.icon size={28} />
                        </div>
                        <span className={`text-sm font-bold uppercase tracking-wide ${tool.isAction ? 'text-text-primary group-hover:text-bg' : 'text-white'}`}>
                            {tool.label}
                        </span>
                    </div>
                </BentoCard>
            ))}
        </div>
    </div>
);

const VisualEffectsSection: React.FC = () => (
    <BentoCard className="p-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
            <div>
                <h2 className="text-4xl font-black text-text-primary uppercase tracking-tighter mb-3">Visual Effects</h2>
                <p className="text-text-secondary text-base max-w-md leading-relaxed">Curated collection of cinematic transitions and VFX for your next project.</p>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
                {['Trending', 'New', 'Cinematic', 'Glitch', '3D Render', 'Abstract'].map((tag, i) => (
                    <button key={tag} className={`px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider border transition-all whitespace-nowrap ${i === 0 ? 'bg-brand text-bg border-brand shadow-lg shadow-brand/20' : 'border-white/10 text-text-secondary hover:border-white/20 hover:text-text-primary hover:bg-white/5 backdrop-blur-md'}`}>
                        {tag}
                    </button>
                ))}
            </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {EXPLORE_VISUAL_EFFECTS.slice(0, 6).map((effect, i) => (
                <div key={i} className="group relative aspect-[9/16] rounded-2xl overflow-hidden cursor-pointer bg-surface border border-transparent hover:border-brand/50 transition-all shadow-md hover:shadow-xl">
                    <img
                        src={`https://picsum.photos/500/900?random=${i + 300}`}
                        alt={effect}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px] flex items-center justify-center">
                        <div className="w-14 h-14 rounded-full bg-brand text-bg flex items-center justify-center scale-50 group-hover:scale-100 transition-transform duration-300 shadow-xl">
                            <Play size={24} fill="currentColor" className="ml-1" />
                        </div>
                    </div>
                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent translate-y-4 group-hover:translate-y-0 transition-transform">
                        <span className="text-[10px] font-mono text-brand mb-1 block tracking-wider">VFX_00{i + 1}</span>
                        <h4 className="text-white text-sm font-bold uppercase truncate">{effect}</h4>
                    </div>
                </div>
            ))}
        </div>
    </BentoCard>
);

interface KlintProGalleryProps {
    onNavigate?: (mode: AppMode) => void;
}

const KlintProGallery: React.FC<KlintProGalleryProps> = ({ onNavigate }) => {
    const [images, setImages] = useState<KlintProImage[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedImage, setSelectedImage] = useState<KlintProImage | null>(null);

    useEffect(() => {
        const loadGallery = async () => {
            setLoading(true);
            try {
                // Load all images without limit - will return all JSON images
                const galleryImages = await getKlintProGallery(999); // High limit to get all
                console.log('🖼️ Loaded gallery images:', galleryImages.length, galleryImages);
                if (galleryImages.length > 0) {
                    setImages(galleryImages);
                } else {
                    console.warn('⚠️ No images loaded, using fallback');
                    // Force fallback images
                    const fallback = await getKlintProGallery(999);
                    setImages(fallback);
                }
            } catch (error) {
                console.error('❌ Error loading Klint Pro gallery:', error);
                // Even on error, try to get fallback images
                try {
                    const fallback = await getKlintProGallery(999);
                    setImages(fallback);
                } catch (e) {
                    console.error('❌ Fallback also failed:', e);
                    setImages([]);
                }
            } finally {
                setLoading(false);
            }
        };
        loadGallery();
    }, []);

    // Get image URL - use directly from service
    const getImageUrl = (image: KlintProImage) => {
        return image.url;
    };

    if (loading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="aspect-[3/4] bg-white/[0.03] rounded-2xl animate-pulse border border-white/5" />
                ))}
            </div>
        );
    }

    if (images.length === 0) {
        return (
            <div className="text-center py-12 text-text-secondary">
                <p className="mb-4">No images available</p>
                <button 
                    onClick={() => window.location.reload()} 
                    className="px-4 py-2 bg-brand text-bg rounded-lg hover:opacity-90 transition-opacity"
                >
                    Reload Gallery
                </button>
            </div>
        );
    }

    const handleRecreate = () => {
        if (selectedImage && onNavigate) {
            // Store prompt in localStorage to auto-paste in image mode
            localStorage.setItem('klint_auto_prompt', selectedImage.prompt);
            setSelectedImage(null);
            onNavigate(AppMode.IMAGE);
        }
    };

    return (
        <>
            {/* Masonry Collage Layout */}
            <div 
                className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-4 space-y-4"
                style={{ columnFill: 'balance' }}
            >
                {images.map((image, index) => {
                    const imageUrl = getImageUrl(image);
                    // Skip only if both URL and prompt are missing
                    if (!imageUrl && !image.prompt) {
                        console.warn('⚠️ Image missing URL and prompt:', image);
                        return null;
                    }
                    // If no URL but has prompt, use a placeholder
                    const displayUrl = imageUrl || `https://picsum.photos/600/800?random=${index + 3000}`;
                    return (
                        <div 
                            key={image.id || `image-${index}`} 
                            className="relative break-inside-avoid mb-4 rounded-2xl overflow-hidden cursor-pointer bg-panel/60 backdrop-blur-md border border-white/5 group hover:border-white/10 hover:shadow-lg transition-all duration-300"
                            onClick={() => setSelectedImage(image)}
                            onMouseEnter={(e) => {
                                const img = e.currentTarget.querySelector('img');
                                if (img) {
                                    img.style.filter = 'brightness(0.7)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                const img = e.currentTarget.querySelector('img');
                                if (img) {
                                    img.style.filter = 'brightness(1)';
                                }
                            }}
                        >
                            <img 
                                src={displayUrl} 
                                alt="" 
                                className="w-full h-auto object-contain transition-all duration-300"
                                loading="lazy"
                                onError={(e) => {
                                    console.error('❌ Image failed to load:', displayUrl);
                                    (e.target as HTMLImageElement).src = `https://picsum.photos/600/800?random=${index + 2000}`;
                                }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Lightbox Modal */}
            {selectedImage && (
                <div 
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-md p-4 animate-fade-in"
                    onClick={() => setSelectedImage(null)}
                >
                    <div 
                        className="relative max-w-7xl w-full max-h-[95vh] bg-panel/80 backdrop-blur-2xl rounded-3xl overflow-hidden border border-white/5 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close Button */}
                        <button
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-black/70 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/90 transition-colors"
                        >
                            <X size={20} />
                        </button>

                        <div className="grid md:grid-cols-2 gap-0 h-full max-h-[95vh]">
                            {/* Image Side */}
                            <div className="relative bg-black flex items-center justify-center overflow-hidden">
                                <img 
                                    src={getImageUrl(selectedImage)} 
                                    alt={selectedImage.prompt} 
                                    className="w-full h-full max-h-[95vh] object-contain"
                                />
                            </div>

                            {/* Info Side */}
                            <div className="p-8 md:p-10 flex flex-col justify-between bg-panel overflow-y-auto max-h-[95vh]">
                                <div>
                                    <div className="mb-6">
                                        <div className="flex items-center gap-3 mb-4">
                                            <span className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-brand text-bg">
                                                GODS EYE COMMUNITY
                                            </span>
                                            <span className="text-xs text-text-secondary font-bold">Best of Creations</span>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <div>
                                            <label className="text-xs font-bold uppercase text-text-secondary tracking-wider mb-3 block">Prompt</label>
                                            <p className="text-text-primary text-base leading-relaxed bg-white/[0.03] backdrop-blur-md p-5 rounded-xl border border-white/5">
                                                {selectedImage.prompt || 'No prompt available for this image'}
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-6 text-sm text-text-secondary">
                                            <div>
                                                <span className="font-bold uppercase text-[10px] tracking-wider block mb-1">Model</span>
                                                <span className="text-text-primary">{selectedImage.model}</span>
                                            </div>
                                            <div>
                                                <span className="font-bold uppercase text-[10px] tracking-wider block mb-1">Aspect</span>
                                                <span className="text-text-primary">{selectedImage.aspectRatio}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Action Button */}
                                <div className="mt-8 pt-6 border-t border-white/5">
                                    <button
                                        onClick={handleRecreate}
                                        className="w-full h-14 bg-brand text-bg rounded-xl font-bold text-sm uppercase tracking-wider hover:bg-brand-hover transition-colors flex items-center justify-center gap-2 shadow-lg shadow-brand/20"
                                    >
                                        <Sparkles size={18} fill="currentColor" />
                                        Recreate
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export const ExplorePage: React.FC<ExplorePageProps> = ({ onNavigate }) => {
    return (
        <div className="w-full min-h-screen animate-fade-in pb-20 text-text-primary">
            {/* Full width container with responsive padding */}
            <div className="w-full px-4 md:px-8 lg:px-12 space-y-16 pt-40">

                <HeroSection onNavigate={onNavigate} />

                <ToolsStrip />

                {/* Klint Community - Best of Creations */}
                <section>
                    <div className="flex items-center justify-between mb-8 px-2">
                        <div>
                            <h2 className="text-2xl font-black text-text-primary uppercase tracking-tight mb-1">GODS EYE COMMUNITY</h2>
                            <p className="text-text-secondary text-sm">Best of Creations</p>
                        </div>
                        <button className="text-xs font-bold uppercase text-text-secondary hover:text-brand flex items-center gap-2 transition-colors tracking-widest group">
                            View All <span className="bg-surface p-1 rounded-full group-hover:bg-brand group-hover:text-bg transition-colors"><ChevronRight size={14} /></span>
                        </button>
                    </div>
                    <KlintProGallery onNavigate={onNavigate} />
                </section>

                <VisualEffectsSection />

                <div className="border-t border-white/5 pt-16">
                    <Footer />
                </div>
            </div>
        </div>
    );
};
