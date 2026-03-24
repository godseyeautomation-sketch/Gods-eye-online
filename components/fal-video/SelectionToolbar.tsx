import React from 'react';
import { Combine, X } from 'lucide-react';

interface Props {
  count: number;
  onCombine: () => void;
  onDeselectAll: () => void;
}

export const SelectionToolbar: React.FC<Props> = ({ count, onCombine, onDeselectAll }) => {
  if (count < 2) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3
                    bg-[#1a1a1a]/90 backdrop-blur-xl border border-white/10 rounded-full px-5 py-2.5
                    shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)]">
      <span className="text-white/60 text-[12px] font-medium">{count} videos</span>
      <div className="w-px h-5 bg-white/10" />
      <button
        onClick={onCombine}
        className="flex items-center gap-2 px-4 py-1.5 bg-[#c8ff00] text-black text-[12px] font-bold
                   rounded-full hover:bg-[#d4ff33] transition-colors"
      >
        <Combine size={14} />
        Combine
      </button>
      <button
        onClick={onDeselectAll}
        className="w-7 h-7 rounded-full bg-white/[0.06] flex items-center justify-center
                   text-white/30 hover:text-white/60 hover:bg-white/10 transition-all"
      >
        <X size={14} />
      </button>
    </div>
  );
};
