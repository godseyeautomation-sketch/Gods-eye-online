import React, { useRef } from 'react';
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react';
import { ImageUploadNodeData } from '../../../types/spaces.types';
import { Upload, X, ImageIcon } from 'lucide-react';

export const ImageUploadNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const d = data as unknown as ImageUploadNodeData;
  const { setNodes } = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<ImageUploadNodeData>) =>
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = e => {
      update({
        outputImage: e.target?.result as string,
        fileName: file.name,
        status: 'done',
      });
    };
    reader.readAsDataURL(file);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // reset so same file can be re-selected
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    // Only handle drops of actual files — not React Flow node drags
    if (!e.dataTransfer.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const clearImage = (e: React.MouseEvent) => {
    e.stopPropagation();
    update({ outputImage: undefined, fileName: undefined, status: 'idle' });
  };

  return (
    <div className={`space-node w-64 ${selected ? 'space-node-selected' : ''}`}>
      <div className="space-node-header">
        <ImageIcon size={14} className="text-brand" />
        <span>Image Upload</span>
        {d.outputImage && (
          <span className="ml-auto text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-green-950/60 text-green-400">
            Ready
          </span>
        )}
      </div>

      <div className="space-node-body">
        {d.outputImage ? (
          /* Preview */
          <div className="relative group">
            <img
              src={d.outputImage}
              alt={d.fileName || 'Uploaded'}
              className="w-full rounded-lg border border-border object-cover max-h-48"
            />
            {/* Overlay on hover */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-3 py-1.5 bg-brand text-bg text-xs font-bold rounded-full hover:bg-brand-hover transition-colors"
              >
                Replace
              </button>
              <button
                onClick={clearImage}
                className="w-7 h-7 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center transition-colors"
              >
                <X size={12} />
              </button>
            </div>
            {d.fileName && (
              <p className="mt-1.5 text-[10px] text-text-secondary truncate">{d.fileName}</p>
            )}
          </div>
        ) : (
          /* Drop zone */
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="nodrag nopan flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-border hover:border-brand/60 hover:bg-brand/5 transition-all cursor-pointer group"
          >
            <Upload size={20} className="text-text-secondary group-hover:text-brand transition-colors" />
            <div className="text-center">
              <p className="text-xs font-semibold text-text-primary">Drop image here</p>
              <p className="text-[10px] text-text-secondary mt-0.5">or click to browse</p>
            </div>
            <p className="text-[9px] text-text-secondary">PNG, JPG, WebP, GIF</p>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="image-out"
        className="space-handle"
      />
    </div>
  );
};
