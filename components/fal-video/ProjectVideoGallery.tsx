import React, { useState, Suspense } from 'react';
import { ArrowLeft, Play, Download, Trash2, Check, Combine, Loader2 } from 'lucide-react';
import { useVideoProjects } from '../../context/VideoProjectContext';
import { deleteVideoGeneration } from '../../services/localStorageService';
import { SelectionToolbar } from './SelectionToolbar';
import type { StoredVideo } from '../../services/localStorageService';

const VideoTimeline = React.lazy(() => import('./VideoTimeline'));

interface Props {
  onDownload: (url: string, filename: string) => void;
}

export const ProjectVideoGallery: React.FC<Props> = ({ onDownload }) => {
  const { activeProject, projectVideos, closeProject, refreshProjectVideos } = useVideoProjects();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showTimeline, setShowTimeline] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<string | null>(null);
  const hasSelection = selectedIds.size > 0;

  if (!activeProject) return null;

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteVideoGeneration(id);
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    refreshProjectVideos();
  };

  const selectedVideos = projectVideos.filter(v => selectedIds.has(v.id));

  return (
    <div className="flex-1 overflow-y-auto p-4 relative">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={closeProject}
          className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/8 flex items-center justify-center
                     text-white/40 hover:text-white hover:bg-white/10 transition-all"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-white text-[15px] font-bold truncate">{activeProject.name}</h2>
          <p className="text-white/30 text-[11px]">{projectVideos.length} video{projectVideos.length !== 1 ? 's' : ''}</p>
        </div>
        {hasSelection && (
          <span className="text-[11px] text-[#c8ff00]/70 bg-[#c8ff00]/10 px-2.5 py-1 rounded-full">
            {selectedIds.size} selected
          </span>
        )}
      </div>

      {/* Video Grid */}
      {projectVideos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-white/[0.03] border border-white/8 flex items-center justify-center mb-4">
            <Play size={24} className="text-white/15" />
          </div>
          <p className="text-white/25 text-[13px]">No videos yet</p>
          <p className="text-white/15 text-[11px] mt-1">Generate videos while this project is open</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {projectVideos.map(v => {
            const isSelected = selectedIds.has(v.id);
            return (
              <div
                key={v.id}
                className={`relative group cursor-pointer rounded-2xl overflow-hidden aspect-[4/5] transition-all
                  ${isSelected
                    ? 'border-2 border-[#c8ff00] shadow-lg shadow-[#c8ff00]/10'
                    : 'border border-white/[0.06] hover:border-white/15'
                  } bg-[#111]`}
                onClick={() => setCurrentVideo(v.url)}
              >
                <video src={v.url} className="w-full h-full object-cover" muted />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />

                {/* Checkbox */}
                <button
                  onClick={e => toggleSelect(v.id, e)}
                  className={`absolute top-2 left-2 w-7 h-7 rounded-lg flex items-center justify-center transition-all z-10
                    ${isSelected
                      ? 'bg-[#c8ff00] text-black'
                      : 'bg-black/40 backdrop-blur-sm text-white/30 opacity-0 group-hover:opacity-100 hover:text-white'
                    }`}
                >
                  <Check size={14} strokeWidth={3} />
                </button>

                {/* Bottom info */}
                <div className="absolute bottom-0 left-0 right-0 p-3">
                  <p className="text-white text-[13px] font-bold uppercase tracking-wide truncate">
                    {v.prompt.split(' ').slice(0, 3).join(' ')}
                  </p>
                  <p className="text-white/40 text-[10px] mt-0.5">{v.modelName}</p>
                </div>

                {/* Hover actions */}
                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all z-10">
                  <button
                    onClick={e => { e.stopPropagation(); onDownload(v.url, `godseye-${v.modelName.toLowerCase().replace(/\s/g, '-')}.mp4`); }}
                    className="w-8 h-8 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center
                               text-white/50 hover:text-white hover:bg-black/80 transition-all"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    onClick={e => handleDelete(v.id, e)}
                    className="w-8 h-8 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center
                               text-white/50 hover:text-red-400 hover:bg-red-950/80 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Play overlay */}
                {!hasSelection && (
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                      <Play size={20} className="text-white ml-0.5" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Selection Toolbar */}
      <SelectionToolbar
        count={selectedIds.size}
        onCombine={() => setShowTimeline(true)}
        onDeselectAll={() => setSelectedIds(new Set())}
      />

      {/* Current video preview */}
      {currentVideo && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={() => setCurrentVideo(null)}>
          <video src={currentVideo} controls autoPlay className="max-w-full max-h-full rounded-2xl" onClick={e => e.stopPropagation()} />
        </div>
      )}

      {/* Timeline modal (lazy-loaded) */}
      {showTimeline && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-white/60">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[13px]">Loading editor...</span>
            </div>
          </div>
        }>
          <VideoTimeline
            videos={selectedVideos}
            onClose={() => setShowTimeline(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
