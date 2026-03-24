
import React from 'react';
import { ArrowUpRight, Sparkles, Image, Video, Wand2, Maximize, Play, ChevronRight, Zap } from 'lucide-react';
import { EXPLORE_TOP_CHOICES, EXPLORE_VISUAL_EFFECTS } from '../constants';
import { Footer } from './Footer';

// --- Styled Components ---

const BentoCard: React.FC<{ 
  children: React.ReactNode; 
  className?: string;
  onClick?: () => void;
}> = ({ children, className = '', onClick }) => (
    <div 
        onClick={onClick}
        className={`bg-panel border border-border-base rounded-[32px] overflow-hidden relative group transition-all duration-500 hover:border-brand/40 hover:shadow-2xl hover:shadow-brand/5 ${className} ${onClick ? 'cursor-pointer' : ''}`}
    >
        {children}
    </div>
);

const HeroSection: React.FC = () => (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-auto lg:h-[65vh] min-h-[600px]">
        {/* Main Promo Card */}
        <BentoCard className="lg:col-span-9 relative flex items-end p-10 md:p-14 group cursor-pointer">
            <img 
                src="https://picsum.photos/1920/1080?random=hero" 
                alt="Hero" 
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105 will-change-transform"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
            <div className="absolute top-8 right-8 bg-[#FF3333] text-white text-xs font-bold px-4 py-2 rounded-full uppercase tracking-wider shadow-lg rotate-3 group-hover:rotate-6 transition-transform">
                Black Friday -67%
            </div>
            
            <div className="relative z-10 w-full max-w-4xl animate-slide-up">
                <div className="flex items-center gap-3 mb-6 opacity-0 translate-y-4 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-500 delay-100">
                    <span className="bg-white/10 backdrop-blur-xl border border-white/20 text-white text-[10px] font-mono px-3 py-1.5 rounded-lg tracking-wider">PROMO . v2</span>
                </div>
                <h1 className="text-5xl md:text-7xl lg:text-8xl font-black text-white uppercase leading-[0.85] tracking-tighter mb-6 drop-shadow-2xl">
                    Unleash<br/> Creative <span className="text-brand">Power</span>
                </h1>
                <p className="text-neutral-300 text-base md:text-lg font-medium max-w-xl leading-relaxed opacity-90">
                    Get unlimited access to Nano Banana Pro and our new video generation models for one year.
                </p>
            </div>
        </BentoCard>

        {/* Secondary Vertical Stack */}
        <div className="lg:col-span-3 flex flex-col gap-6">
            <BentoCard className="flex-1 p-8 relative bg-surface dark:bg-[#0A0A0A] group border-border-base dark:border-white/5 hover:border-brand/50 cursor-pointer">
                <div className="absolute top-0 right-0 p-8 opacity-50 group-hover:opacity-100 transition-opacity">
                    <ArrowUpRight size={28} className="text-brand" />
                </div>
                <div className="h-full flex flex-col justify-end relative z-10">
                    <div className="w-16 h-16 rounded-2xl bg-brand flex items-center justify-center mb-6 text-bg shadow-lg shadow-brand/20 group-hover:scale-110 transition-transform">
                        <Zap size={32} fill="currentColor" />
                    </div>
                    <h3 className="text-text-primary dark:text-white text-3xl font-bold uppercase tracking-tight mb-2">Kling 2.6</h3>
                    <p className="text-text-secondary dark:text-neutral-400 text-sm leading-relaxed">Video generation with audio sync.</p>
                </div>
                {/* Abstract bg element */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 bg-brand/5 dark:bg-brand/10 blur-[80px] rounded-full pointer-events-none group-hover:bg-brand/10 dark:group-hover:bg-brand/20 transition-colors" />
            </BentoCard>

            <BentoCard className="h-[200px] p-8 flex flex-row items-center justify-between bg-surface dark:bg-[#0A0A0A] group hover:bg-black/5 dark:hover:bg-[#111] border-border-base dark:border-white/5 hover:border-brand/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-6">
                    <div className="w-14 h-14 rounded-full bg-white dark:bg-surface border border-border-base dark:border-white/10 flex items-center justify-center group-hover:bg-text-primary group-hover:text-bg transition-all">
                        <Wand2 size={24} />
                    </div>
                    <div>
                        <h4 className="font-bold text-text-primary dark:text-white group-hover:text-brand uppercase text-lg tracking-wide transition-colors">Magic Edit</h4>
                        <p className="text-sm text-text-secondary dark:text-neutral-500 mt-1">Inpaint & Outpaint</p>
                    </div>
                </div>
                <ArrowUpRight size={24} className="text-text-secondary group-hover:text-text-primary dark:text-neutral-600 dark:group-hover:text-white transition-colors" />
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
    <BentoCard className="p-10 bg-panel border-border-base dark:border-white/5">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-6">
            <div>
                <h2 className="text-4xl font-black text-text-primary uppercase tracking-tighter mb-3">Visual Effects</h2>
                <p className="text-text-secondary text-base max-w-md leading-relaxed">Curated collection of cinematic transitions and VFX for your next project.</p>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2">
                 {['Trending', 'New', 'Cinematic', 'Glitch', '3D Render', 'Abstract'].map((tag, i) => (
                     <button key={tag} className={`px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-wider border transition-all whitespace-nowrap ${i === 0 ? 'bg-text-primary text-bg border-text-primary shadow-lg' : 'border-border-base text-text-secondary hover:border-text-primary hover:text-text-primary hover:bg-surface'}`}>
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
                            <Play size={24} fill="currentColor" className="ml-1"/>
                        </div>
                    </div>
                    {/* Info */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/90 via-black/60 to-transparent translate-y-4 group-hover:translate-y-0 transition-transform">
                        <span className="text-[10px] font-mono text-brand mb-1 block tracking-wider">VFX_00{i+1}</span>
                        <h4 className="text-white text-sm font-bold uppercase truncate">{effect}</h4>
                    </div>
                </div>
            ))}
        </div>
    </BentoCard>
);

export const ExplorePage: React.FC = () => {
  return (
    <div className="w-full min-h-screen animate-fade-in pb-20 text-text-primary">
      {/* Full width container with responsive padding */}
      <div className="w-full px-4 md:px-8 lg:px-12 space-y-16 pt-8">
        
        <HeroSection />
        
        <ToolsStrip />

        {/* Top Choice Horizontal Scroll */}
        <section>
             <div className="flex items-center justify-between mb-8 px-2">
                <h2 className="text-2xl font-black text-text-primary uppercase tracking-tight">Top Choices</h2>
                <button className="text-xs font-bold uppercase text-text-secondary hover:text-brand flex items-center gap-2 transition-colors tracking-widest group">
                    View All <span className="bg-surface p-1 rounded-full group-hover:bg-brand group-hover:text-bg transition-colors"><ChevronRight size={14}/></span>
                </button>
             </div>
             <div className="flex gap-6 overflow-x-auto pb-10 -mx-4 md:-mx-12 px-4 md:px-12 scrollbar-hide">
                 {EXPLORE_TOP_CHOICES.map((choice) => (
                     <BentoCard key={choice.id} className="min-w-[280px] md:min-w-[320px] aspect-[4/5] p-0 group">
                         <img src={choice.image} alt={choice.title} className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
                         <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-90" />
                         <div className="absolute top-4 left-4">
                             {choice.tag && (
                                 <span className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-lg ${choice.tag === 'UNLIMITED' ? 'bg-brand text-bg' : 'bg-white/10 backdrop-blur-md text-white border border-white/10'}`}>
                                     {choice.tag}
                                 </span>
                             )}
                         </div>
                         <div className="absolute bottom-6 left-6 right-6">
                             <h3 className="text-white font-bold text-xl leading-tight mb-2">{choice.title}</h3>
                             <p className="text-neutral-300 text-sm line-clamp-2 leading-relaxed">{choice.description}</p>
                         </div>
                     </BentoCard>
                 ))}
             </div>
        </section>

        <VisualEffectsSection />

        <div className="border-t border-border-base pt-16">
            <Footer />
        </div>
      </div>
    </div>
  );
};
