import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { PromptNodeData } from '../../../types/spaces.types';
import { Type, Sparkles } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

export const PromptNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as PromptNodeData;
  const { setNodes } = useReactFlow();

  const update = (patch: Partial<PromptNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <div className={`space-node w-72 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <Type size={14} className="text-brand" />
        <span>Prompt</span>
        <NodeStatusBadge status={d.status} />
      </div>

      <div className="space-node-body">
        <label className="space-label">Prompt Text</label>
        <textarea
          className="space-textarea nodrag nopan"
          placeholder="Describe what you want to generate…"
          value={d.prompt || ''}
          onChange={e => update({ prompt: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          rows={3}
        />

        <label className="space-label flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={!!d.enhanceEnabled}
            onChange={e => update({ enhanceEnabled: e.target.checked })}
            className="accent-brand"
          />
          <Sparkles size={12} className="text-brand" />
          Enhance with AI
        </label>

        {d.outputPrompt && (
          <div className="mt-2 p-2 rounded-lg bg-surface text-xs text-text-secondary border border-border leading-relaxed">
            <span className="text-brand font-bold block mb-1">Output:</span>
            {d.outputPrompt}
          </div>
        )}

        {d.error && (
          <div className="mt-2 p-2 rounded-lg bg-red-950/40 text-xs text-red-400 border border-red-900">
            {d.error}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="prompt-out"
        className="space-handle"
      />
    </div>
  );
};
