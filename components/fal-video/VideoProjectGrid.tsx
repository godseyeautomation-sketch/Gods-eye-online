import React, { useState, useRef, useEffect } from 'react';
import { Plus, FolderOpen, Trash2, Film, X } from 'lucide-react';
import { useVideoProjects } from '../../context/VideoProjectContext';

export const VideoProjectGrid: React.FC = () => {
  const { projects, createProject, openProject, deleteProject } = useVideoProjects();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) inputRef.current?.focus();
  }, [isCreating]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const project = await createProject(name);
    setNewName('');
    setIsCreating(false);
    openProject(project.id);
  };

  return (
    <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
      {/* ── Create New Project Tile ── */}
      {!isCreating ? (
        <div
          onClick={() => setIsCreating(true)}
          className="relative rounded-2xl overflow-hidden border-2 border-dashed border-white/10 aspect-[4/5] cursor-pointer
                     hover:border-[#c8ff00]/40 hover:bg-[#c8ff00]/[0.03] transition-all group flex flex-col items-center justify-center gap-3"
        >
          <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center
                          group-hover:bg-[#c8ff00]/10 group-hover:border-[#c8ff00]/30 transition-all">
            <Plus size={24} className="text-white/30 group-hover:text-[#c8ff00] transition-colors" />
          </div>
          <p className="text-white/30 text-[12px] font-medium group-hover:text-white/50 transition-colors">New Project</p>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden border-2 border-[#c8ff00]/40 bg-[#c8ff00]/[0.03] aspect-[4/5]
                        flex flex-col items-center justify-center gap-3 p-4">
          <FolderOpen size={28} className="text-[#c8ff00]/60" />
          <input
            ref={inputRef}
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') { setIsCreating(false); setNewName(''); } }}
            placeholder="Project name..."
            className="w-full bg-white/[0.06] border border-white/10 rounded-lg px-3 py-2 text-[13px] text-white/80
                       placeholder:text-white/25 outline-none focus:border-[#c8ff00]/40 transition-colors text-center"
            maxLength={40}
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-1.5 bg-[#c8ff00] text-black text-[12px] font-bold rounded-full
                         disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#d4ff33] transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setIsCreating(false); setNewName(''); }}
              className="px-3 py-1.5 bg-white/[0.06] text-white/40 text-[12px] rounded-full hover:bg-white/10 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Existing Project Folder Cards ── */}
      {projects.map(project => (
        <div
          key={project.id}
          onClick={() => openProject(project.id)}
          className="relative group cursor-pointer rounded-2xl overflow-hidden border border-white/[0.06] bg-[#111] aspect-[4/5]
                     hover:border-white/15 hover:bg-[#161616] transition-all"
        >
          {/* Folder visual */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-16 h-16 rounded-xl bg-white/[0.04] border border-white/8 flex items-center justify-center
                            group-hover:bg-[#c8ff00]/[0.06] group-hover:border-[#c8ff00]/20 transition-all">
              <Film size={28} className="text-white/20 group-hover:text-[#c8ff00]/60 transition-colors" />
            </div>
          </div>

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
            <p className="text-white text-[13px] font-bold truncate">{project.name}</p>
            <p className="text-white/30 text-[10px] mt-0.5">
              {new Date(project.createdAt).toLocaleDateString()}
            </p>
          </div>

          {/* Delete button (hover) */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all">
            <button
              onClick={e => { e.stopPropagation(); deleteProject(project.id); }}
              className="w-8 h-8 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center
                         text-white/50 hover:text-red-400 hover:bg-red-950/80 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
