import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { EditNodeData } from '../../../types/spaces.types';
import { Pencil } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3'];

export const EditNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as EditNodeData;
  const { setNodes } = useReactFlow();

  const update = (patch: Partial<EditNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <div className={`space-node w-72 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <Pencil size={14} className="text-brand" />
        <span>Edit Image</span>
        <NodeStatusBadge status={d.status} />
      </div>

      <div className="space-node-body">
        <label className="space-label">Aspect Ratio</label>
        <select
          className="space-select nodrag"
          value={d.aspectRatio || '1:1'}
          onChange={e => update({ aspectRatio: e.target.value })}
        >
          {ASPECT_RATIOS.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        <p className="mt-2 text-xs text-text-secondary">
          Connects an image and a prompt. Applies the prompt as an edit instruction using an auto-generated mask.
        </p>

        {d.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
            <div className="w-3 h-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            Editing image…
          </div>
        )}

        {d.outputImage && (
          <img
            src={d.outputImage}
            alt="Edited"
            className="mt-2 w-full rounded-lg border border-border object-cover"
          />
        )}

        {d.error && (
          <div className="mt-2 p-2 rounded-lg bg-red-950/40 text-xs text-red-400 border border-red-900">
            {d.error}
          </div>
        )}
      </div>

      {/* image-in top-left, prompt-in bottom-left */}
      <Handle
        type="target"
        position={Position.Left}
        id="image-in"
        style={{ top: '35%' }}
        className="space-handle"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="prompt-in"
        style={{ top: '65%' }}
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
