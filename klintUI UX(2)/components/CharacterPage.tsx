
import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  ChevronLeft, 
  MoreHorizontal, 
  Heart, 
  Download, 
  Share2, 
  Trash2, 
  Sparkles,
  Image as ImageIcon,
  Loader2,
  X,
  PlusSquare
} from 'lucide-react';
import { Character } from '../types';
import { generateImage } from '../services/geminiService';

// Mock Data
const MOCK_CHARACTERS: Character[] = [
  { 
    id: '1', 
    name: 'BITAN', 
    thumbnail: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400&auto=format&fit=crop', 
    images: [
        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=400&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?q=80&w=1000&auto=format&fit=crop'
    ] 
  }
];

const GUIDELINE_GOOD = [ 'https://picsum.photos/200/200?random=g1', 'https://picsum.photos/200/200?random=g2', 'https://picsum.photos/200/200?random=g3', 'https://picsum.photos/200/200?random=g4' ];
const GUIDELINE_BAD = [ 'https://picsum.photos/200/200?random=b1', 'https://picsum.photos/200/200?random=b2', 'https://picsum.photos/200/200?random=b3', 'https://picsum.photos/200/200?random=b4' ];

export const CharacterPage: React.FC = () => {
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>(() => {
      const saved = localStorage.getItem('klint_characters');
      return saved ? JSON.parse(saved) : MOCK_CHARACTERS;
  });
  
  // Creation State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [charName, setCharName] = useState('');
  const [isTraining, setIsTraining] = useState(false);

  // Generation State
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
      localStorage.setItem('klint_characters', JSON.stringify(allCharacters));
  }, [allCharacters]);

  const handleCharacterClick = (char: Character) => {
      setActiveCharacter(char);
      setView('detail');
  };

  const handleCreateClick = () => {
      setSelectedFiles([]);
      setCharName('');
      setShowCreateModal(true);
  };

  const triggerFileSelect = () => {
      fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const filesArray = Array.from(e.target.files);
          const newBase64s = await Promise.all(filesArray.map(file => {
              return new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (ev) => resolve(ev.target?.result as string);
                  reader.readAsDataURL(file as Blob);
              });
          }));
          setSelectedFiles(prev => [...prev, ...newBase64s]);
          if (fileInputRef.current) {
              fileInputRef.current.value = '';
          }
      }
  };

  const removeFile = (index: number) => {
      setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUploadAndCreate = async () => {
      if (selectedFiles.length === 0 || !charName) return;
      
      setIsTraining(true);
      await new Promise(r => setTimeout(r, 3000));

      const newChar: Character = {
          id: Date.now().toString(),
          name: charName.toUpperCase(),
          thumbnail: selectedFiles[0],
          images: selectedFiles
      };

      const updated = [newChar, ...allCharacters];
      setAllCharacters(updated);
      setActiveCharacter(newChar);
      setIsTraining(false);
      setShowCreateModal(false);
      setView('detail');
  };

  const handleBack = () => {
      setView('list');
      setActiveCharacter(null);
  };

  const handleGenerate = async () => {
      if (!prompt || !activeCharacter) return;
      setIsGenerating(true);

      try {
          const newUrls = await generateImage({
              prompt: `A high-quality photo of ${activeCharacter.name}. ${prompt}. Maintain consistent facial features and body type from the reference images.`,
              model: 'gemini-3-pro-image-preview',
              aspectRatio: '1:1',
              batchSize: 1,
              baseImages: activeCharacter.images.slice(0, 3) 
          });

          const updatedChar: Character = {
              ...activeCharacter,
              images: [...newUrls, ...activeCharacter.images]
          };

          setActiveCharacter(updatedChar);
          setAllCharacters(prev => prev.map(c => c.id === updatedChar.id ? updatedChar : c));
          setPrompt('');
      } catch (error) {
          console.error("Failed to generate character image", error);
      } finally {
          setIsGenerating(false);
      }
  };

  const handleDeleteActive = () => {
      if (!activeCharacter) return;
      if (confirm(`Are you sure you want to delete ${activeCharacter.name}?`)) {
          setAllCharacters(prev => prev.filter(c => c.id !== activeCharacter.id));
          handleBack();
      }
  };

  return (
    <div className="w-full min-h-screen animate-fade-in pb-32 text-text-primary bg-bg">
        
        {/* --- LIST VIEW --- */}
        {view === 'list' && (
            <div className="max-w-[1400px] mx-auto px-6 py-12">
                <div className="flex items-center justify-between mb-12">
                    <div>
                        <h1 className="text-4xl font-black uppercase tracking-tighter text-text-primary">Characters</h1>
                        <p className="text-text-secondary text-sm mt-1">Manage and generate content with consistent digital identities.</p>
                    </div>
                    <button 
                        onClick={handleCreateClick}
                        className="bg-brand hover:bg-brand-hover text-bg font-bold py-3 px-6 rounded-2xl flex items-center gap-2 transition-transform hover:scale-105"
                    >
                        <Plus size={18} /> New Character
                    </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                    {allCharacters.map(char => (
                        <div 
                            key={char.id} 
                            onClick={() => handleCharacterClick(char)}
                            className="group relative aspect-[3/4] rounded-[28px] overflow-hidden cursor-pointer border border-border-base hover:border-brand transition-all bg-panel hover:-translate-y-2"
                        >
                            <img src={char.thumbnail} alt={char.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-90" />
                            <div className="absolute bottom-6 left-6">
                                <span className="text-sm font-black text-white uppercase tracking-widest leading-none">{char.name}</span>
                                <div className="text-[10px] font-bold text-brand mt-1 uppercase tracking-wider">{char.images.length} Assets</div>
                            </div>
                        </div>
                    ))}
                    
                    <button 
                        onClick={handleCreateClick}
                        className="aspect-[3/4] rounded-[28px] border border-dashed border-border-base flex flex-col items-center justify-center text-text-secondary hover:text-text-primary hover:border-brand/50 hover:bg-brand/5 transition-all gap-4 bg-transparent"
                    >
                        <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center border border-border-base">
                            <Plus size={28} />
                        </div>
                        <span className="text-[11px] font-black uppercase tracking-[0.2em]">Add New Persona</span>
                    </button>
                </div>
            </div>
        )}


        {/* --- DETAIL VIEW (Adaptive Theme) --- */}
        {view === 'detail' && activeCharacter && (
            <div className="flex flex-col h-full w-full">
                
                {/* Custom Header */}
                <div className="w-full px-8 py-6">
                    <div className="bg-panel/60 backdrop-blur-xl border border-border-base rounded-[32px] px-8 py-5 flex items-center justify-between shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-brand/5 to-transparent pointer-events-none"></div>
                        
                        <div className="flex items-center gap-6 relative z-10">
                            <button onClick={handleBack} className="p-2 hover:bg-surface rounded-full transition-colors text-text-primary">
                                <ChevronLeft size={24} />
                            </button>
                            <div className="flex items-center gap-3">
                                <h2 className="text-2xl font-black uppercase tracking-tight text-text-primary leading-none">
                                    {activeCharacter.name}
                                </h2>
                                <Heart size={20} className="text-text-secondary hover:text-red-500 cursor-pointer transition-colors" />
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-4 relative z-10">
                            <button 
                                onClick={handleDeleteActive}
                                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-surface border border-border-base hover:bg-red-600/20 hover:border-red-600/40 text-xs font-bold text-text-secondary hover:text-red-500 transition-all"
                            >
                                <Trash2 size={16} /> Delete
                            </button>
                            <button className="p-2 hover:bg-surface rounded-xl text-text-primary transition-colors">
                                <MoreHorizontal size={24} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Grid for Gallery */}
                <div className="flex-1 px-8 pb-40 overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                        {activeCharacter.images.map((img, i) => (
                            <div key={i} className="group relative aspect-[3/4] rounded-[32px] overflow-hidden bg-panel border border-border-base hover:border-brand transition-all animate-fade-in shadow-xl">
                                <img src={img} alt={`Gen ${i}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-6">
                                    <div className="flex gap-3">
                                        <button 
                                            onClick={() => window.open(img)}
                                            className="w-10 h-10 bg-black/40 backdrop-blur-md border border-white/10 rounded-full text-white flex items-center justify-center hover:bg-brand hover:text-bg transition-all"
                                        >
                                            <Download size={18}/>
                                        </button>
                                        <button className="w-10 h-10 bg-black/40 backdrop-blur-md border border-white/10 rounded-full text-white flex items-center justify-center hover:bg-brand hover:text-bg transition-all">
                                            <Share2 size={18}/>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Bottom Command Bar (Adaptive) */}
                <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[90%] max-w-[800px] z-50">
                    <div className="bg-panel/90 backdrop-blur-3xl border border-border-base rounded-[32px] p-2 flex items-center shadow-[0_40px_100px_rgba(0,0,0,0.4)] gap-4 ring-1 ring-border-base group focus-within:ring-brand/30 transition-all">
                        <button className="w-14 h-14 rounded-full bg-surface text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors">
                            <ImageIcon size={22} />
                        </button>
                        <input 
                            type="text"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => { if(e.key === 'Enter') handleGenerate(); }}
                            placeholder={`imagine ${activeCharacter.name.toLowerCase()} in goa`} 
                            className="flex-1 bg-transparent text-lg text-text-primary placeholder-text-secondary outline-none h-14 px-2 font-medium"
                        />
                        <button 
                            onClick={handleGenerate}
                            disabled={isGenerating || !prompt}
                            className={`h-14 px-8 rounded-[24px] font-black uppercase tracking-widest flex items-center gap-3 transition-all active:scale-95 shadow-xl ${isGenerating ? 'bg-surface text-text-secondary' : 'bg-brand hover:bg-brand-hover text-bg'}`}
                        >
                            {isGenerating ? <Loader2 size={20} className="animate-spin"/> : <Sparkles size={20} fill="currentColor"/>}
                            {isGenerating ? 'Generating' : 'Generate'}
                        </button>
                    </div>
                </div>

            </div>
        )}

        {/* --- CREATE MODAL (Adaptive Theme) --- */}
        {showCreateModal && (
            <div className="fixed inset-0 z-[60] bg-bg/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
                <div className="w-full max-w-4xl bg-panel border border-border-base rounded-[48px] overflow-hidden shadow-2xl relative max-h-[90vh] flex flex-col">
                    <button 
                        onClick={() => setShowCreateModal(false)} 
                        className="absolute top-8 right-8 bg-surface text-text-primary hover:bg-border-base p-3 rounded-full transition-all z-20 border border-border-base"
                    >
                        <X size={24} />
                    </button>
                    
                    <div className="p-12 overflow-y-auto">
                        <div className="text-center mb-12">
                            <h2 className="text-4xl font-black text-text-primary mb-3 uppercase tracking-tight">Create Character</h2>
                            <p className="text-text-secondary font-medium">Upload 2-10 reference photos for visual consistency.</p>
                        </div>

                        <div className="mb-12 max-w-sm mx-auto">
                             <input 
                                type="text" 
                                value={charName}
                                onChange={(e) => setCharName(e.target.value)}
                                placeholder="CHARACTER NAME"
                                className="w-full text-center bg-surface border border-border-base rounded-2xl px-6 py-5 text-text-primary font-black uppercase tracking-[0.3em] focus:border-brand outline-none transition-all"
                             />
                        </div>

                        <input type="file" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

                        {selectedFiles.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-12">
                                {selectedFiles.map((src, i) => (
                                    <div key={i} className="relative aspect-[3/4] rounded-3xl overflow-hidden border border-border-base group shadow-2xl bg-surface">
                                        <img src={src} alt="Upload" className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                            <button onClick={() => removeFile(i)} className="bg-red-600 text-white rounded-full p-3 shadow-2xl hover:scale-110 transition-transform">
                                                <Trash2 size={20}/>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                <button onClick={triggerFileSelect} className="aspect-[3/4] rounded-3xl border-2 border-dashed border-border-base flex flex-col items-center justify-center text-text-secondary hover:text-brand hover:border-brand/50 hover:bg-brand/5 transition-all group gap-3">
                                    <PlusSquare size={40} className="group-hover:scale-110 transition-transform" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">Add Frame</span>
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
                                <div className="space-y-6">
                                    <div className="flex items-center gap-3 text-brand text-xs font-black uppercase tracking-[0.2em]">
                                        <CheckCircle2 size={18} /> Good Examples
                                    </div>
                                    <div className="grid grid-cols-4 gap-3">
                                        {GUIDELINE_GOOD.map((src, i) => (
                                            <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-border-base shadow-2xl">
                                                <img src={src} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[11px] text-text-secondary font-medium">Varied angles, clear lighting, neutral backgrounds.</p>
                                </div>
                                <div className="space-y-6">
                                    <div className="flex items-center gap-3 text-red-500 text-xs font-black uppercase tracking-[0.2em]">
                                        <XCircle size={18} /> Poor Quality
                                    </div>
                                    <div className="grid grid-cols-4 gap-3">
                                        {GUIDELINE_BAD.map((src, i) => (
                                            <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-border-base opacity-30 grayscale shadow-2xl">
                                                <img src={src} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[11px] text-text-secondary font-medium">Groups, low res, hats, glasses, or covered face.</p>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-center flex-col items-center gap-6">
                            {selectedFiles.length === 0 ? (
                                <button onClick={triggerFileSelect} className="bg-brand hover:bg-brand-hover text-bg font-black uppercase tracking-widest py-5 px-16 rounded-[24px] flex items-center gap-4 transition-all hover:scale-105 shadow-2xl">
                                    <Upload size={24} /> Select Assets
                                </button>
                            ) : (
                                <button 
                                    onClick={handleUploadAndCreate} 
                                    disabled={isTraining || !charName} 
                                    className="bg-brand hover:bg-brand-hover text-bg font-black uppercase tracking-widest py-5 px-16 rounded-[24px] flex items-center gap-4 transition-all hover:scale-105 shadow-2xl disabled:opacity-50"
                                >
                                    {isTraining ? <Loader2 size={24} className="animate-spin" /> : <Sparkles size={24} />}
                                    {isTraining ? 'Initializing' : 'Create Identity'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};
