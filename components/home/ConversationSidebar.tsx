import React, { useState, useEffect } from 'react';
import type { Conversation } from '../../services/conversationService';
import { useAuth } from '../../context/AuthContext';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  userName?: string;
  onNavigate?: (mode: string) => void;
  skillsCount?: number;
}

export const ConversationSidebar: React.FC<Props> = ({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  isOpen,
  onToggle,
  userName,
  onNavigate,
  skillsCount = 0,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const [showCron, setShowCron] = useState(false);
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    if (!showCron || !user) return;
    fetch('/api/cron/jobs', { headers: { 'x-user-id': user.id } })
      .then(r => r.json())
      .then(d => setCronJobs(d.jobs || []))
      .catch(() => {});
  }, [showCron, user]);

  const filtered = conversations.filter(c =>
    !search || c.title.toLowerCase().includes(search.toLowerCase())
  );

  const groupByDate = (convs: Conversation[]) => {
    const now = Date.now();
    const day = 86400000;
    const groups: { label: string; items: Conversation[] }[] = [
      { label: 'Today', items: [] },
      { label: 'Yesterday', items: [] },
      { label: 'Previous 7 days', items: [] },
      { label: 'Older', items: [] },
    ];
    for (const c of convs) {
      const age = now - c.updatedAt;
      if (age < day) groups[0].items.push(c);
      else if (age < 2 * day) groups[1].items.push(c);
      else if (age < 7 * day) groups[2].items.push(c);
      else groups[3].items.push(c);
    }
    return groups.filter(g => g.items.length > 0);
  };

  const groups = groupByDate(filtered);

  const handleSaveRename = () => {
    if (editingId && editTitle.trim()) onRename(editingId, editTitle.trim());
    setEditingId(null);
  };

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={onToggle} />}

      <div className={`
        fixed lg:relative z-40 lg:z-0 top-0 left-0 h-full
        w-[260px] flex-shrink-0
        bg-[#0a0a0a] border-r border-border-base
        flex flex-col
        transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Top section — clear the fixed header */}
        <div className="pt-20 px-3 space-y-0.5">
          {/* New chat */}
          <button
            onClick={onNew}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New chat
          </button>

          {/* Search */}
          <button
            onClick={() => setShowSearch(!showSearch)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-colors text-sm"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Search
          </button>

          {showSearch && (
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats..."
              className="w-full h-8 rounded-lg bg-white/5 border border-border-base px-3 text-xs text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-brand/30 mt-1"
            />
          )}
        </div>

        {/* Divider */}
        <div className="mx-3 my-2 border-t border-border-base" />

        {/* Recents label */}
        <div className="px-4 py-1">
          <span className="text-[11px] text-text-secondary/40 font-medium uppercase tracking-widest">Recents</span>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
          {groups.length === 0 && (
            <p className="text-center text-text-secondary/30 text-xs mt-6">No conversations yet</p>
          )}

          {groups.map((group) => (
            <div key={group.label} className="mb-1">
              {groups.length > 1 && (
                <p className="text-[10px] uppercase tracking-widest text-text-secondary/30 font-medium px-3 py-1.5 mt-2">{group.label}</p>
              )}
              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={`group relative flex items-center rounded-lg px-3 py-2 cursor-pointer transition-all duration-100 ${
                    c.id === activeId
                      ? 'bg-white/[0.07]'
                      : 'hover:bg-white/[0.04]'
                  }`}
                  onClick={() => { onSelect(c.id); if (window.innerWidth < 1024) onToggle(); }}
                >
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onBlur={handleSaveRename}
                      onKeyDown={(e) => e.key === 'Enter' && handleSaveRename()}
                      className="flex-1 bg-transparent text-sm text-text-primary outline-none border-b border-brand"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <p className="flex-1 text-[13px] text-text-secondary truncate leading-snug">{c.title}</p>
                  )}

                  {editingId !== c.id && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setContextMenu(contextMenu === c.id ? null : c.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 transition-all flex-shrink-0"
                    >
                      <svg className="w-3.5 h-3.5 text-text-secondary" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                  )}

                  {contextMenu === c.id && (
                    <div className="absolute right-2 top-full mt-1 z-10 bg-[#1a1a1a] border border-border-base rounded-lg shadow-2xl py-1 min-w-[100px]">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditTitle(c.title); setContextMenu(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-text-primary hover:bg-white/5"
                      >
                        Rename
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDelete(c.id); setContextMenu(null); }}
                        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Skills & Agents Section */}
        <div className="border-t border-border-base">
          <button
            onClick={() => { if (onNavigate) onNavigate('agentic'); }}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              <span className="text-[11px] text-text-secondary/60 font-medium uppercase tracking-widest">Skills & Agents</span>
              {skillsCount > 0 && <span className="text-[9px] text-text-secondary/30 ml-1">({skillsCount})</span>}
            </div>
            <svg className="w-3 h-3 text-text-secondary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Connectors Section */}
        <div className="border-t border-border-base">
          <button
            onClick={() => { if (onNavigate) onNavigate('connectors'); }}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.35 8.97" />
              </svg>
              <span className="text-[11px] text-text-secondary/60 font-medium uppercase tracking-widest">Connectors</span>
            </div>
            <svg className="w-3 h-3 text-text-secondary/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Cron Jobs Section */}
        <div className="border-t border-border-base">
          <button
            onClick={() => { if (onNavigate) onNavigate('CRON_JOBS'); else setShowCron(!showCron); }}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-[11px] text-text-secondary/60 font-medium uppercase tracking-widest">Cron Jobs</span>
            </div>
            <div className="flex items-center gap-1.5">
              {cronJobs.length > 0 && (
                <span className="text-[10px] bg-brand/20 text-brand px-1.5 py-0.5 rounded-full font-bold">{cronJobs.length}</span>
              )}
              <svg className={`w-3 h-3 text-text-secondary/40 transition-transform ${showCron ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {showCron && (
            <div className="px-2 pb-2 max-h-[200px] overflow-y-auto scrollbar-thin">
              {cronJobs.length === 0 ? (
                <p className="text-center text-text-secondary/30 text-[11px] py-3">
                  No cron jobs yet.<br/>
                  <span className="text-text-secondary/20">Ask in chat to create one</span>
                </p>
              ) : (
                cronJobs.map((job: any) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors group"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${job.enabled ? 'bg-green-400' : 'bg-white/20'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-text-secondary truncate">{job.name}</p>
                      <p className="text-[10px] text-text-secondary/30 font-mono">{job.cron_expression}</p>
                    </div>
                    {job.last_run_status && (
                      <span className={`text-[9px] px-1 py-0.5 rounded ${
                        job.last_run_status === 'success' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {job.last_run_status === 'success' ? '✓' : '✗'}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Bottom: user profile */}
        <div className="border-t border-border-base p-3">
          <div className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center text-brand text-sm font-bold flex-shrink-0">
              {(userName || 'G').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-text-primary truncate">{userName || 'Gods Eye User'}</p>
              <p className="text-[10px] text-text-secondary/50">Pro plan</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
