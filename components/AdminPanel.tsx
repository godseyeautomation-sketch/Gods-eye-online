import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Activity, Settings, AlertTriangle, Search, Ban, RotateCcw, Save, Video, Plus, Trash2, CheckCircle2, Key } from 'lucide-react';
import { Button } from './Button';
import { MOCK_USERS, MOCK_USAGE_DATA, INITIAL_VIDEO_EFFECTS } from '../constants';
import { User, VideoEffect } from '../types';

const TIER_LIMITS: Record<string, number> = {
    'Free': 50,
    'Pro': 500,
    'Max': 2000,
    'Admin': 10000
};

export const AdminPanel: React.FC = () => {
    // local feature access state merged into the users array
    // (using the user fields canUseVideo, canUseSpaces)
    const [users, setUsers] = useState<User[]>([]);
    const [usageData, setUsageData] = useState<any[]>([]); // For chart
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'users' | 'api' | 'usage' | 'effects'>('users');

    // Configuration is managed via environment variables and system dialogs
    const [apiConfig, setApiConfig] = useState({
        defaultModel: 'Nano Banana Pro',
        safetyFilter: 'Medium'
    });

    const [savedSuccess, setSavedSuccess] = useState(false);

    // Effects State
    const [effects, setEffects] = useState<VideoEffect[]>(() => {
        const stored = localStorage.getItem('video_effects');
        return stored ? JSON.parse(stored) : INITIAL_VIDEO_EFFECTS;
    });

    const [newEffect, setNewEffect] = useState<Partial<VideoEffect>>({
        name: '',
        category: 'Viral',
        thumbnail: '',
        promptTemplate: ''
    });

    // Fetch Real Data on Mount
    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            try {
                // 1. Fetch Users
                const { getAllUsers, getWeeklyAnalytics } = await import('../services/adminService');
                const realUsers = await getAllUsers();

                // Transform DB profiles to UI User objects
                const formattedUsers: User[] = realUsers.map((p: any) => ({
                    id: p.id,
                    name: p.full_name || p.email?.split('@')[0] || 'Unknown',
                    email: p.email || 'N/A', // joined from auth.users
                    status: p.is_banned ? 'banned' : 'active',
                    usage: p.credits !== undefined ? p.credits : 0,
                    limit: TIER_LIMITS[p.tier || 'Free'] || 50, // Dynamic Limit
                    joinedAt: new Date(p.created_at).toLocaleDateString(),
                    lastActive: p.last_sign_in_at ? new Date(p.last_sign_in_at).toLocaleDateString() : 'Never',
                    canUseByok: p.can_use_byok,
                    canUseVideo: p.can_use_video,
                    canUseSpaces: p.can_use_spaces,
                    tier: p.tier || 'Free'
                }));
                setUsers(formattedUsers);

                // 2. Fetch Analytics
                const analytics = await getWeeklyAnalytics();
                // Transform for Recharts (reverse to show Mon->Sun)
                const chartData = analytics.map((day: any) => ({
                    name: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }),
                    apiCalls: Number(day.image_count) + Number(day.video_count),
                    cost: Number(day.total_cost_inr)
                })).reverse();
                setUsageData(chartData);

            } catch (error) {
                console.error("Failed to load admin data", error);
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, []);

    const handleBanUser = (id: string) => {
        setUsers(users.map(u => u.id === id ? { ...u, status: u.status === 'active' ? 'banned' : 'active' } : u));
    };

    const handleResetLimit = (id: string) => {
        setUsers(users.map(u => u.id === id ? { ...u, usage: 0 } : u));
    };

    const handleSaveApiConfig = () => {
        // Configuration preferences are handled internally; global key is in environment
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
    };

    const handleAddEffect = () => {
        if (!newEffect.name || !newEffect.thumbnail) return;

        const effect: VideoEffect = {
            id: Date.now().toString(),
            name: newEffect.name.toUpperCase(),
            category: newEffect.category || 'Viral',
            thumbnail: newEffect.thumbnail,
            promptTemplate: newEffect.promptTemplate || '',
            modelCompatibility: ['kling-2.6']
        };

        const updatedEffects = [...effects, effect];
        setEffects(updatedEffects);
        localStorage.setItem('video_effects', JSON.stringify(updatedEffects));
        setNewEffect({ name: '', category: 'Viral', thumbnail: '', promptTemplate: '' });
    };

    const handleDeleteEffect = (id: string) => {
        const updatedEffects = effects.filter(e => e.id !== id);
        setEffects(updatedEffects);
        localStorage.setItem('video_effects', JSON.stringify(updatedEffects));
    };

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in pb-32 pt-32 text-text-primary">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-text-primary mb-2">Admin Dashboard</h1>
                    <p className="text-text-secondary">Manage users, monitor usage, and configure AI models.</p>
                </div>
                <div className="flex gap-1 bg-surface/40 backdrop-blur-md p-1 rounded-full border border-white/5">
                    {(['users', 'effects', 'usage', 'api'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 ${activeTab === tab ? 'bg-brand text-bg shadow-lg shadow-brand/20' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'}`}
                        >
                            {tab === 'users' ? 'Users' : tab === 'effects' ? 'Video Effects' : tab === 'usage' ? 'Analytics' : 'API Config'}
                        </button>
                    ))}
                </div>
            </div>

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl">
                    <div className="p-4 border-b border-white/5 flex justify-between items-center">
                        <h3 className="font-semibold text-text-primary">User Management</h3>
                        <div className="relative flex items-center">
                            <Search className="absolute left-3 text-neutral-500 pointer-events-none" size={16} />
                            <input
                                type="text"
                                placeholder="Search users..."
                                className="bg-surface/50 border border-white/10 rounded-full pl-9 pr-4 py-2 text-sm text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none w-64 h-10 transition-all focus:w-72"
                            />
                        </div>
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="bg-white/[0.03] text-text-secondary">
                                <th className="px-6 py-4 font-medium">User</th>
                                <th className="px-6 py-4 font-medium">Status</th>
                                <th className="px-6 py-4 font-medium">Credits Available</th>
                                <th className="px-6 py-4 font-medium">BYOK</th>
                                <th className="px-6 py-4 font-medium">Video</th>
                                <th className="px-6 py-4 font-medium">Spaces</th>
                                <th className="px-6 py-4 font-medium">Plan</th>
                                <th className="px-6 py-4 font-medium">Last Active</th>
                                <th className="px-6 py-4 font-medium text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="hover:bg-white/[0.03] transition-all duration-200">
                                    <td className="px-6 py-4">
                                        <div className="font-medium text-text-primary">{user.name}</div>
                                        <div className="text-text-secondary text-xs">{user.email}</div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${user.status === 'active' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                            {user.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            {/* Numeric Input Only (Bar Removed) */}
                                            <input
                                                type="number"
                                                value={user.usage}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value);
                                                    setUsers(users.map(u => u.id === user.id ? { ...u, usage: val } : u));
                                                }}
                                                className="w-14 bg-surface/50 border border-white/10 rounded-lg px-1 py-0.5 text-xs text-center outline-none focus:border-brand/30 focus:ring-1 focus:ring-brand/20"
                                            />
                                            <span className="text-text-secondary text-xs">/ {user.limit} Left</span>

                                            {/* Save Button for Credits */}
                                            <button
                                                onClick={async () => {
                                                    const { updateUserCredits } = await import('../services/adminService');
                                                    const success = await updateUserCredits(user.id, user.usage);
                                                    if (success) {
                                                        // Visual feedback
                                                        alert("Credits Saved!");
                                                    } else {
                                                        alert("Failed to save credits.");
                                                    }
                                                }}
                                                title="Save Credits"
                                                className="p-1 hover:text-brand transition"
                                            >
                                                <Save size={14} />
                                            </button>
                                        </div>
                                    </td>
                                    {/* BYOK Toggle Column */}
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const { toggleUserByok } = await import('../services/adminService');
                                                    const success = await toggleUserByok(user.id, !user.canUseByok);
                                                    if (success) {
                                                        setUsers(users.map(u => u.id === user.id ? { ...u, canUseByok: !u.canUseByok } : u));
                                                    } else {
                                                        alert("Failed to update BYOK status. Check console/RLS.");
                                                    }
                                                } catch (e) {
                                                    alert("Error updating BYOK: " + e);
                                                }
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${user.canUseByok ? 'bg-brand/10 text-brand border-brand/50 shadow-[0_0_10px_rgba(202,255,0,0.2)]' : 'bg-surface/50 text-text-secondary border-white/10 hover:border-white/20 hover:text-white'}`}
                                        >
                                            <Key size={12} /> {user.canUseByok ? 'Enabled' : 'Disabled'}
                                        </button>
                                    </td>
                                    {/* Video Access Toggle */}
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const { toggleVideoAccess } = await import('../services/adminService');
                                                    const success = await toggleVideoAccess(user.id, !user.canUseVideo);
                                                    if (success) {
                                                        setUsers(users.map(u => u.id === user.id ? { ...u, canUseVideo: !u.canUseVideo } : u));
                                                    }
                                                } catch (e) { alert('Error: ' + e); }
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${user.canUseVideo ? 'bg-brand/10 text-brand border-brand/50 shadow-[0_0_10px_rgba(202,255,0,0.2)]' : 'bg-surface/50 text-text-secondary border-white/10 hover:border-white/20 hover:text-white'}`}
                                        >
                                            {user.canUseVideo ? '✓ On' : 'Off'}
                                        </button>
                                    </td>
                                    {/* Spaces Access Toggle */}
                                    <td className="px-6 py-4">
                                        <button
                                            onClick={async () => {
                                                try {
                                                    const { toggleSpacesAccess } = await import('../services/adminService');
                                                    const success = await toggleSpacesAccess(user.id, !user.canUseSpaces);
                                                    if (success) {
                                                        setUsers(users.map(u => u.id === user.id ? { ...u, canUseSpaces: !u.canUseSpaces } : u));
                                                    }
                                                } catch (e) { alert('Error: ' + e); }
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${user.canUseSpaces ? 'bg-brand/10 text-brand border-brand/50 shadow-[0_0_10px_rgba(202,255,0,0.2)]' : 'bg-surface/50 text-text-secondary border-white/10 hover:border-white/20 hover:text-white'}`}
                                        >
                                            {user.canUseSpaces ? '✓ On' : 'Off'}
                                        </button>
                                    </td>
                                    {/* PLAN / TIER SELECTOR */}
                                    <td className="px-6 py-4">
                                        <select
                                            value={user.tier || 'Free'}
                                            onChange={async (e) => {
                                                const newTier = e.target.value;
                                                const newLimit = TIER_LIMITS[newTier] || 50;

                                                try {
                                                    const { updateUserTier, updateUserCredits } = await import('../services/adminService');

                                                    // 1. Update Tier
                                                    await updateUserTier(user.id, newTier);

                                                    // 2. Auto-Update Credits to match the new Tier's limit
                                                    await updateUserCredits(user.id, newLimit);

                                                    setUsers(users.map(u => u.id === user.id ? {
                                                        ...u,
                                                        tier: newTier,
                                                        usage: newLimit, // Update UI Balance immediately
                                                        limit: newLimit
                                                    } : u));

                                                } catch (err) {
                                                    alert("Failed to update Tier/Credits");
                                                    console.error(err);
                                                }
                                            }}
                                            className={`bg-surface/50 border border-white/10 rounded-xl px-2 py-1 text-xs font-bold outline-none cursor-pointer focus:border-brand/30 focus:ring-1 focus:ring-brand/20 ${user.tier === 'Admin' ? 'text-purple-400 border-purple-500/30' :
                                                user.tier === 'Max' ? 'text-amber-400 border-amber-500/30' :
                                                    user.tier === 'Pro' ? 'text-brand border-brand/30' : 'text-text-secondary'
                                                }`}
                                        >
                                            <option value="Free">Free</option>
                                            <option value="Pro">Pro</option>
                                            <option value="Max">Max</option>
                                            <option value="Admin">Admin</option>
                                        </select>
                                    </td>
                                    <td className="px-6 py-4 text-text-secondary">{user.lastActive}</td>
                                    <td className="px-6 py-4 text-right space-x-2">
                                        <button
                                            onClick={() => handleResetLimit(user.id)}
                                            title="Reset Usage Limit"
                                            className="p-2 text-text-secondary hover:text-brand hover:bg-brand/10 rounded-lg transition-colors"
                                        >
                                            <RotateCcw size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleBanUser(user.id)}
                                            title={user.status === 'active' ? "Ban User" : "Unban User"}
                                            className={`p-2 rounded-lg transition-colors ${user.status === 'active' ? 'text-text-secondary hover:text-red-500 hover:bg-red-500/10' : 'text-red-500 bg-red-500/10'}`}
                                        >
                                            <Ban size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Video Effects Tab */}
            {activeTab === 'effects' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-1 bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 h-fit">
                        <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                            <Video size={18} className="text-brand" /> Add New Video Effect
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">Effect Name</label>
                                <input
                                    type="text"
                                    value={newEffect.name}
                                    onChange={e => setNewEffect({ ...newEffect, name: e.target.value })}
                                    placeholder="e.g. GIANT GRAB"
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">Category</label>
                                <select
                                    value={newEffect.category}
                                    onChange={e => setNewEffect({ ...newEffect, category: e.target.value })}
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none transition-all"
                                >
                                    <option>Viral</option>
                                    <option>Effects</option>
                                    <option>UGC</option>
                                    <option>New</option>
                                    <option>All</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">Thumbnail URL</label>
                                <input
                                    type="text"
                                    value={newEffect.thumbnail}
                                    onChange={e => setNewEffect({ ...newEffect, thumbnail: e.target.value })}
                                    placeholder="https://..."
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-text-secondary mb-1">Prompt Template</label>
                                <textarea
                                    value={newEffect.promptTemplate}
                                    onChange={e => setNewEffect({ ...newEffect, promptTemplate: e.target.value })}
                                    placeholder="Prompt that defines this effect..."
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-3 py-2 text-sm text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none transition-all h-24 resize-none"
                                />
                            </div>
                            <Button onClick={handleAddEffect} className="w-full gap-2">
                                <Plus size={16} /> Add Effect
                            </Button>
                        </div>
                    </div>

                    <div className="lg:col-span-2 bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl overflow-hidden">
                        <div className="p-4 border-b border-white/5">
                            <h3 className="font-semibold text-text-primary">Active Effects Library</h3>
                        </div>
                        <div className="max-h-[600px] overflow-y-auto p-4">
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                                {effects.map(effect => (
                                    <div key={effect.id} className="group relative aspect-[3/4] bg-surface/40 rounded-xl overflow-hidden border border-white/5 hover:border-white/10 hover:shadow-lg transition-all duration-300">
                                        <img src={effect.thumbnail} alt={effect.name} className="w-full h-full object-cover opacity-75 group-hover:opacity-100 transition-opacity" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex flex-col justify-end">
                                            <h4 className="text-xs font-bold text-white uppercase truncate">{effect.name}</h4>
                                            <span className="text-[10px] text-neutral-300">{effect.category}</span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteEffect(effect.id)}
                                            className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-600 text-white p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Usage Analytics Tab */}
            {activeTab === 'usage' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                        <h3 className="font-semibold text-text-primary mb-6">Total Generations (This Week)</h3>
                        <div className="h-64 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={usageData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                                    <XAxis dataKey="name" stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="var(--text-secondary)" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px' }}
                                        itemStyle={{ color: 'var(--text-primary)' }}
                                    />
                                    <Bar dataKey="apiCalls" fill="var(--brand)" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6">
                        <h3 className="font-semibold text-text-primary mb-6">System Health</h3>
                        <div className="space-y-4">
                            <div className="bg-white/[0.03] backdrop-blur-md p-4 rounded-xl border border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-green-500/10 text-green-500 rounded-lg"><Activity size={20} /></div>
                                    <div>
                                        <div className="text-text-primary font-medium">Gemini API Status</div>
                                        <div className="text-xs text-text-secondary">Operational • 99.9% Uptime</div>
                                    </div>
                                </div>
                                <div className="h-3 w-3 bg-green-500 rounded-full shadow-lg"></div>
                            </div>

                            <div className="bg-white/[0.03] backdrop-blur-md p-4 rounded-xl border border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-yellow-500/10 text-yellow-500 rounded-lg"><AlertTriangle size={20} /></div>
                                    <div>
                                        <div className="text-text-primary font-medium">Error Rate</div>
                                        <div className="text-xs text-text-secondary">0.4% Failed requests in last 24h</div>
                                    </div>
                                </div>
                                <span className="text-yellow-500 font-mono">0.4%</span>
                            </div>

                            <div className="bg-white/[0.03] backdrop-blur-md p-4 rounded-xl border border-white/5 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Users size={20} /></div>
                                    <div>
                                        <div className="text-text-primary font-medium">Active Sessions</div>
                                        <div className="text-xs text-text-secondary">Currently generating content</div>
                                    </div>
                                </div>
                                <span className="text-text-primary font-mono">42</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* API Config Tab */}
            {activeTab === 'api' && (
                <div className="bg-panel/60 backdrop-blur-xl border border-white/5 rounded-2xl p-6 max-w-2xl">
                    <h3 className="font-semibold text-text-primary mb-6">Global API Configuration</h3>
                    <div className="space-y-6">
                        <div className="p-4 bg-brand/5 border border-brand/20 rounded-xl">
                            <p className="text-xs text-text-secondary leading-relaxed">
                                API Key management is restricted to authorized environment variables and secure system dialogs for Pro/Veo models.
                                Refer to the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-brand font-bold hover:underline">Gemini Billing Documentation</a> for paid project requirements.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Default Model</label>
                                <select
                                    value={apiConfig.defaultModel}
                                    onChange={(e) => setApiConfig({ ...apiConfig, defaultModel: e.target.value })}
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-4 py-3 text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none appearance-none transition-all"
                                >
                                    <option>Nano Banana Pro</option>
                                    <option>Nano Banana</option>
                                    <option>Seedream</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-text-secondary mb-2">Safety Filter Level</label>
                                <select
                                    value={apiConfig.safetyFilter}
                                    onChange={(e) => setApiConfig({ ...apiConfig, safetyFilter: e.target.value })}
                                    className="w-full bg-surface/50 border border-white/10 rounded-xl px-4 py-3 text-text-primary focus:border-brand/30 focus:ring-1 focus:ring-brand/20 outline-none appearance-none transition-all"
                                >
                                    <option>High</option>
                                    <option>Medium</option>
                                    <option>Low</option>
                                    <option>None</option>
                                </select>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-white/5 flex justify-end items-center gap-3">
                            {savedSuccess && <span className="text-brand text-sm flex items-center gap-1"><CheckCircle2 size={16} /> Saved</span>}
                            <Button variant="primary" className="gap-2" onClick={handleSaveApiConfig}>
                                <Save size={16} /> Save Changes
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
