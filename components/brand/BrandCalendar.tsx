import React from 'react';
import { ChevronLeft, ChevronRight, Image, BookOpen, Play } from 'lucide-react';
import { ContentSlot, ContentFormat, SlotStatus, SocialPlatform, SOCIAL_PLATFORMS } from '../../types/brand.types';

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: '📸', tiktok: '🎵', facebook: '📘', youtube: '📺',
  linkedin: '💼', x: '𝕏', pinterest: '📌', threads: '🧵',
};

interface Props {
  year: number;
  month: number;
  slots: ContentSlot[];
  onMonthChange: (year: number, month: number) => void;
  onSlotClick: (date: string, format: ContentFormat, existing: ContentSlot | null) => void;
  selectedPlatform?: SocialPlatform;
  onPlatformChange?: (platform: SocialPlatform) => void;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FORMAT_ICONS: Record<ContentFormat, React.ReactNode> = {
  post: <Image size={9} />,
  story: <BookOpen size={9} />,
  reel: <Play size={9} />,
};

const STATUS_COLORS: Record<SlotStatus, string> = {
  empty: 'bg-white/[0.015] border border-dashed border-white/[0.07] text-text-secondary/40 hover:border-white/15 hover:text-text-secondary/80',
  ideated: 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 hover:bg-yellow-500/15',
  briefed: 'bg-blue-500/10 border border-blue-500/20 text-blue-300 hover:bg-blue-500/15',
  generated: 'bg-violet-500/10 border border-violet-500/20 text-violet-300 hover:bg-violet-500/15',
  reviewed: 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-500/15',
  approved: 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15',
};

const STATUS_DOTS: Record<SlotStatus, string> = {
  empty: 'bg-white/15',
  ideated: 'bg-yellow-400',
  briefed: 'bg-blue-400',
  generated: 'bg-violet-400',
  reviewed: 'bg-cyan-400',
  approved: 'bg-emerald-400',
};

const FORMATS: ContentFormat[] = ['post', 'story', 'reel'];

export const BrandCalendar: React.FC<Props> = ({ year, month, slots, onMonthChange, onSlotClick, selectedPlatform, onPlatformChange }) => {
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();

  // Filter slots by platform. Untagged slots (legacy) are treated as 'instagram' for display,
  // so they only appear when Instagram is selected — not on every platform.
  const filteredSlots = selectedPlatform
    ? slots.filter(s => (s.platform || 'instagram') === selectedPlatform)
    : slots;
  const today = new Date();

  const slotMap = new Map<string, ContentSlot>();
  for (const s of filteredSlots) {
    slotMap.set(`${s.slot_date}|${s.format}`, s);
  }

  const cells: Array<number | null> = [
    ...Array(firstDayOfMonth).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null);

  const prevMonth = () => {
    if (month === 1) onMonthChange(year - 1, 12);
    else onMonthChange(year, month - 1);
  };

  const nextMonth = () => {
    if (month === 12) onMonthChange(year + 1, 1);
    else onMonthChange(year, month + 1);
  };

  const dateStr = (day: number) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const isToday = (day: number) =>
    today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === day;

  return (
    <div className="flex flex-col h-full">
      {/* Month navigation */}
      <div className="flex items-center justify-center gap-5 mb-6">
        <button
          onClick={prevMonth}
          className="aw-magnetic w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-brand hover:bg-white/5 hover:border-brand/30"
          aria-label="Previous month"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-3xl font-serif italic text-text-primary tracking-tight min-w-[14rem] text-center">
          {MONTH_NAMES[month - 1]} <span className="text-text-secondary/60">{year}</span>
        </h2>
        <button
          onClick={nextMonth}
          className="aw-magnetic w-9 h-9 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-brand hover:bg-white/5 hover:border-brand/30"
          aria-label="Next month"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Platform selector */}
      {onPlatformChange && (
        <div className="flex items-center gap-1.5 mb-5 overflow-x-auto pb-1 scrollbar-hide">
          {(['instagram', 'tiktok', 'facebook', 'youtube', 'linkedin', 'x', 'pinterest', 'threads'] as SocialPlatform[]).map(p => {
            const info = SOCIAL_PLATFORMS.find(sp => sp.key === p);
            const isActive = selectedPlatform === p;
            return (
              <button
                key={p}
                onClick={() => onPlatformChange(p)}
                className={`aw-magnetic flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border ${
                  isActive
                    ? 'bg-brand/15 text-brand border-brand/40 shadow-[0_0_0_3px_rgba(204,255,0,0.06)]'
                    : 'bg-white/[0.02] text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.05] border-white/[0.05]'
                }`}
              >
                <span className="text-[12px]">{PLATFORM_EMOJI[p] || '📱'}</span>
                <span className="capitalize">{info?.label || p}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-2 mb-2 px-1">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[9px] font-bold text-text-secondary/50 uppercase tracking-[0.2em] py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2 flex-1 overflow-y-auto pb-2 px-1">
        {cells.map((day, idx) => {
          const todayCell = day && isToday(day);
          return (
            <div
              key={idx}
              onMouseMove={day ? (e) => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                (e.currentTarget as HTMLDivElement).style.setProperty('--mx', `${e.clientX - r.left}px`);
                (e.currentTarget as HTMLDivElement).style.setProperty('--my', `${e.clientY - r.top}px`);
              } : undefined}
              className={`group relative rounded-2xl p-2.5 min-h-[124px] transition-all duration-300 ${
                day ? `aw-spotlight bg-panel/60 border ${todayCell ? 'border-brand/40 shadow-[0_0_24px_rgba(204,255,0,0.10)]' : 'border-white/[0.05] hover:border-white/15'}` : ''
              }`}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <div className={`text-sm font-semibold ${todayCell ? 'text-brand' : 'text-text-primary/90'}`}>
                      {day}
                    </div>
                    {todayCell && (
                      <span className="text-[8px] tracking-[0.18em] uppercase font-bold text-brand">Today</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {FORMATS.map(format => {
                      const key = `${dateStr(day)}|${format}`;
                      const slot = slotMap.get(key) || null;
                      const status: SlotStatus = slot?.status || 'empty';
                      const hasContent = !!slot?.idea;

                      return (
                        <button
                          key={format}
                          onClick={() => onSlotClick(dateStr(day), format, slot)}
                          className={`group/slot relative flex flex-col items-start px-2 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-200 hover:-translate-y-px w-full text-left ${STATUS_COLORS[status]}`}
                          title={slot?.idea || `${format} · ${status}`}
                        >
                          <span className="flex items-center gap-1.5 w-full">
                            <span className={`w-1 h-1 rounded-full flex-shrink-0 ${STATUS_DOTS[status]}`} />
                            <span className="flex-shrink-0 opacity-80">{FORMAT_ICONS[format]}</span>
                            <span className="capitalize tracking-wide">{format}</span>
                            {slot?.pipeline_run_id && (
                              <span title="Autopilot generated" className="ml-auto text-[9px] text-violet-300">⚡</span>
                            )}
                          </span>
                          {hasContent && (
                            <span
                              className="w-full mt-1 leading-snug opacity-80 line-clamp-2 text-[9.5px] font-normal"
                              style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}
                            >
                              {slot.idea}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Legend — refined pill row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-4 pt-4 border-t border-white/[0.05]">
        <span className="text-[9px] tracking-[0.2em] uppercase font-bold text-text-secondary/40 mr-1">Status</span>
        {(Object.keys(STATUS_DOTS) as SlotStatus[]).map(status => (
          <div key={status} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${STATUS_DOTS[status]}`} />
            <span className="text-[10px] text-text-secondary/70 capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
