import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { OutputExportNodeData } from '../../../types/spaces.types';
import { Download, X } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

export const OutputExportNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as OutputExportNodeData;
  const { setNodes, setEdges } = useReactFlow();

  const update = (patch: Partial<OutputExportNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  const removeNode = () => {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
  };

  return (
    <div className={`space-node w-56 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <Download size={14} className="text-brand" />
        <span>Export</span>
        <NodeStatusBadge status={d.status} />
        <button onClick={removeNode} className="ml-auto p-0.5 rounded hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors" title="Remove node">
          <X size={12} />
        </button>
      </div>

      <div className="space-node-body">
        <label className="space-label">Label</label>
        <input
          type="text"
          className="space-input nodrag nopan"
          placeholder="Output label…"
          value={d.label || ''}
          onChange={e => update({ label: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        />

        <label className="space-label flex items-center gap-2 mt-2">
          <input
            type="checkbox"
            checked={!!d.saveToGallery}
            onChange={e => update({ saveToGallery: e.target.checked })}
            className="accent-brand"
          />
          Save to Gallery
        </label>

        {d.status === 'done' && (
          <div className="mt-2 p-2 rounded-lg bg-green-950/40 text-xs text-green-400 border border-green-900">
            Export complete!
          </div>
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
        id="media-in"
        className="space-handle"
      />
    </div>
  );
};
