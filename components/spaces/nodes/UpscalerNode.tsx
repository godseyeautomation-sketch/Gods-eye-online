import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { UpscalerNodeData } from '../../../types/spaces.types';
import { ArrowUpFromLine } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

export const UpscalerNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as UpscalerNodeData;
  const { setNodes } = useReactFlow();

  const update = (patch: Partial<UpscalerNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <div className={`space-node w-64 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <ArrowUpFromLine size={14} className="text-brand" />
        <span>Upscaler</span>
        <NodeStatusBadge status={d.status} />
      </div>

      <div className="space-node-body">
        <label className="space-label">Enhancement Prompt (optional)</label>
        <input
          type="text"
          className="space-input nodrag nopan"
          placeholder="Add detail, sharpen, enhance quality…"
          value={d.upscalePrompt || ''}
          onChange={e => update({ upscalePrompt: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        />

        <p className="mt-1 text-xs text-text-secondary">Upscales to 4K using Nano Banana Pro.</p>

        {d.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
            <div className="w-3 h-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            Upscaling…
          </div>
        )}

        {d.outputImage && (
          <img
            src={d.outputImage}
            alt="Upscaled"
            className="mt-2 w-full rounded-lg border border-border object-cover"
          />
        )}

        {d.error && (
          <div className="mt-2 p-2 rounded-lg bg-red-950/40 text-xs text-red-400 border border-red-900">
            {d.error}
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="image-in"
        className="space-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="space-handle"
      />
    </div>
  );
};
