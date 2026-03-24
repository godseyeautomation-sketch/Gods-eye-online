import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  listSkills, createSkill, deleteSkill, toggleSkill,
  searchMarketplace, installFromMarketplace, fetchSkillReadme,
  seedBuiltinSkills,
  type Skill, type MarketplaceSkill,
} from '../services/skillsService';
import { Search, Plus, Trash2, Power, Play, Download, ChevronRight, Sparkles, Store, Wrench, Bot, X } from 'lucide-react';

type Tab = 'my' | 'marketplace' | 'create';

export const AgenticPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('my');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(() => !!localStorage.getItem('godseye_skills_seeded'));

  // Marketplace
  const [mpQuery, setMpQuery] = useState('');
  const [mpResults, setMpResults] = useState<MarketplaceSkill[]>([]);
  const [mpLoading, setMpLoading] = useState(false);
  const [previewReadme, setPreviewReadme] = useState<string | null>(null);
  const [previewSkill, setPreviewSkill] = useState<MarketplaceSkill | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('custom');
  const [newIcon, setNewIcon] = useState('⚡');
  const [newIsAgent, setNewIsAgent] = useState(false);
  const [creating, setCreating] = useState(false);

  // Load skills
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      if (!seeded) {
        await seedBuiltinSkills(user.id);
        localStorage.setItem('godseye_skills_seeded', 'true');
        setSeeded(true);
      }
      const data = await listSkills(user.id);
      setSkills(data);
      setLoading(false);
    };
    load();
  }, [user, seeded]);

  const refresh = async () => {
    if (!user) return;
    const data = await listSkills(user.id);
    setSkills(data);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this skill?')) return;
    await deleteSkill(id);
    setSkills(prev => prev.filter(s => s.id !== id));
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await toggleSkill(id, !enabled);
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !enabled } : s));
  };

  const handleSearch = async () => {
    setMpLoading(true);
    const results = await searchMarketplace(mpQuery);
    // Mark installed ones
    const installedSlugs = new Set(skills.map(s => s.marketplace_id).filter(Boolean));
    setMpResults(results.map(r => ({ ...r, isInstalled: installedSlugs.has(r.id) })));
    setMpLoading(false);
  };

  const handlePreview = async (skill: MarketplaceSkill) => {
    setPreviewSkill(skill);
    setPreviewReadme(null);
    const readme = await fetchSkillReadme(skill.source);
    setPreviewReadme(readme || 'No README available');
  };

  const handleInstall = async (skill: MarketplaceSkill) => {
    if (!user) return;
    setInstalling(skill.id);
    const result = await installFromMarketplace(user.id, skill);
    if (result) {
      await refresh();
      setMpResults(prev => prev.map(r => r.id === skill.id ? { ...r, isInstalled: true } : r));
    }
    setInstalling(null);
  };

  const handleCreate = async () => {
    if (!user || !newName.trim() || !newContent.trim()) return;
    setCreating(true);
    await createSkill({
      user_id: user.id,
      name: newName.trim(),
      description: newDesc.trim(),
      content: newContent.trim(),
      category: newCategory,
      icon: newIcon,
      is_agent: newIsAgent,
    });
    setNewName(''); setNewDesc(''); setNewContent(''); setNewIcon('⚡'); setNewIsAgent(false);
    await refresh();
    setCreating(false);
    setTab('my');
  };

  const agents = skills.filter(s => s.is_agent);
  const regularSkills = skills.filter(s => !s.is_agent);

  const CATEGORIES = ['custom', 'marketing', 'creative', 'ads', 'strategy', 'analytics', 'automation'];
  const ICONS = ['⚡', '🎯', '📊', '🔍', '✍️', '🎨', '📋', '🔬', '🧠', '🚀', '💡', '📧', '🛒', '🎬', '🤖'];

  return (
    <div className="h-full overflow-y-auto bg-bg pt-16">
      <div className="max-w-4xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
              <Bot size={28} className="text-brand" />
              Skills & Agents
            </h1>
            <p className="text-sm text-text-secondary mt-1">Install, create, and manage AI skills and autonomous agents</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white/[0.03] rounded-xl p-1 w-fit">
          {([
            { id: 'my' as Tab, label: 'My Skills', icon: Wrench, count: skills.length },
            { id: 'marketplace' as Tab, label: 'Marketplace', icon: Store },
            { id: 'create' as Tab, label: 'Create New', icon: Plus },
          ]).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-brand text-bg'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.05]'
              }`}
            >
              <t.icon size={15} />
              {t.label}
              {t.count !== undefined && <span className="text-xs opacity-60">({t.count})</span>}
            </button>
          ))}
        </div>

        {/* My Skills Tab */}
        {tab === 'my' && (
          <div className="space-y-6">
            {loading ? (
              <div className="text-center py-20 text-text-secondary">Loading skills...</div>
            ) : skills.length === 0 ? (
              <div className="text-center py-20">
                <Sparkles size={40} className="mx-auto text-text-secondary/30 mb-3" />
                <p className="text-text-secondary">No skills yet</p>
                <p className="text-xs text-text-secondary/50 mt-1">Browse the marketplace or create your own</p>
              </div>
            ) : (
              <>
                {/* Agents section */}
                {agents.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Bot size={12} /> Agents ({agents.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {agents.map(skill => (
                        <SkillCard key={skill.id} skill={skill} onDelete={handleDelete} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Skills section */}
                {regularSkills.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Wrench size={12} /> Skills ({regularSkills.length})
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {regularSkills.map(skill => (
                        <SkillCard key={skill.id} skill={skill} onDelete={handleDelete} onToggle={handleToggle} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Marketplace Tab */}
        {tab === 'marketplace' && (
          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/40" />
                <input
                  type="text"
                  value={mpQuery}
                  onChange={e => setMpQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  placeholder="Search skills... (e.g. marketing, seo, copywriting)"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-sm"
                />
              </div>
              <button
                onClick={handleSearch}
                disabled={mpLoading}
                className="px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 disabled:opacity-50"
              >
                {mpLoading ? 'Searching...' : 'Search'}
              </button>
            </div>

            {mpResults.length > 0 ? (
              <div className="space-y-2">
                {mpResults.map(skill => (
                  <div key={skill.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-text-primary">{skill.name}</p>
                      <p className="text-xs text-text-secondary">{skill.description || skill.source}</p>
                    </div>
                    <span className="text-xs text-text-secondary/40">⬇ {skill.installs.toLocaleString()}</span>
                    {skill.source && (
                      <button
                        onClick={() => handlePreview(skill)}
                        className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.05] transition-all"
                      >
                        Preview
                      </button>
                    )}
                    <button
                      onClick={() => handleInstall(skill)}
                      disabled={skill.isInstalled || installing === skill.id}
                      className="px-3 py-1.5 rounded-lg bg-brand/10 border border-brand/20 text-brand text-xs font-medium hover:bg-brand/20 transition-all disabled:opacity-30"
                    >
                      {skill.isInstalled ? 'Installed' : installing === skill.id ? 'Installing...' : 'Install'}
                    </button>
                  </div>
                ))}
              </div>
            ) : !mpLoading ? (
              <div className="text-center py-16">
                <Store size={40} className="mx-auto text-text-secondary/20 mb-3" />
                <p className="text-text-secondary text-sm">Search the skills.sh marketplace</p>
                <p className="text-xs text-text-secondary/40 mt-1">Thousands of community-built skills and agents</p>
              </div>
            ) : null}

            {/* Preview modal */}
            {previewSkill && (
              <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setPreviewSkill(null)}>
                <div className="bg-bg border border-white/10 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
                    <div>
                      <h3 className="text-sm font-bold text-text-primary">{previewSkill.name}</h3>
                      <p className="text-xs text-text-secondary">{previewSkill.source}</p>
                    </div>
                    <button onClick={() => setPreviewSkill(null)} className="text-text-secondary hover:text-text-primary">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="p-5 overflow-y-auto max-h-[60vh]">
                    {previewReadme === null ? (
                      <p className="text-text-secondary text-sm">Loading...</p>
                    ) : (
                      <pre className="text-xs text-text-secondary whitespace-pre-wrap font-mono leading-relaxed">{previewReadme}</pre>
                    )}
                  </div>
                  <div className="px-5 py-3 border-t border-white/5 flex justify-end">
                    <button
                      onClick={() => { handleInstall(previewSkill); setPreviewSkill(null); }}
                      className="px-4 py-2 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110"
                    >
                      Install Skill
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Create Tab */}
        {tab === 'create' && (
          <div className="max-w-lg space-y-5">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-widest">Name</label>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Email Copywriter"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-widest">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                placeholder="Short description of what this skill does"
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-sm"
              />
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-widest">Category</label>
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-text-primary text-sm focus:outline-none focus:border-brand/40"
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-widest">Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {ICONS.slice(0, 8).map(ic => (
                    <button
                      key={ic}
                      onClick={() => setNewIcon(ic)}
                      className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all ${
                        newIcon === ic ? 'bg-brand/20 border border-brand/40' : 'bg-white/5 border border-white/5 hover:bg-white/10'
                      }`}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setNewIsAgent(!newIsAgent)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm transition-all ${
                  newIsAgent ? 'border-brand bg-brand/10 text-brand' : 'border-white/10 text-text-secondary hover:bg-white/5'
                }`}
              >
                <Bot size={14} />
                {newIsAgent ? 'Agent (multi-step)' : 'Skill (single prompt)'}
              </button>
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1.5 uppercase tracking-widest">
                System Prompt / Instructions
              </label>
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Write the system prompt that defines this skill's behavior. Be specific about what tools it can use and how it should respond..."
                rows={8}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/20 focus:outline-none focus:border-brand/40 text-[13px] font-mono resize-none"
              />
            </div>

            <button
              onClick={handleCreate}
              disabled={!newName.trim() || !newContent.trim() || creating}
              className="px-6 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-30"
            >
              {creating ? 'Creating...' : 'Create Skill'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Skill Card Component ────────────────────────────────────────────────────

const SkillCard: React.FC<{
  skill: Skill;
  onDelete: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}> = ({ skill, onDelete, onToggle }) => (
  <div className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border transition-all ${
    skill.enabled
      ? 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]'
      : 'border-white/5 bg-white/[0.01] opacity-50'
  }`}>
    <span className="text-xl mt-0.5">{skill.icon}</span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold text-text-primary truncate">{skill.name}</p>
        {skill.is_agent && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand/10 text-brand">AGENT</span>
        )}
        {skill.source === 'marketplace' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">MARKETPLACE</span>
        )}
        {skill.source === 'builtin' && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-white/5 text-text-secondary">BUILT-IN</span>
        )}
      </div>
      <p className="text-xs text-text-secondary mt-0.5 truncate">{skill.description}</p>
      <p className="text-[10px] text-text-secondary/30 mt-1 font-mono">/{skill.slug}</p>
    </div>
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <button
        onClick={() => onToggle(skill.id, skill.enabled)}
        className={`p-1.5 rounded-lg transition-all ${
          skill.enabled ? 'text-green-400 hover:bg-green-500/10' : 'text-text-secondary/30 hover:bg-white/5'
        }`}
        title={skill.enabled ? 'Disable' : 'Enable'}
      >
        <Power size={14} />
      </button>
      {skill.source !== 'builtin' && (
        <button
          onClick={() => onDelete(skill.id)}
          className="p-1.5 rounded-lg text-text-secondary/30 hover:text-red-400 hover:bg-red-500/10 transition-all"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  </div>
);
