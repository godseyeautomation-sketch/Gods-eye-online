import React from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { VideoGeneratorNodeData } from '../../../types/spaces.types';
import { Video } from 'lucide-react';
import { NodeStatusBadge } from '../NodeStatusBadge';

const RESOLUTIONS = ['720p', '1080p'];
const ASPECT_RATIOS = ['16:9', '9:16', '1:1'];

const MODELS = [
  { value: 'fal-ai/kling-video/v3/standard/text-to-video', label: 'Kling 3.0' },
  { value: 'fal-ai/kling-video/v2.6/pro/text-to-video', label: 'Kling 2.6' },
  { value: 'fal-ai/bytedance/seedance/v1/pro/text-to-video', label: 'Seedance' },
  { value: 'fal-ai/veo3', label: 'Veo 3.1' }
];

export const VideoGeneratorNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as VideoGeneratorNodeData;
  const { setNodes } = useReactFlow();

  const update = (patch: Partial<VideoGeneratorNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <div className={`space-node w-72 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <Video size={14} className="text-brand" />
        <span>Video Generator</span>
        <NodeStatusBadge status={d.status} />
      </div>

      <div className="space-node-body">
        <div className="space-y-3">
          <div>
            <label className="space-label">Model</label>
            <select
              className="space-select nodrag w-full"
              value={d.model || 'fal-ai/kling-video/v3/standard/text-to-video'}
              onChange={e => update({ model: e.target.value })}
            >
              {MODELS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="space-label">Resolution</label>
              <select
                className="space-select nodrag"
                value={d.resolution || '720p'}
                onChange={e => update({ resolution: e.target.value })}
              >
                {RESOLUTIONS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="space-label">Aspect Ratio</label>
              <select
                className="space-select nodrag"
                value={d.aspectRatio || '16:9'}
                onChange={e => update({ aspectRatio: e.target.value })}
              >
                {ASPECT_RATIOS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {d.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
            <div className="w-3 h-3 rounded-full border-2 border-brand border-t-transparent animate-spin" />
            Generating video (this may take a minute)…
          </div>
        )}

        {d.outputVideoUrl && (
          <video
            src={d.outputVideoUrl}
            controls
            className="mt-2 w-full rounded-lg border border-border"
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
        id="video-out"
        className="space-handle"
      />
    </div>
  );
};
