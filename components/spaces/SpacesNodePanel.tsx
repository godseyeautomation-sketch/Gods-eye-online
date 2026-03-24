import React from 'react';
import { SpaceNodeType } from '../../types/spaces.types';
import { Type, BrainCircuit, Image, Video, Pencil, ArrowUpFromLine, Download, Upload } from 'lucide-react';

interface NodeDef {
  type: SpaceNodeType;
  label: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}

const NODE_DEFS: NodeDef[] = [
  {
    type: 'prompt',
    label: 'Prompt',
    description: 'Text input or AI-enhanced prompt',
    icon: <Type size={16} />,
    color: 'from-violet-500/20 to-violet-600/10 border-violet-500/30',
  },
  {
    type: 'assistant',
    label: 'Assistant',
    description: 'Creative director refines your idea',
    icon: <BrainCircuit size={16} />,
    color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
  },
  {
    type: 'imageGenerator',
    label: 'Image Generator',
    description: 'Generate images from prompt',
    icon: <Image size={16} />,
    color: 'from-brand/20 to-brand/10 border-brand/30',
  },
  {
    type: 'videoGenerator',
    label: 'Video Generator',
    description: 'Generate video with Veo',
    icon: <Video size={16} />,
    color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30',
  },
  {
    type: 'editNode',
    label: 'Edit Image',
    description: 'Apply prompt as edit to an image',
    icon: <Pencil size={16} />,
    color: 'from-pink-500/20 to-pink-600/10 border-pink-500/30',
  },
  {
    type: 'upscaler',
    label: 'Upscaler',
    description: 'Upscale image to 4K',
    icon: <ArrowUpFromLine size={16} />,
    color: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
  },
  {
    type: 'outputExport',
    label: 'Export',
    description: 'Export result to gallery',
    icon: <Download size={16} />,
    color: 'from-green-500/20 to-green-600/10 border-green-500/30',
  },
  {
    type: 'imageUpload',
    label: 'Image Upload',
    description: 'Upload your own image as input',
    icon: <Upload size={16} />,
    color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
  },
];

export const SpacesNodePanel: React.FC = () => {
  const onDragStart = (event: React.DragEvent, nodeType: SpaceNodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="absolute left-4 top-28 z-10 flex flex-col gap-2 w-52 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <div className="bg-panel/80 backdrop-blur-xl border border-white/5 rounded-2xl p-3 shadow-2xl">
        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary mb-3 px-1">
          Nodes
        </p>
        <div className="space-y-1.5">
          {NODE_DEFS.map(def => (
            <div
              key={def.type}
              draggable
              onDragStart={e => onDragStart(e, def.type)}
              className={`flex items-center gap-2.5 p-2.5 rounded-xl border bg-gradient-to-r ${def.color} cursor-grab active:cursor-grabbing hover:scale-[1.02] transition-all select-none`}
            >
              <span className="text-text-primary flex-shrink-0">{def.icon}</span>
              <div className="min-w-0">
                <div className="text-xs font-bold text-text-primary leading-none">{def.label}</div>
                <div className="text-[9px] text-text-secondary mt-0.5 leading-tight">{def.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
