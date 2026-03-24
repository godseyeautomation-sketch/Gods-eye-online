
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
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';

const GUIDELINE_GOOD = ['https://picsum.photos/200/200?random=g1', 'https://picsum.photos/200/200?random=g2', 'https://picsum.photos/200/200?random=g3', 'https://picsum.photos/200/200?random=g4'];
const GUIDELINE_BAD = ['https://picsum.photos/200/200?random=b1', 'https://picsum.photos/200/200?random=b2', 'https://picsum.photos/200/200?random=b3', 'https://picsum.photos/200/200?random=b4'];

interface CharacterPageProps {
    onUseCharacter?: (char: Character) => void;
}

export const CharacterPage: React.FC<CharacterPageProps> = ({ onUseCharacter }) => {
    const { user } = useAuth();
    const [view, setView] = useState<'list' | 'detail'>('list');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [activeCharacter, setActiveCharacter] = useState<Character | null>(null);
    const [allCharacters, setAllCharacters] = useState<Character[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Creation State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
    const [charName, setCharName] = useState('');
    const [isTraining, setIsTraining] = useState(false);

    // Generation State
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);

    // Fetch Characters on Load
    useEffect(() => {
        if (!user) return;
        fetchCharacters();
    }, [user]);

    const fetchCharacters = async () => {
        try {
            setIsLoading(true);
            const { data: chars, error } = await supabase
                .from('characters')
                .select(`
                    *,
                    character_images (
                        image_url
                    )
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const formatted: Character[] = chars.map((c: any) => ({
                id: c.id,
                name: c.name,
                thumbnail: c.thumbnail_url,
                images: c.character_images?.map((img: any) => img.image_url) || []
            }));

            setAllCharacters(formatted);
        } catch (error) {
            console.error('Error fetching characters:', error);
        } finally {
            setIsLoading(false);
        }
    };

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
                    reader.readAsDataURL(file);
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

    const uploadToHostinger = async (base64: string): Promise<string> => {
        const response = await fetch('/api/hostinger-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ media: base64, type: 'image', userId: user?.id }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Upload failed');
        }
        const data = await response.json();
        if (!data?.url) throw new Error('Upload failed: no URL returned');
        return data.url;
    };

    const handleUploadAndCreate = async () => {
        if (selectedFiles.length === 0 || !charName || !user) return;

        setIsTraining(true);
        try {
            // 1. Upload all reference images to Hostinger
            const uploadedUrls = await Promise.all(selectedFiles.map(file => uploadToHostinger(file)));

            if (uploadedUrls.length === 0) throw new Error("No images uploaded");

            // 2. Create Character Record
            const { data: charData, error: charError } = await supabase
                .from('characters')
                .insert({
                    user_id: user.id,
                    name: charName.toUpperCase(),
                    thumbnail_url: uploadedUrls[0] // Use first image as thumbnail
                })
                .select()
                .single();

            if (charError) throw charError;

            // 3. Create Image Records
            const imageRecords = uploadedUrls.map(url => ({
                character_id: charData.id,
                image_url: url
            }));

            const { error: imgError } = await supabase
                .from('character_images')
                .insert(imageRecords);

            if (imgError) throw imgError;

            // 4. Update Local State
            await fetchCharacters(); // Refetch to be safe/consistent

            setIsTraining(false);
            setShowCreateModal(false);
            // setView('detail'); // Optional: auto open

        } catch (error) {
            console.error('Failed to create character:', error);
            alert('Failed to create character. Please try again.');
        } finally {
            setIsTraining(false);
        }
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

            // Save new generation to library? 
            // Currently Character interface expects just URLs. 
            // In a full implementation, we might want to save these generations to the DB too.
            // For now, we just update local state to show it.

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

    const handleDeleteActive = async () => {
        if (!activeCharacter) return;
        if (confirm(`Are you sure you want to delete ${activeCharacter.name}?`)) {
            try {
                const { error } = await supabase
                    .from('characters')
                    .delete()
                    .eq('id', activeCharacter.id);

                if (error) throw error;

                setAllCharacters(prev => prev.filter(c => c.id !== activeCharacter.id));
                handleBack();
            } catch (error) {
                console.error('Delete failed:', error);
            }
        }
    };

    return (
        <div className="w-full min-h-screen animate-fade-in pb-32 pt-40 text-text-primary bg-bg">

            {/* --- LIST VIEW --- */}
            {view === 'list' && (
                <div className="max-w-[1300px] mx-auto px-6 py-10">
                    <div className="flex items-center justify-between mb-10">
                        <div>
                            <h1 className="text-3xl font-black uppercase tracking-tight text-text-primary">Characters</h1>
                            <p className="text-text-secondary text-xs mt-1">Manage and generate content with consistent digital identities.</p>
                        </div>
                        <button
                            onClick={handleCreateClick}
                            className="bg-brand hover:bg-brand-hover text-bg font-bold py-2.5 px-5 rounded-xl flex items-center gap-2 transition-transform hover:scale-105 text-xs"
                        >
                            <Plus size={16} /> New Character
                        </button>
                    </div>

                    {isLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader2 className="animate-spin text-brand" size={40} />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-5">
                            {allCharacters.map(char => (
                                <div
                                    key={char.id}
                                    onClick={() => handleCharacterClick(char)}
                                    className="group relative aspect-[3/4] rounded-[24px] overflow-hidden cursor-pointer border border-white/5 hover:border-brand/30 transition-all duration-300 bg-panel/60 backdrop-blur-md hover:-translate-y-1.5 hover:shadow-xl hover:shadow-brand/5"
                                >
                                    <img src={char.thumbnail} alt={char.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-90" />
                                    <div className="absolute bottom-5 left-5">
                                        <span className="text-[13px] font-black text-white uppercase tracking-wider leading-none">{char.name}</span>
                                        <div className="text-[9px] font-bold text-brand mt-1 uppercase tracking-wider">{char.images.length} Assets</div>
                                    </div>
                                </div>
                            ))}

                            <button
                                onClick={handleCreateClick}
                                className="aspect-[3/4] rounded-[24px] border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-text-secondary hover:text-text-primary hover:border-brand/30 hover:bg-brand/5 transition-all duration-300 gap-3 bg-transparent"
                            >
                                <div className="w-12 h-12 rounded-full bg-white/[0.03] flex items-center justify-center border border-white/10">
                                    <Plus size={24} />
                                </div>
                                <span className="text-[10px] font-black uppercase tracking-[0.2em]">Add New Persona</span>
                            </button>
                        </div>
                    )}
                </div>
            )}


            {/* --- DETAIL VIEW (Matches Screenshot) --- */}
            {view === 'detail' && activeCharacter && (
                <div className="flex flex-col h-full w-full">

                    {/* Custom Header from Screenshot */}
                    <div className="w-full px-6 py-5">
                        <div className="max-w-[1200px] mx-auto bg-panel/60 backdrop-blur-2xl border border-white/5 rounded-[24px] px-6 py-3.5 flex items-center justify-between shadow-2xl relative overflow-hidden group h-16">
                            {/* Glassy Glow Effect */}
                            <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-brand/5 to-transparent pointer-events-none"></div>

                            <div className="flex items-center gap-4 relative z-10">
                                <button onClick={handleBack} className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors text-text-primary">
                                    <ChevronLeft size={20} />
                                </button>
                                <div className="flex items-center gap-2.5">
                                    <h2 className="text-xl font-black uppercase tracking-tight text-text-primary leading-none">
                                        {activeCharacter.name}
                                    </h2>
                                    <Heart size={16} className="text-text-secondary hover:text-red-500 cursor-pointer transition-colors" />
                                </div>
                            </div>

                            <div className="flex items-center gap-3 relative z-10">
                                {onUseCharacter && (
                                    <button
                                        onClick={() => onUseCharacter(activeCharacter)}
                                        className="flex items-center gap-2 px-5 py-1.5 rounded-full bg-brand text-bg text-[10px] font-bold uppercase tracking-wider hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand/20"
                                    >
                                        <Sparkles size={14} /> Use Character
                                    </button>
                                )}
                                <button
                                    onClick={handleDeleteActive}
                                    className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/5 hover:bg-red-600/10 hover:border-red-600/30 text-[10px] font-bold text-text-secondary hover:text-red-500 transition-all"
                                >
                                    <Trash2 size={14} /> Delete
                                </button>
                                <button className="p-1.5 hover:bg-black/5 dark:hover:bg-white/10 rounded-lg text-text-primary transition-colors">
                                    <MoreHorizontal size={20} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Grid for Gallery */}
                    <div className="flex-1 px-8 pb-32 overflow-y-auto">
                        <div className="max-w-[1400px] mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
                            {/* Reference Photos Row/Block */}
                            {activeCharacter.images.map((img, i) => (
                                <div key={i} className="group relative aspect-[3/4] rounded-[24px] overflow-hidden bg-panel/60 backdrop-blur-md border border-white/5 hover:border-white/10 hover:shadow-xl transition-all duration-300 animate-fade-in shadow-lg">
                                    <img src={img} alt={`Gen ${i}`} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => window.open(img)}
                                                className="w-8 h-8 bg-black/40 backdrop-blur-md border border-white/10 rounded-full text-white flex items-center justify-center hover:bg-brand hover:text-bg transition-all"
                                            >
                                                <Download size={14} />
                                            </button>
                                            <button className="w-8 h-8 bg-black/40 backdrop-blur-md border border-white/10 rounded-full text-white flex items-center justify-center hover:bg-brand hover:text-bg transition-all">
                                                <Share2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Bottom Command Bar (Matches Screenshot) */}
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-[700px] z-50">
                        <div className="bg-panel backdrop-blur-3xl border border-border rounded-[24px] p-1.5 flex items-center shadow-[0_40px_100px_rgba(0,0,0,0.2)] dark:shadow-[0_40px_100px_rgba(0,0,0,0.8)] gap-3 ring-1 ring-border group focus-within:ring-brand/30 transition-all">
                            <button className="w-11 h-11 rounded-full bg-surface text-text-secondary hover:text-text-primary flex items-center justify-center transition-colors">
                                <ImageIcon size={18} />
                            </button>
                            <input
                                type="text"
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleGenerate(); }}
                                placeholder={`imagine ${activeCharacter.name.toLowerCase()} in goa`}
                                className="flex-1 bg-transparent text-base text-text-primary placeholder-text-secondary outline-none h-11 px-1 font-medium"
                            />
                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating || !prompt}
                                className={`h-11 px-6 rounded-xl font-black uppercase tracking-widest flex items-center gap-2.5 transition-all active:scale-95 shadow-xl text-xs ${isGenerating ? 'bg-surface text-text-secondary' : 'bg-brand hover:bg-brand-hover text-bg'}`}
                            >
                                {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} fill="currentColor" />}
                                {isGenerating ? 'Generating' : 'Generate'}
                            </button>
                        </div>
                    </div>

                </div>
            )}

            {/* --- CREATE MODAL (Improved Upload) --- */}
            {showCreateModal && (
                <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fade-in">
                    <div className="w-full max-w-4xl bg-panel/80 backdrop-blur-2xl border border-white/5 rounded-[48px] overflow-hidden shadow-2xl relative max-h-[90vh] flex flex-col">
                        <button
                            onClick={() => setShowCreateModal(false)}
                            className="absolute top-8 right-8 bg-white/5 text-white hover:bg-white/10 p-3 rounded-full transition-all z-20 border border-white/5"
                        >
                            <X size={24} />
                        </button>

                        <div className="p-12 overflow-y-auto">
                            <div className="text-center mb-12">
                                <h2 className="text-4xl font-black text-white mb-3 uppercase tracking-tight">Create Character</h2>
                                <p className="text-neutral-500 font-medium">Upload 2-10 reference photos for visual consistency.</p>
                            </div>

                            <div className="mb-12 max-w-sm mx-auto">
                                <input
                                    type="text"
                                    value={charName}
                                    onChange={(e) => setCharName(e.target.value)}
                                    placeholder="CHARACTER NAME (e.g. BITAN)"
                                    className="w-full text-center bg-white/5 border border-white/5 rounded-2xl px-6 py-5 text-white font-black uppercase tracking-[0.3em] focus:border-brand outline-none transition-all"
                                />
                            </div>

                            <input type="file" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileChange} />

                            {selectedFiles.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-6 mb-12">
                                    {selectedFiles.map((src, i) => (
                                        <div key={i} className="relative aspect-[3/4] rounded-3xl overflow-hidden border border-white/5 group shadow-2xl bg-[#0a0a0a]">
                                            <img src={src} alt="Upload" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                <button onClick={() => removeFile(i)} className="bg-red-600 text-white rounded-full p-3 shadow-2xl hover:scale-110 transition-transform">
                                                    <Trash2 size={20} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    <button onClick={triggerFileSelect} className="aspect-[3/4] rounded-3xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center text-neutral-500 hover:text-brand hover:border-brand/50 hover:bg-brand/5 transition-all group gap-3">
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
                                                <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-white/5 shadow-2xl">
                                                    <img src={src} alt="" className="w-full h-full object-cover" />
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-neutral-500 font-medium">Varied angles, clear lighting, neutral backgrounds.</p>
                                    </div>
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-3 text-red-500 text-xs font-black uppercase tracking-[0.2em]">
                                            <XCircle size={18} /> Poor Quality
                                        </div>
                                        <div className="grid grid-cols-4 gap-3">
                                            {GUIDELINE_BAD.map((src, i) => (
                                                <div key={i} className="relative aspect-square rounded-2xl overflow-hidden border border-white/5 opacity-30 grayscale shadow-2xl">
                                                    <img src={src} alt="" className="w-full h-full object-cover" />
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-neutral-500 font-medium">Groups, low res, hats, glasses, or covered face.</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-center flex-col items-center gap-6">
                                {selectedFiles.length === 0 ? (
                                    <button onClick={triggerFileSelect} className="bg-brand hover:bg-brand-hover text-bg font-black uppercase tracking-widest py-5 px-16 rounded-[24px] flex items-center gap-4 transition-all hover:scale-105 shadow-2xl shadow-brand/20">
                                        <Upload size={24} /> Select Assets
                                    </button>
                                ) : (
                                    <button
                                        onClick={handleUploadAndCreate}
                                        disabled={isTraining || !charName}
                                        className="bg-brand hover:bg-brand-hover text-bg font-black uppercase tracking-widest py-5 px-16 rounded-[24px] flex items-center gap-4 transition-all hover:scale-105 shadow-2xl shadow-brand/20 disabled:opacity-50"
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
