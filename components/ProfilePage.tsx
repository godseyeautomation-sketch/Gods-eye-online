import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBrain } from '../context/BrainContext';
import { supabase } from '../services/supabaseClient';
import { CreditCard, Zap, Shield, User, HardDrive, Trash2, Key, Brain, ChevronDown, ChevronUp, X, Sparkles, Save, RotateCcw, Pencil } from 'lucide-react';
import { getUserStorageQuota, formatBytes, getUserMediaFiles, deleteMediaFile } from '../services/hostingerService';
import { BackupRestore } from './BackupRestore';

// ── Brain Data Viewer Component ──────────────────────────────────────────────
const BrainDataViewer: React.FC<{ brain: any }> = ({ brain }) => {
    const [expanded, setExpanded] = useState(false);
    const [entries, setEntries] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const loadEntries = async () => {
        if (!brain?.listEntries) return;
        setLoading(true);
        try {
            const data = await brain.listEntries();
            setEntries(data);
        } catch { setEntries([]); }
        setLoading(false);
    };

    const handleDelete = async (id: string) => {
        if (!brain?.deleteEntry) return;
        await brain.deleteEntry(id);
        setEntries(prev => prev.filter(e => e.id !== id));
    };

    const typeLabels: Record<string, string> = {
        style: '🎨 Style', brand: '🏢 Brand', prompt: '💬 Prompt',
        image: '🖼️ Image', asset: '📦 Asset',
    };

    return (
        <div className="w-full rounded-2xl border border-white/5 bg-white/[0.02]">
            {/* Header */}
            <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                        <Brain size={16} className="text-brand" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-text-primary">Brain Training Data</p>
                        <p className="text-xs text-text-secondary">{brain?.vectorsCount || 0} vectors stored</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            if (!confirm('Clear ALL brain training data? This cannot be undone.')) return;
                            await brain?.clearBrain();
                            setEntries([]);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all"
                    >
                        Reset All
                    </button>
                    <button
                        onClick={() => {
                            setExpanded(!expanded);
                            if (!expanded && entries.length === 0) loadEntries();
                        }}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-secondary transition-all"
                    >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            </div>

            {/* Expandable entry list */}
            {expanded && (
                <div className="border-t border-white/5 px-5 pb-4 pt-3">
                    {loading ? (
                        <p className="text-xs text-text-secondary py-4 text-center">Loading trained data...</p>
                    ) : entries.length === 0 ? (
                        <p className="text-xs text-text-secondary py-4 text-center">No training data yet. Like images or scan brands to train.</p>
                    ) : (
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                            {entries.map((entry) => (
                                <div key={entry.id} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/5 group">
                                    <span className="text-xs shrink-0 mt-0.5">{typeLabels[entry.type] || '📄'}</span>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-text-primary truncate">{entry.text}</p>
                                        <p className="text-[10px] text-text-secondary/50 mt-0.5">
                                            {new Date(entry.createdAt).toLocaleDateString()} · {entry.type}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => handleDelete(entry.id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-red-400 transition-all shrink-0"
                                        title="Remove this entry"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <button
                        onClick={loadEntries}
                        className="mt-2 text-[10px] text-text-secondary/50 hover:text-text-secondary transition-colors"
                    >
                        Refresh
                    </button>
                </div>
            )}
        </div>
    );
};

// ── Soul / Personality Editor ─────────────────────────────────────────────────
const SoulEditor: React.FC<{ userId: string; profile: any; onSave: () => void }> = ({ userId, profile, onSave }) => {
    const personality = profile?.personality;
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [soulText, setSoulText] = useState(personality?.soul || '');
    const [saving, setSaving] = useState(false);

    const roleLabels: Record<string, string> = {
        creator: 'Creator', brand_owner: 'Brand Owner', marketer: 'Marketer',
        designer: 'Designer', photographer: 'Photographer', agency_owner: 'Agency Owner', other: 'Other',
    };
    const vibeLabels: Record<string, string> = {
        minimalist: 'Minimalist', bold_vibrant: 'Bold & Vibrant', cinematic: 'Cinematic',
        vintage: 'Vintage/Retro', futuristic: 'Futuristic', organic: 'Organic/Natural', mixed: 'Mix of Everything',
    };
    const interactionLabels: Record<string, string> = {
        quick: 'Quick & Direct', detailed: 'Detailed & Thorough',
        experimental: 'Experimental & Surprising', guided: 'Guide Me',
    };
    const presetLabels: Record<string, string> = {
        professional: '💼 Professional', friendly: '😊 Friendly Creative',
        jarvis: '🤖 Jarvis Mode', creative_director: '🎬 Creative Director', custom: '✍️ Custom',
    };

    const handleSave = async () => {
        setSaving(true);
        const updated = { ...personality, soul: soulText };
        localStorage.setItem(`godseye_personality_${userId}`, JSON.stringify(updated));
        try {
            await supabase.from('profiles').update({ personality: updated }).eq('id', userId);
        } catch { }
        setSaving(false);
        setEditing(false);
        onSave();
    };

    const handleResetOnboarding = async () => {
        if (!confirm('Re-run the onboarding questionnaire? This will reset your personality settings.')) return;
        localStorage.removeItem(`godseye_onboarding_done_${userId}`);
        localStorage.removeItem(`godseye_personality_${userId}`);
        try {
            await supabase.from('profiles').update({ onboarding_completed: false, personality: null }).eq('id', userId);
        } catch { }
        window.location.reload();
    };

    if (!personality) {
        return (
            <div className="w-full rounded-2xl border border-white/5 bg-white/[0.02] p-5">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                        <Sparkles size={16} className="text-brand" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-text-primary">Your Soul</p>
                        <p className="text-xs text-text-secondary">No personality configured yet</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full rounded-2xl border border-white/5 bg-white/[0.02]">
            {/* Header */}
            <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center">
                        <Sparkles size={16} className="text-brand" />
                    </div>
                    <div>
                        <p className="text-sm font-semibold text-text-primary">Your Soul</p>
                        <p className="text-xs text-text-secondary">
                            {presetLabels[personality.personality_preset] || 'Custom'} · {roleLabels[personality.role] || personality.role}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleResetOnboarding}
                        className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-text-secondary text-xs font-medium hover:bg-white/10 transition-all"
                        title="Re-run onboarding"
                    >
                        <RotateCcw size={12} className="inline mr-1" />
                        Redo Setup
                    </button>
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-text-secondary transition-all"
                    >
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                </div>
            </div>

            {/* Expanded details */}
            {expanded && (
                <div className="border-t border-white/5 px-5 pb-5 pt-4 space-y-4">
                    {/* Profile summary */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[10px] text-text-secondary/50 uppercase tracking-widest mb-1">Role</p>
                            <p className="text-xs text-text-primary">{roleLabels[personality.role] || personality.role}</p>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[10px] text-text-secondary/50 uppercase tracking-widest mb-1">Interaction</p>
                            <p className="text-xs text-text-primary">{interactionLabels[personality.interaction_style] || personality.interaction_style}</p>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[10px] text-text-secondary/50 uppercase tracking-widest mb-1">Creative Style</p>
                            <p className="text-xs text-text-primary">{(personality.vibes || []).map((v: string) => vibeLabels[v] || v).join(', ')}</p>
                        </div>
                        <div className="px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
                            <p className="text-[10px] text-text-secondary/50 uppercase tracking-widest mb-1">Creates</p>
                            <p className="text-xs text-text-primary">{(personality.use_cases || []).map((u: string) => u.replace(/_/g, ' ')).join(', ')}</p>
                        </div>
                    </div>

                    {/* Soul text — editable */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-text-secondary/50 uppercase tracking-widest">Soul / Personality Directives</p>
                            {!editing && (
                                <button
                                    onClick={() => { setEditing(true); setSoulText(personality.soul || ''); }}
                                    className="text-[10px] text-brand hover:text-brand/80 transition-colors flex items-center gap-1"
                                >
                                    <Pencil size={10} /> Edit
                                </button>
                            )}
                        </div>
                        {editing ? (
                            <div className="space-y-2">
                                <textarea
                                    value={soulText}
                                    onChange={e => setSoulText(e.target.value)}
                                    rows={4}
                                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-brand/30 text-text-primary text-xs focus:outline-none focus:border-brand/60 resize-none"
                                    placeholder="Define how your AI should think, speak, and act..."
                                />
                                <div className="flex gap-2 justify-end">
                                    <button
                                        onClick={() => setEditing(false)}
                                        className="px-3 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="px-3 py-1.5 rounded-lg bg-brand text-bg text-xs font-bold hover:brightness-110 transition-all disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save Soul'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-text-primary/70 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 whitespace-pre-wrap">
                                {personality.soul || 'No soul directives set. Click Edit to add personality rules.'}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export const ProfilePage: React.FC = () => {
    const { user, isAdmin } = useAuth();
    const brain = useBrain();
    const [profile, setProfile] = useState<any>(null);
    const [storageQuota, setStorageQuota] = useState<any>(null);
    const [mediaFiles, setMediaFiles] = useState<any[]>([]);
    const [showManageFiles, setShowManageFiles] = useState(false);

    useEffect(() => {
        const fetchProfile = async () => {
            if (!user) return;
            const { data } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', user.id)
                .single();
            setProfile(data);
        };
        fetchProfile();
    }, [user]);

    useEffect(() => {
        const fetchStorageData = async () => {
            if (!user) return;
            const quota = await getUserStorageQuota(user.id);
            setStorageQuota(quota);

            const files = await getUserMediaFiles(user.id);
            setMediaFiles(files);
        };
        fetchStorageData();
    }, [user]);

    const handleImport = async (fileList: FileList | File[]) => {
        const { saveToLocalGallery } = await import('../services/localStorageService');
        let count = 0;

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const b64 = ev.target?.result as string;
                // Save with current User ID
                await saveToLocalGallery(
                    b64,
                    file.name.replace('.png', '').replace(/_/g, ' '), // Guess prompt 
                    '16:9',
                    'Imported',
                    user!.id
                );
            };
            reader.readAsDataURL(file);
            count++;
        }

        // Refresh
        setTimeout(async () => {
            alert(`Importing ${count} images... Gallery will refresh shortly.`);
            // Trigger storage refresh if needed
            const files = await getUserMediaFiles(user!.id);
            setMediaFiles(files);
        }, 1500);
    };

    if (!profile) return <div className="p-10 text-center text-text-secondary">Loading Profile...</div>;

    return (
        <div className="max-w-4xl mx-auto p-8 pt-32 space-y-8 animate-fade-in">
            <h1 className="text-3xl font-black text-text-primary tracking-tight">Account & Billing</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Credits Card */}
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/5 hover:border-white/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-all duration-300 text-brand">
                        <Zap size={64} />
                    </div>
                    <div className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Available Credits</div>
                    <div className="text-4xl font-black text-brand mb-1">{isAdmin ? '∞' : profile.credits}</div>
                    <div className="text-text-secondary text-sm">Resets on Feb 1, 2026</div>
                </div>

                {/* Plan Card */}
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/5 hover:border-white/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-all duration-300 text-brand">
                        <Shield size={64} />
                    </div>
                    <div className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Current Plan</div>
                    <div className="text-4xl font-black text-white mb-1 capitalize">{isAdmin ? 'Super Admin' : profile.tier}</div>
                    <button className="text-brand text-xs font-bold hover:underline">Manage Subscription</button>
                </div>

                {/* User Card */}
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/5 hover:border-white/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-all duration-300 text-brand">
                        <User size={64} />
                    </div>
                    <div className="flex items-center gap-4">
                        <img src={user?.user_metadata?.avatar_url || "https://picsum.photos/100/100"} className="w-12 h-12 rounded-full border border-border" />
                        <div>
                            <div className="text-text-primary font-bold">{profile.full_name || 'Studio User'}</div>
                            <div className="text-text-secondary text-xs">{user?.email}</div>
                        </div>
                    </div>
                </div>

                {/* Storage Card */}
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/5 hover:border-white/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-all duration-300 text-brand">
                        <HardDrive size={64} />
                    </div>
                    <div className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">Storage Used</div>
                    {storageQuota ? (
                        <>
                            <div className="text-3xl font-black text-white mb-1">
                                {formatBytes(storageQuota.total_bytes)}
                            </div>
                            <div className="w-full bg-surface rounded-full h-1.5 mb-2">
                                <div
                                    className={`h-1.5 rounded-full transition-all ${storageQuota.percentage_used > 90 ? 'bg-red-500' : storageQuota.percentage_used > 70 ? 'bg-yellow-500' : 'bg-brand'}`}
                                    style={{ width: `${Math.min(storageQuota.percentage_used, 100)}%` }}
                                />
                            </div>
                            <div className="text-text-secondary text-xs flex items-center justify-between">
                                <span>{storageQuota.percentage_used.toFixed(1)}% of 1GB</span>
                                <button
                                    onClick={() => setShowManageFiles(!showManageFiles)}
                                    className="text-brand hover:underline"
                                >
                                    Manage
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="text-text-secondary text-sm">Loading...</div>
                    )}
                </div>
            </div>

            {/* API Configuration Card */}
            {profile?.can_use_byok && (
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 relative overflow-hidden group hover:-translate-y-1 hover:shadow-lg hover:shadow-brand/5 hover:border-white/10 transition-all duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.06] group-hover:opacity-[0.12] transition-all duration-300 text-brand">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </div>
                    <div className="text-text-secondary text-xs font-bold uppercase tracking-wider mb-2">BYOK Access</div>
                    <div className="mb-4">
                        <div className="text-sm font-bold text-white mb-1">Gemini API Key</div>
                        <div className="text-[10px] text-text-secondary">Use your own key for free generations. Key is saved locally.</div>
                    </div>
                    <ApiKeyInput />
                </div>
            )}

            {/* OPFS Local Brain Backup */}
            <div className="w-full">
                <BackupRestore />
            </div>

            {/* Your Soul — Personality Editor */}
            <SoulEditor userId={user?.id || ''} profile={profile} onSave={async () => {
                if (!user) return;
                const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
                setProfile(data);
            }} />

            {/* Brain Training Data — Expandable Viewer */}
            <BrainDataViewer brain={brain} />

            {/* Manage Files Section */}
            {
                showManageFiles && (
                    <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-text-primary">Stored Media Files</h3>
                            <div className="flex gap-2">
                                {/* Option 1: Select Specific Files */}
                                <label className="cursor-pointer px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-bold hover:border-brand/30 hover:text-brand transition-all duration-300 flex items-center gap-2">
                                    <HardDrive size={14} />
                                    <span>Select Files</span>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                            if (!e.target.files?.length) return;
                                            await handleImport(e.target.files);
                                        }}
                                    />
                                </label>

                                {/* Option 2: Scan Folder (Auto-Filter 'klint') */}
                                <label className="cursor-pointer px-3 py-1.5 rounded-lg bg-brand text-bg border border-brand text-xs font-bold hover:opacity-90 transition flex items-center gap-2">
                                    <div className="animate-pulse"><Zap size={14} /></div>
                                    <span>Auto-Scan Folder</span>
                                    <input
                                        type="file"
                                        {...{ webkitdirectory: "", directory: "" } as any}
                                        className="hidden"
                                        onChange={async (e) => {
                                            if (!e.target.files?.length) return;
                                            // Filter for 'klint' files only
                                            const files = Array.from(e.target.files as FileList).filter((f: File) =>
                                                f.name.toLowerCase().includes('gods') && f.type.startsWith('image/')
                                            );

                                            if (files.length === 0) {
                                                alert("No 'Gods Eye' images found in that folder.");
                                                return;
                                            }

                                            if (confirm(`Found ${files.length} Gods Eye images. Import them?`)) {
                                                await handleImport(files as any);
                                            }
                                        }}
                                    />
                                </label>

                                <button
                                    onClick={() => setShowManageFiles(false)}
                                    className="text-text-secondary hover:text-text-primary transition"
                                >
                                    ✕
                                </button>
                            </div>
                        </div>
                        {mediaFiles.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                {mediaFiles.map((file) => (
                                    <div key={file.id} className="group relative bg-surface/40 backdrop-blur-md rounded-xl overflow-hidden border border-white/5 hover:border-white/10 hover:-translate-y-1 hover:shadow-lg transition-all duration-300">
                                        {/* Preview */}
                                        <div className="aspect-square bg-black/20 flex items-center justify-center overflow-hidden">
                                            {file.file_type === 'image' ? (
                                                <img src={file.file_url} alt="Media" className="w-full h-full object-cover" />
                                            ) : (
                                                <video src={file.file_url} className="w-full h-full object-cover" />
                                            )}
                                        </div>

                                        {/* Info Overlay */}
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="text-xs text-white font-mono mb-1">{formatBytes(file.compressed_size)}</div>
                                            <div className="text-[10px] text-white/60">{file.compression_ratio?.toFixed(0)}% compressed</div>
                                        </div>

                                        {/* Delete Button */}
                                        <button
                                            onClick={async () => {
                                                if (confirm('Delete this file?')) {
                                                    const success = await deleteMediaFile(file.id);
                                                    if (success) {
                                                        setMediaFiles(prev => prev.filter(f => f.id !== file.id));
                                                        // Refresh quota
                                                        const newQuota = await getUserStorageQuota(user!.id);
                                                        setStorageQuota(newQuota);
                                                    }
                                                }
                                            }}
                                            className="absolute top-2 right-2 bg-red-500 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-text-secondary text-sm text-center py-12 bg-white/[0.02] rounded-xl border border-dashed border-white/10">
                                No media files stored yet. Generate images or videos to see them here!
                            </div>
                        )}
                    </div>
                )
            }

            {/* My Generations - Unified Gallery */}
            <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-text-primary mb-4">My Generations</h3>
                <MyGenerationsGallery userId={user!.id} />
            </div>
        </div >
    );
};

// My Generations Gallery Component
const MyGenerationsGallery: React.FC<{ userId: string }> = ({ userId }) => {
    const [generations, setGenerations] = useState<any[]>([]);
    const [filter, setFilter] = useState<'all' | 'image' | 'video' | 'character'>('all');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadGenerations = async () => {
            // Replaced Supabase with Local Storage (IndexedDB)
            const { getLocalGallery } = await import('../services/localStorageService');
            // Pass userId to filter by this user profile
            const gens = await getLocalGallery(userId);

            // Map IndexedDB format to UI format
            const mapped = gens.map(g => ({
                id: g.id,
                content_url: g.url,
                type: 'image', // Local only supports images for now
                created_at: g.timestamp,
                prompt: g.prompt
            }));

            // Client-side filter (since DB doesn't support complex filters yet)
            setGenerations(mapped); // Currently only 'image' type is supported locally
            setLoading(false);
        };
        loadGenerations();
    }, [userId, filter]);

    if (loading) {
        return <div className="text-text-secondary text-center py-8">Loading...</div>;
    }

    return (
        <>
            {/* Filter Tabs */}
            <div className="flex gap-2 mb-4">
                {['all', 'image', 'video', 'character'].map((f) => (
                    <button
                        key={f}
                        onClick={() => setFilter(f as any)}
                        className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-300 ${filter === f
                            ? 'bg-brand text-bg shadow-lg shadow-brand/20'
                            : 'bg-white/5 text-text-secondary hover:text-text-primary hover:bg-white/10'
                            }`}
                    >
                        {f.charAt(0).toUpperCase() + f.slice(1)}s
                    </button>
                ))}
            </div>

            {/* Gallery Grid */}
            {generations.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {generations.map((gen) => (
                        <div
                            key={gen.id}
                            className="group relative bg-surface/40 backdrop-blur-md rounded-xl overflow-hidden border border-white/5 hover:border-white/10 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 aspect-square"
                        >
                            {gen.type === 'image' && (
                                <img src={gen.content_url} alt="Generated" className="w-full h-full object-cover" />
                            )}
                            {gen.type === 'video' && (
                                <video src={gen.content_url} className="w-full h-full object-cover" />
                            )}
                            {gen.type === 'character' && (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-brand/20 to-transparent">
                                    <span className="text-2xl">👤</span>
                                </div>
                            )}

                            {/* Type Badge */}
                            <div className="absolute top-2 left-2 bg-black/70 text-white px-2 py-1 rounded text-[10px] font-bold uppercase">
                                {gen.type}
                            </div>

                            {/* Date */}
                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="text-[10px] text-white/60">
                                    {new Date(gen.created_at).toLocaleDateString()}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-text-secondary text-sm text-center py-12 bg-white/[0.02] rounded-xl border border-dashed border-white/10">
                    No generations yet. Start creating to see them here!
                </div>
            )}
        </>
    );
};

// API Key Input Component
const ApiKeyInput: React.FC = () => {
    const [key, setKey] = useState('');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem('user_gemini_key');
        if (stored) setKey(stored);
    }, []);

    const handleSave = () => {
        if (key) {
            localStorage.setItem('user_gemini_key', key);
        } else {
            localStorage.removeItem('user_gemini_key');
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    return (
        <div className="flex items-center gap-2">
            <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste API Key"
                className="flex-1 bg-surface/50 border border-white/10 rounded-full px-3 py-1.5 text-xs text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none transition-all"
            />
            <button
                onClick={handleSave}
                className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all duration-300 ${saved ? 'bg-green-500 text-white shadow-lg shadow-green-500/20' : 'bg-brand text-bg hover:brightness-110 active:scale-95 shadow-lg shadow-brand/20'}`}
            >
                {saved ? 'Saved' : 'Save'}
            </button>
        </div>
    );
};
