
import React from 'react';
import { GeneratedAsset } from '../types';
import { Download, Share2, Maximize2, PenTool, Trash2, Video } from 'lucide-react';

interface ImageGalleryProps {
  assets: GeneratedAsset[];
  onEdit?: (url: string) => void;
  onDelete?: (id: string) => void;
  onToVideo?: (url: string) => void;
}

export const ImageGallery: React.FC<ImageGalleryProps> = ({ assets, onEdit, onDelete, onToVideo }) => {
  const handleDownload = async (url: string, id: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `klint-image-${id}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed', error);
    }
  };

  if (assets.length === 0) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-text-secondary pb-32">
            <div className="w-24 h-24 bg-surface rounded-full flex items-center justify-center mb-6">
                <Maximize2 size={32} className="opacity-20" />
            </div>
            <p className="text-lg font-medium">Your canvas is empty</p>
            <p className="text-sm">Enter a prompt below to start creating</p>
        </div>
    );
  }

  return (
    <div className="w-full px-4 md:px-8 pb-32 pt-8">
      <div className="columns-1 md:columns-3 lg:columns-4 xl:columns-5 gap-6 space-y-6">
        {assets.map((asset) => (
          <div key={asset.id} className="group relative break-inside-avoid rounded-2xl overflow-hidden bg-surface border border-border-base animate-fade-in shadow-sm hover:shadow-xl transition-all hover:-translate-y-1">
            <img src={asset.url} alt={asset.prompt} className="w-full h-auto object-cover" />
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5">
                <p className="text-white text-sm line-clamp-2 font-bold mb-3 leading-snug">{asset.prompt}</p>
                
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                      <div className="px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-md border border-white/10 text-[10px] text-white font-mono uppercase truncate max-w-[150px]">
                        {asset.model || 'GEMINI-3-PRO'}
                      </div>
                      <div className="flex items-center gap-1.5">
                          {onEdit && (
                              <button 
                                  onClick={(e) => { e.stopPropagation(); onEdit(asset.url); }}
                                  className="w-10 h-10 bg-brand text-bg rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                                  title="Edit & Refine"
                              >
                                  <PenTool size={18}/>
                              </button>
                          )}
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleDownload(asset.url, asset.id); }}
                            className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center border border-white/10 transition-transform hover:scale-110 active:scale-95"
                            title="Download"
                          >
                            <Download size={18}/>
                          </button>
                          {onToVideo && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); onToVideo(asset.url); }}
                              className="w-10 h-10 bg-black/60 backdrop-blur-md rounded-full text-white flex items-center justify-center border border-white/10 transition-transform hover:scale-110 active:scale-95"
                              title="Convert to Video"
                            >
                              <Video size={18}/>
                            </button>
                          )}
                          {onDelete && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); onDelete(asset.id); }}
                              className="w-10 h-10 bg-red-600 rounded-full text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95"
                              title="Delete"
                            >
                              <Trash2 size={18}/>
                            </button>
                          )}
                      </div>
                  </div>
                </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
