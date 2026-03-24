import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, Activity, Settings, AlertTriangle, Search, Ban, RotateCcw, Save, Video, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { Button } from './Button';
import { MOCK_USERS, MOCK_USAGE_DATA, INITIAL_VIDEO_EFFECTS } from '../constants';
import { User, VideoEffect } from '../types';

export const AdminPanel: React.FC = () => {
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
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
      if(!newEffect.name || !newEffect.thumbnail) return;
      
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
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-fade-in pb-32 text-text-primary">
      <div className="flex items-center justify-between">
        <div>
            <h1 className="text-3xl font-bold text-text-primary mb-2">Admin Dashboard</h1>
            <p className="text-text-secondary">Manage users, monitor usage, and configure AI models.</p>
        </div>
        <div className="flex gap-2 bg-panel p-1 rounded-lg border border-border-base">
            <button 
                onClick={() => setActiveTab('users')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
            >
                Users
            </button>
            <button 
                onClick={() => setActiveTab('effects')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'effects' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
            >
                Video Effects
            </button>
            <button 
                onClick={() => setActiveTab('usage')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'usage' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
            >
                Analytics
            </button>
            <button 
                onClick={() => setActiveTab('api')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'api' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
            >
                API Config
            </button>
        </div>
      </div>

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-panel border border-border-base rounded-xl overflow-hidden">
            <div className="p-4 border-b border-border-base flex justify-between items-center">
                <h3 className="font-semibold text-text-primary">User Management</h3>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" size={16} />
                    <input type="text" placeholder="Search users..." className="bg-surface border border-border-base rounded-lg pl-9 pr-4 py-2 text-sm text-text-primary focus:border-brand outline-none w-64"/>
                </div>
            </div>
            <table className="w-full text-left text-sm">
                <thead>
                    <tr className="bg-surface/50 text-text-secondary border-b border-border-base">
                        <th className="px-6 py-4 font-medium">User</th>
                        <th className="px-6 py-4 font-medium">Status</th>
                        <th className="px-6 py-4 font-medium">Usage / Limit</th>
                        <th className="px-6 py-4 font-medium">Last Active</th>
                        <th className="px-6 py-4 font-medium text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-border-base">
                    {users.map(user => (
                        <tr key={user.id} className="hover:bg-surface/30 transition-colors">
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
                                    <div className="w-24 h-2 bg-surface rounded-full overflow-hidden">
                                        <div 
                                            className="h-full bg-brand" 
                                            style={{ width: `${(user.usage / user.limit) * 100}%` }}
                                        ></div>
                                    </div>
                                    <span className="text-text-secondary text-xs">{user.usage} / {user.limit}</span>
                                </div>
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
              <div className="lg:col-span-1 bg-panel border border-border-base rounded-xl p-6 h-fit">
                  <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                      <Video size={18} className="text-brand"/> Add New Video Effect
                  </h3>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">Effect Name</label>
                          <input 
                            type="text" 
                            value={newEffect.name}
                            onChange={e => setNewEffect({...newEffect, name: e.target.value})}
                            placeholder="e.g. GIANT GRAB"
                            className="w-full bg-surface border border-border-base rounded-lg px-3 py-2 text-sm text-text-primary focus:border-brand outline-none"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">Category</label>
                          <select 
                            value={newEffect.category}
                            onChange={e => setNewEffect({...newEffect, category: e.target.value})}
                            className="w-full bg-surface border border-border-base rounded-lg px-3 py-2 text-sm text-text-primary focus:border-brand outline-none"
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
                            onChange={e => setNewEffect({...newEffect, thumbnail: e.target.value})}
                            placeholder="https://..."
                            className="w-full bg-surface border border-border-base rounded-lg px-3 py-2 text-sm text-text-primary focus:border-brand outline-none"
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">Prompt Template</label>
                          <textarea 
                            value={newEffect.promptTemplate}
                            onChange={e => setNewEffect({...newEffect, promptTemplate: e.target.value})}
                            placeholder="Prompt that defines this effect..."
                            className="w-full bg-surface border border-border-base rounded-lg px-3 py-2 text-sm text-text-primary focus:border-brand outline-none h-24 resize-none"
                          />
                      </div>
                      <Button onClick={handleAddEffect} className="w-full gap-2">
                          <Plus size={16} /> Add Effect
                      </Button>
                  </div>
              </div>

              <div className="lg:col-span-2 bg-panel border border-border-base rounded-xl overflow-hidden">
                  <div className="p-4 border-b border-border-base">
                      <h3 className="font-semibold text-text-primary">Active Effects Library</h3>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto p-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                          {effects.map(effect => (
                              <div key={effect.id} className="group relative aspect-[3/4] bg-surface rounded-lg overflow-hidden border border-border-base">
                                  <img src={effect.thumbnail} alt={effect.name} className="w-full h-full object-cover opacity-75 group-hover:opacity-100 transition-opacity" />
                                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent p-3 flex flex-col justify-end">
                                      <h4 className="text-xs font-bold text-white uppercase truncate">{effect.name}</h4>
                                      <span className="text-[10px] text-neutral-300">{effect.category}</span>
                                  </div>
                                  <button 
                                    onClick={() => handleDeleteEffect(effect.id)}
                                    className="absolute top-2 right-2 bg-red-500/80 hover:bg-red-600 text-white p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
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
            <div className="bg-panel border border-border-base rounded-xl p-6">
                <h3 className="font-semibold text-text-primary mb-6">Total Generations (This Week)</h3>
                <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={MOCK_USAGE_DATA}>
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
            
            <div className="bg-panel border border-border-base rounded-xl p-6">
                 <h3 className="font-semibold text-text-primary mb-6">System Health</h3>
                 <div className="space-y-4">
                    <div className="bg-surface p-4 rounded-lg border border-border-base flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-green-500/10 text-green-500 rounded-lg"><Activity size={20}/></div>
                            <div>
                                <div className="text-text-primary font-medium">Gemini API Status</div>
                                <div className="text-xs text-text-secondary">Operational • 99.9% Uptime</div>
                            </div>
                        </div>
                        <div className="h-3 w-3 bg-green-500 rounded-full shadow-lg"></div>
                    </div>
                    
                    <div className="bg-surface p-4 rounded-lg border border-border-base flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-yellow-500/10 text-yellow-500 rounded-lg"><AlertTriangle size={20}/></div>
                            <div>
                                <div className="text-text-primary font-medium">Error Rate</div>
                                <div className="text-xs text-text-secondary">0.4% Failed requests in last 24h</div>
                            </div>
                        </div>
                        <span className="text-yellow-500 font-mono">0.4%</span>
                    </div>

                     <div className="bg-surface p-4 rounded-lg border border-border-base flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Users size={20}/></div>
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
        <div className="bg-panel border border-border-base rounded-xl p-6 max-w-2xl">
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
                            onChange={(e) => setApiConfig({...apiConfig, defaultModel: e.target.value})}
                            className="w-full bg-surface border border-border-base rounded-lg px-4 py-3 text-text-primary focus:border-brand outline-none appearance-none"
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
                             onChange={(e) => setApiConfig({...apiConfig, safetyFilter: e.target.value})}
                             className="w-full bg-surface border border-border-base rounded-lg px-4 py-3 text-text-primary focus:border-brand outline-none appearance-none"
                         >
                            <option>High</option>
                            <option>Medium</option>
                            <option>Low</option>
                            <option>None</option>
                        </select>
                    </div>
                </div>

                <div className="pt-4 border-t border-border-base flex justify-end items-center gap-3">
                    {savedSuccess && <span className="text-brand text-sm flex items-center gap-1"><CheckCircle2 size={16}/> Saved</span>}
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
