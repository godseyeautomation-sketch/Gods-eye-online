import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { ImageGeneratorNodeData } from '../../../types/spaces.types';
import { Image } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';
import { BrainActions } from '../../BrainActions';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2'];
const QUALITIES = ['1K', '2K', '4K'] as const;

export const ImageGeneratorNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as ImageGeneratorNodeData;
  const { setNodes } = useReactFlow();

  const update = (patch: Partial<ImageGeneratorNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <div className={`space-node w-72 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <Image size={14} className="text-brand" />
        <span>Image Generator</span>
        <NodeStatusBadge status={d.status} />
      </div>

      <div className="space-node-body">
        <div className="grid grid-cols-2 gap-2">
          <div>
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
          </div>
          <div>
            <label className="space-label">Quality</label>
            <select
              className="space-select nodrag"
              value={d.quality || '1K'}
              onChange={e => update({ quality: e.target.value as any })}
            >
              {QUALITIES.map(q => (
                <option key={q} value={q}>{q}</option>
              ))}
            </select>
          </div>
        </div>

        {d.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
            <div className="w-3 h-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            Generating image…
          </div>
        )}

        {d.outputImages && d.outputImages.length > 0 && (
          <div className="mt-2 space-y-1">
            {d.outputImages.map((url, i) => (
              <div key={i} className="relative group">
                <img
                  src={url}
                  alt="Generated"
                  className="w-full rounded-lg border border-border object-cover"
                />
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <BrainActions imageUrl={url} prompt="Spaces Generation" />
                </div>
              </div>
            ))}
          </div>
        )}

        {d.error && (
          <div className="mt-2 p-2 rounded-lg bg-red-950/40 text-xs text-red-400 border border-red-900">
            {d.error}
          </div>
        )}
      </div>

      {/* Top-left: prompt input, Bottom-left: image input */}
      <Handle
        type="target"
        position={Position.Left}
        id="prompt-in"
        style={{ top: '35%' }}
        className="space-handle"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="image-in"
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
