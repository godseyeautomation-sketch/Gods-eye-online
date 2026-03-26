import React, { useState } from 'react';
import {
  Clapperboard, Sparkles, ArrowRight, Clock, Users, Star,
  Wand2, Film, Camera, Palette, Music, Type, Layers, Zap,
  TrendingUp, Grid3X3, Box, Mic2, ScanSearch
} from 'lucide-react';

interface AppCard {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  status: 'live' | 'coming_soon' | 'beta';
  category: string;
  users?: string;
  rating?: number;
}

const APPS: AppCard[] = [
  {
    id: 'reel-studio',
    name: 'Reel Studio',
    description: 'Turn one image into a cinematic reel sequence. AI generates storyline, frames & exports video.',
    icon: <Clapperboard size={24} />,
    gradient: 'from-[#c8ff00] to-[#88cc00]',
    status: 'live',
    category: 'Video',
    users: '2.4k',
    rating: 4.8,
  },
  {
    id: 'image-to-prompt',
    name: 'Image to Prompt',
    description: 'Upload any image and get a detailed AI-ready prompt in Plain Text, JSON & YAML formats. One-click to generate.',
    icon: <ScanSearch size={24} />,
    gradient: 'from-blue-500 to-purple-500',
    status: 'live',
    category: 'Image',
    users: '1.8k',
    rating: 4.7,
  },
  {
    id: 'motion-poster',
    name: 'Motion Poster',
    description: 'Create eye-catching animated posters from static images with parallax and particle effects.',
    icon: <Film size={24} />,
    gradient: 'from-purple-500 to-pink-500',
    status: 'coming_soon',
    category: 'Video',
  },
  {
    id: 'product-shoot',
    name: 'Product Shoot',
    description: 'Studio-quality product photography with AI-generated backgrounds and lighting setups.',
    icon: <Camera size={24} />,
    gradient: 'from-blue-500 to-cyan-400',
    status: 'coming_soon',
    category: 'Image',
  },
  {
    id: 'brand-kit',
    name: 'Brand Kit Gen',
    description: 'Generate complete brand kits — logos, color palettes, typography, and social templates.',
    icon: <Palette size={24} />,
    gradient: 'from-orange-500 to-red-500',
    status: 'coming_soon',
    category: 'Design',
  },
  {
    id: 'audio-visualizer',
    name: 'Audio Visualizer',
    description: 'Turn music tracks into stunning visual animations synced to beats and rhythm.',
    icon: <Music size={24} />,
    gradient: 'from-emerald-500 to-teal-400',
    status: 'coming_soon',
    category: 'Video',
  },
  {
    id: 'type-magic',
    name: 'Type Magic',
    description: 'AI-powered typographic designs — animate text, generate kinetic typography reels.',
    icon: <Type size={24} />,
    gradient: 'from-yellow-400 to-orange-500',
    status: 'coming_soon',
    category: 'Design',
  },
  {
    id: 'layer-compose',
    name: 'Layer Compose',
    description: 'Intelligent multi-layer composition. Combine elements with AI-matched lighting & shadows.',
    icon: <Layers size={24} />,
    gradient: 'from-indigo-500 to-violet-500',
    status: 'coming_soon',
    category: 'Image',
  },
  {
    id: 'voice-over',
    name: 'Voice Over Studio',
    description: 'AI voice generation for reels. Pick a voice, paste your script, get natural narration.',
    icon: <Mic2 size={24} />,
    gradient: 'from-rose-500 to-pink-400',
    status: 'coming_soon',
    category: 'Audio',
  },
];

const CATEGORIES = ['All', 'Video', 'Image', 'Design', 'Audio'];

interface AppsPageProps {
  onOpenApp: (appId: string) => void;
}

export const AppsPage: React.FC<AppsPageProps> = ({ onOpenApp }) => {
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredApps = APPS.filter(app => {
    const matchesCategory = activeCategory === 'All' || app.category === activeCategory;
    const matchesSearch = !searchQuery || app.name.toLowerCase().includes(searchQuery.toLowerCase()) || app.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="h-full overflow-y-auto pt-20">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#c8ff00]/20 to-[#c8ff00]/5 border border-[#c8ff00]/30 flex items-center justify-center">
              <Zap size={18} className="text-[#c8ff00]" />
            </div>
            <h1 className="text-3xl font-black text-text-primary tracking-tight">Apps</h1>
          </div>
          <p className="text-sm text-text-secondary ml-[52px]">Specialized AI tools built for creators. One-click workflows for real results.</p>
        </div>

        {/* Search + Categories */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
          <input
            type="text"
            placeholder="Search apps..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full sm:w-64 bg-black/[0.03] dark:bg-white/[0.03] border border-border-base rounded-xl px-4 py-2.5 text-sm text-text-primary/80 placeholder-text-secondary/40 outline-none focus:border-border-base transition-colors"
          />
          <div className="flex gap-1.5 flex-wrap">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
                  activeCategory === cat
                    ? 'bg-[#c8ff00] text-black'
                    : 'bg-black/[0.04] dark:bg-white/[0.04] text-text-secondary hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-text-secondary'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* App Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredApps.map(app => (
            <button
              key={app.id}
              onClick={() => app.status === 'live' && onOpenApp(app.id)}
              disabled={app.status !== 'live'}
              className={`group relative text-left p-5 rounded-2xl border transition-all duration-300 ${
                app.status === 'live'
                  ? 'bg-black/[0.02] dark:bg-white/[0.02] border-black/[0.06] dark:border-white/[0.06] hover:bg-black/[0.05] dark:hover:bg-white/[0.05] hover:border-black/[0.12] dark:hover:border-white/[0.12] cursor-pointer'
                  : 'bg-black/[0.01] dark:bg-white/[0.01] border-black/[0.04] dark:border-white/[0.04] opacity-60 cursor-default'
              }`}
            >
              {/* Icon */}
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${app.gradient} flex items-center justify-center text-white mb-4 shadow-lg ${
                app.status === 'live' ? 'group-hover:scale-110 transition-transform' : ''
              }`}>
                {app.icon}
              </div>

              {/* Status badge */}
              <div className="absolute top-4 right-4">
                {app.status === 'live' ? (
                  <span className="px-2 py-0.5 rounded-full bg-[#c8ff00]/10 text-[#c8ff00] text-[9px] font-black uppercase tracking-wider border border-[#c8ff00]/20">
                    Live
                  </span>
                ) : app.status === 'beta' ? (
                  <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[9px] font-black uppercase tracking-wider border border-blue-500/20">
                    Beta
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-text-secondary/60 text-[9px] font-black uppercase tracking-wider border border-black/10 dark:border-white/10">
                    Soon
                  </span>
                )}
              </div>

              {/* Content */}
              <h3 className="text-sm font-bold text-text-primary mb-1.5">{app.name}</h3>
              <p className="text-[11px] text-text-secondary/70 leading-relaxed line-clamp-2 mb-3">{app.description}</p>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-text-secondary/40 uppercase tracking-wider font-bold">{app.category}</span>
                {app.status === 'live' && (
                  <div className="flex items-center gap-3 text-[10px] text-text-secondary/50">
                    {app.users && <span className="flex items-center gap-1"><Users size={10} />{app.users}</span>}
                    {app.rating && <span className="flex items-center gap-1"><Star size={10} className="text-yellow-500" />{app.rating}</span>}
                  </div>
                )}
              </div>

              {/* Hover arrow */}
              {app.status === 'live' && (
                <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ArrowRight size={16} className="text-[#c8ff00]" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Bottom spacer */}
        <div className="h-20" />
      </div>
    </div>
  );
};
