import React from 'react';
import { ChevronLeft, ChevronRight, Image, BookOpen, Play } from 'lucide-react';
import { ContentSlot, ContentFormat, SlotStatus } from '../../types/brand.types';

interface Props {
  year: number;
  month: number;
  slots: ContentSlot[];
  onMonthChange: (year: number, month: number) => void;
  onSlotClick: (date: string, format: ContentFormat, existing: ContentSlot | null) => void;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const FORMAT_ICONS: Record<ContentFormat, React.ReactNode> = {
  post: <Image size={9} />,
  story: <BookOpen size={9} />,
  reel: <Play size={9} />,
};

const STATUS_COLORS: Record<SlotStatus, string> = {
  empty: 'bg-white/[0.02] border border-dashed border-white/10 text-text-secondary',
  ideated: 'bg-yellow-500/10 backdrop-blur-md border border-yellow-500/20 text-yellow-400',
  briefed: 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-400',
  generated: 'bg-violet-500/10 backdrop-blur-md border border-violet-500/20 text-violet-400',
  reviewed: 'bg-cyan-500/10 backdrop-blur-md border border-cyan-500/20 text-cyan-400',
  approved: 'bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-400',
};

const FORMATS: ContentFormat[] = ['post', 'story', 'reel'];

export const BrandCalendar: React.FC<Props> = ({ year, month, slots, onMonthChange, onSlotClick }) => {
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();

  const slotMap = new Map<string, ContentSlot>();
  for (const s of slots) {
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
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={prevMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-text-primary hover:bg-white/5 hover:border-white/10 transition-all"
        >
          <ChevronLeft size={16} />
        </button>
        <h2 className="text-lg font-bold text-text-primary flex-1 text-center">
          {MONTH_NAMES[month - 1]} {year}
        </h2>
        <button
          onClick={nextMonth}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.03] border border-white/5 text-text-secondary hover:text-text-primary hover:bg-white/5 hover:border-white/10 transition-all"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[10px] font-bold text-text-secondary uppercase tracking-widest py-1.5 bg-white/[0.03] rounded-lg">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1 flex-1 overflow-y-auto">
        {cells.map((day, idx) => (
          <div
            key={idx}
            className={`rounded-xl p-1.5 min-h-[90px] transition-all duration-200 ${day ? 'bg-panel/40 backdrop-blur-md border border-white/5 hover:border-white/10' : ''} ${day && isToday(day) ? 'border-brand/30 bg-brand/5 shadow-[0_0_20px_rgba(204,255,0,0.06)]' : ''}`}
          >
            {day && (
              <>
                <div className={`text-xs font-bold mb-1 ${isToday(day) ? 'text-brand' : 'text-text-secondary'}`}>
                  {day}
                </div>
                <div className="flex flex-col gap-0.5">
                  {FORMATS.map(format => {
                    const key = `${dateStr(day)}|${format}`;
                    const slot = slotMap.get(key) || null;
                    const status: SlotStatus = slot?.status || 'empty';

                    return (
                      <button
                        key={format}
                        onClick={() => onSlotClick(dateStr(day), format, slot)}
                        className={`flex flex-col items-start px-1.5 py-1 rounded-lg text-[9px] font-medium transition-all hover:scale-[1.02] active:scale-95 w-full text-left ${STATUS_COLORS[status]}`}
                        title={slot?.idea || `${format} • ${status}`}
                      >
                        <span className="flex items-center gap-1 w-full">
                          <span className="flex-shrink-0">{FORMAT_ICONS[format]}</span>
                          <span className="capitalize">{format}</span>
                          {slot?.pipeline_run_id && <span title="Autopilot generated" className="ml-auto text-[8px] text-violet-400">⚡</span>}
                        </span>
                        {slot?.idea && (
                          <span className="w-full mt-0.5 leading-tight opacity-75 line-clamp-2" style={{ fontSize: '8px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
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
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-white/5">
        {(Object.entries(STATUS_COLORS) as [SlotStatus, string][]).map(([status, cls]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded ${cls}`} />
            <span className="text-[10px] text-text-secondary capitalize">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
