import React from 'react';
import { Save, Play, Loader2 } from 'lucide-react';

interface SpacesToolbarProps {
  workflowName: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  onRun: () => void;
  isRunning: boolean;
  isSaving: boolean;
}

export const SpacesToolbar: React.FC<SpacesToolbarProps> = ({
  workflowName,
  onNameChange,
  onSave,
  onRun,
  isRunning,
  isSaving,
}) => {
  return (
    <div className="absolute top-28 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2">
      <div className="bg-panel/80 backdrop-blur-xl border border-white/5 rounded-full px-4 py-2 flex items-center gap-3 shadow-xl">
        <input
          type="text"
          value={workflowName}
          onChange={e => onNameChange(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          className="bg-transparent text-sm font-semibold text-text-primary outline-none w-48 placeholder:text-text-secondary"
          placeholder="Untitled Space"
        />

        <div className="w-px h-4 bg-white/10" />

        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-surface transition-all disabled:opacity-50"
        >
          {isSaving ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Save size={13} />
          )}
          Save
        </button>

        <button
          onClick={onRun}
          disabled={isRunning}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-black bg-brand text-bg hover:bg-brand-hover transition-all disabled:opacity-60 shadow-lg shadow-brand/20"
        >
          {isRunning ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Play size={13} fill="currentColor" />
          )}
          {isRunning ? 'Running…' : 'Run'}
        </button>
      </div>
    </div>
  );
};
