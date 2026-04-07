import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { AssistantNodeData } from '../../../types/spaces.types';
import { BrainCircuit, ImageIcon, X } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

export const AssistantNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as AssistantNodeData;
  const { setNodes, setEdges, getEdges, getNodes } = useReactFlow();

  const update = (patch: Partial<AssistantNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  const removeNode = () => {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
  };

  // Check if an image is connected to idea-in (for the UI hint)
  const edges = getEdges();
  const nodes = getNodes();
  const upstreamImageNode = edges
    .filter(e => e.target === id && e.targetHandle === 'idea-in')
    .map(e => nodes.find(n => n.id === e.source))
    .find(n => {
      if (!n) return false;
      const nd = n.data as any;
      return nd?.outputImage || nd?.outputImages?.[0];
    });

  const connectedImage = upstreamImageNode
    ? ((upstreamImageNode.data as any).outputImage || (upstreamImageNode.data as any).outputImages?.[0])
    : undefined;

  return (
    <div className={`space-node w-72 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <BrainCircuit size={14} className="text-brand" />
        <span>Creative Director</span>
        <NodeStatusBadge status={d.status} />
        <button onClick={removeNode} className="ml-auto p-0.5 rounded hover:bg-red-500/20 text-text-secondary hover:text-red-400 transition-colors" title="Remove node">
          <X size={12} />
        </button>
      </div>

      <div className="space-node-body">
        {/* Connected image preview */}
        {connectedImage ? (
          <div className="mb-2">
            <label className="space-label flex items-center gap-1">
              <ImageIcon size={9} /> Connected Image
            </label>
            <img
              src={connectedImage}
              alt="Connected"
              className="w-full rounded-lg border border-brand/30 object-cover max-h-28"
            />
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-1.5 p-2 rounded-lg border border-dashed border-border text-[10px] text-text-secondary">
            <ImageIcon size={10} className="flex-shrink-0" />
            Connect an Image Upload node to analyse a reference image
          </div>
        )}

        <label className="space-label">Instructions</label>
        <textarea
          className="space-textarea nodrag nopan"
          placeholder={connectedImage
            ? 'Describe what you want to do with this image, the style, mood, changes…'
            : 'Describe your creative vision, style, mood, what you want to create…'}
          value={d.idea || ''}
          onChange={e => update({ idea: e.target.value })}
          onKeyDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          rows={3}
        />

        {d.outputPrompt && (
          <div className="mt-2 p-2 rounded-lg bg-surface text-xs text-text-secondary border border-border leading-relaxed">
            <span className="text-brand font-bold block mb-1">Generated Prompt:</span>
            {d.outputPrompt}
          </div>
        )}

        {d.error && (
          <div className="mt-2 p-2 rounded-lg bg-red-950/40 text-xs text-red-400 border border-red-900">
            {d.error}
          </div>
        )}
      </div>

      {/* idea-in: accepts image or text from upstream */}
      <Handle
        type="target"
        position={Position.Left}
        id="idea-in"
        className="space-handle"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="prompt-out"
        className="space-handle"
      />
    </div>
  );
};
