import React, { useState, useEffect } from 'react';
import { Tag, Heart, Check, Plus, Folder } from 'lucide-react';
import { useBrain } from '../context/BrainContext';

interface BrainActionsProps {
    imageUrl: string;
    prompt: string;
    className?: string; // Additional classes for positioning in absolute corners
}

export const BrainActions: React.FC<BrainActionsProps> = ({ imageUrl, prompt, className = '' }) => {
    const { isConnected, currentProjectTag, availableTags, setProjectTag, addTag, saveAssetToBrain, removeAssetFromBrain, connectBrain } = useBrain();
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [newTagInput, setNewTagInput] = useState('');
    const [isHoveringHeart, setIsHoveringHeart] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);

    // Stable localStorage key: project + sanitized prompt
    const heartKey = `klint_heart_${currentProjectTag}_${prompt.trim().slice(0, 60).replace(/[^a-zA-Z0-9]/g, '_')}`;

    // Read persisted state on mount and whenever the key changes (e.g. project switch)
    const [hasHearted, setHasHearted] = useState(() => localStorage.getItem(heartKey) === 'true');
    useEffect(() => {
        setHasHearted(localStorage.getItem(heartKey) === 'true');
    }, [heartKey]);

    const handleHeartClick = async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (hasHearted) {
            // Toggle OFF: remove asset from brain and clear persisted state
            setHasHearted(false);
            localStorage.removeItem(heartKey);
            await removeAssetFromBrain(prompt);
            return;
        }

        // Toggle ON: save asset to brain
        if (!isConnected) {
            await connectBrain();
            if (!isConnected) return;
        }

        const success = await saveAssetToBrain(imageUrl, prompt);
        if (success) {
            setHasHearted(true);
            localStorage.setItem(heartKey, 'true');
            // Brief pop animation on first heart
            setIsAnimating(true);
            setTimeout(() => setIsAnimating(false), 500);
        }
    };

    const handleCreateTag = (e: React.FormEvent) => {
        e.preventDefault();
        e.stopPropagation();
        addTag(newTagInput);
        setNewTagInput('');
        setIsDropdownOpen(false);
    };

    return (
        <div className={`flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
            {/* TAG DROPDOWN */}
            <div className="relative">
                <button
                    onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(!isDropdownOpen); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-full text-white text-xs font-semibold hover:bg-black/80 transition-all border border-white/10 shadow-lg"
                    title={`Current Project: ${currentProjectTag}`}
                >
                    <Tag size={14} className={currentProjectTag !== 'Default_Project' ? 'text-brand' : 'text-gray-300'} />
                    <span className="max-w-[80px] truncate">{currentProjectTag}</span>
                </button>

                {isDropdownOpen && (
                    <div className="absolute top-full mt-2 left-0 w-48 bg-surface-light border border-border-base rounded-xl shadow-2xl z-50 overflow-hidden transform origin-top-left transition-all">
                        <div className="p-2 border-b border-border-base bg-surface">
                            <p className="text-xs font-semibold text-text-secondary px-2 py-1 flex items-center gap-2">
                                <Folder size={12} />
                                Select Project
                            </p>
                        </div>
                        <div className="max-h-48 overflow-y-auto p-1 custom-scrollbar">
                            {availableTags.map((tag) => (
                                <button
                                    key={tag}
                                    onClick={(e) => { e.stopPropagation(); setProjectTag(tag); setIsDropdownOpen(false); }}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-lg flex items-center justify-between hover:bg-white/5 transition-colors ${currentProjectTag === tag ? 'text-brand font-medium bg-brand/5' : 'text-text-primary'}`}
                                >
                                    <span className="truncate">{tag}</span>
                                    {currentProjectTag === tag && <Check size={14} />}
                                </button>
                            ))}
                        </div>
                        <div className="p-2 border-t border-border-base bg-surface">
                            <form onSubmit={handleCreateTag} className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={newTagInput}
                                    onChange={(e) => setNewTagInput(e.target.value)}
                                    placeholder="New project..."
                                    className="w-full bg-black/20 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-brand"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <button
                                    type="submit"
                                    disabled={!newTagInput.trim()}
                                    className="p-1.5 bg-brand text-bg rounded-lg shrink-0 disabled:opacity-50 hover:bg-brand/90 transition-colors"
                                >
                                    <Plus size={14} />
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>

            {/* HEART BUTTON */}
            <button
                onClick={handleHeartClick}
                onMouseEnter={() => setIsHoveringHeart(true)}
                onMouseLeave={() => setIsHoveringHeart(false)}
                className={`w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all duration-200 shadow-lg border border-white/10 ${
                    hasHearted
                        ? 'bg-red-500/90 text-white scale-110'
                        : isHoveringHeart ? 'bg-red-500/20 text-red-500' : 'bg-black/60 text-white hover:bg-white/10'
                } ${isAnimating ? 'scale-125' : ''}`}
                title={hasHearted ? 'Remove from Brain' : 'Save to Brain'}
            >
                <Heart
                    size={16}
                    className={`transition-all ${hasHearted || isHoveringHeart ? 'fill-current' : ''}`}
                />
            </button>

            {/* CLICK OUTSIDE HANDLER (simple overlay) */}
            {isDropdownOpen && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={(e) => { e.stopPropagation(); setIsDropdownOpen(false); }}
                />
            )}
        </div>
    );
};
