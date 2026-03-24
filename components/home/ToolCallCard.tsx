import React from 'react';
import type { ToolCallRecord } from '../../services/conversationService';

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  generate_image: { label: 'Generating image', icon: '🎨' },
  generate_video: { label: 'Generating video', icon: '🎬' },
  edit_image: { label: 'Editing image', icon: '✏️' },
  analyze_image: { label: 'Analyzing image', icon: '🔍' },
  scan_brand_website: { label: 'Scanning website', icon: '🌐' },
  save_brand_profile: { label: 'Saving brand', icon: '💾' },
  generate_content_calendar: { label: 'Building calendar', icon: '📅' },
  generate_content_brief: { label: 'Writing brief', icon: '📝' },
  search_brain: { label: 'Searching memory', icon: '🧠' },
  navigate_to: { label: 'Navigating', icon: '🧭' },
};

interface Props {
  toolCall: ToolCallRecord;
}

export const ToolCallCard: React.FC<Props> = ({ toolCall }) => {
  const meta = TOOL_LABELS[toolCall.name] || { label: toolCall.name, icon: '⚙️' };
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending';
  const isError = toolCall.status === 'error';

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
      isRunning ? 'border-brand/30 bg-brand/5 animate-pulse' :
      isError ? 'border-red-500/30 bg-red-500/5' :
      'border-border-base bg-surface/50'
    }`}>
      <span className="text-lg">{meta.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">
          {meta.label}
          {isRunning && <span className="ml-2 text-brand">...</span>}
          {toolCall.status === 'success' && <span className="ml-2 text-green-500">✓</span>}
          {isError && <span className="ml-2 text-red-500">✗</span>}
        </p>
        {toolCall.args?.prompt && (
          <p className="text-xs text-text-secondary truncate mt-0.5">{toolCall.args.prompt}</p>
        )}
        {toolCall.args?.url && (
          <p className="text-xs text-text-secondary truncate mt-0.5">{toolCall.args.url}</p>
        )}
      </div>
    </div>
  );
};
