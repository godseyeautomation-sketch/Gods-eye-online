
import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ControlBar } from './components/ControlBar';
import { AdminPanel } from './components/AdminPanel';
import { DrawEditor } from './components/DrawEditor';
import { ImageGallery } from './components/ImageGallery';
import { ExplorePage } from './components/ExplorePage';
import { VideoPage } from './components/VideoPage';
import { EditPage } from './components/EditPage';
import { CharacterPage } from './components/CharacterPage';
import { AssistPage } from './components/AssistPage';
import { StudioPage } from './components/StudioPage';
import { AppMode, GeneratedAsset, GenerationConfig, ModelType } from './types';
import { SAMPLE_IMAGES } from './constants';
import { generateImage } from './services/geminiService';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.EXPLORE);
  const [isAdmin, setIsAdmin] = useState(true); // Default to true for the primary user
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [editingImageUrl, setEditingImageUrl] = useState<string | null>(null);
  const [videoReferenceImageUrl, setVideoReferenceImageUrl] = useState<string | null>(null);
  
  // Theme Management
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Access Control: Redirect if non-admin tries to access Studio
  useEffect(() => {
    if (mode === AppMode.STUDIO && !isAdmin) {
      setMode(AppMode.EXPLORE);
    }
  }, [mode, isAdmin]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // App State
  const [generatedAssets, setGeneratedAssets] = useState<GeneratedAsset[]>(
    SAMPLE_IMAGES.map((url, i) => ({
      id: `init-${i}`,
      url,
      prompt: "Beautiful butterfly detail macro shot, cinematic lighting, 8k",
      model: "Nano Banana",
      aspectRatio: "1:1",
      createdAt: Date.now()
    }))
  );

  const [config, setConfig] = useState<GenerationConfig>({
    model: ModelType.NANO_BANANA_PRO,
    aspectRatio: '1:1',
    quality: '1K',
    batchSize: 1,
    prompt: ''
  });

  const [inputImages, setInputImages] = useState<string[]>([]);

  const handleGenerate = async () => {
    if (!config.prompt) return;

    setIsGenerating(true);
    
    try {
      const imageUrls = await generateImage({
        prompt: config.prompt,
        model: config.model,
        aspectRatio: config.aspectRatio,
        quality: config.quality,
        batchSize: config.batchSize,
        baseImages: inputImages.length > 0 ? inputImages : undefined,
      });

      const newAssets: GeneratedAsset[] = imageUrls.map((url, index) => ({
        id: (Date.now() + index).toString(),
        url: url, 
        prompt: config.prompt,
        model: config.model,
        aspectRatio: config.aspectRatio,
        createdAt: Date.now()
      }));

      setGeneratedAssets(prev => [...newAssets, ...prev]);
    } catch (error) {
      console.error("Generation failed", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAssetGeneratedFromEdit = (url: string, prompt: string) => {
    const newAsset: GeneratedAsset = {
      id: Date.now().toString(),
      url: url,
      prompt: prompt,
      model: "Gemini 3.0 Pro (Edit)",
      aspectRatio: "Custom",
      createdAt: Date.now()
    };
    setGeneratedAssets(prev => [newAsset, ...prev]);
  };

  const handleUseSketch = (base64: string) => {
    const dataUri = `data:image/png;base64,${base64}`;
    setInputImages(prev => [...prev, dataUri]);
    setIsDrawMode(false);
    if(!config.prompt) setConfig(prev => ({...prev, prompt: "A drawing of..."}));
  };

  const handleEditImage = (url: string) => {
      setEditingImageUrl(url);
      setMode(AppMode.EDIT);
  };

  const handleToVideo = (url: string) => {
      setVideoReferenceImageUrl(url);
      setMode(AppMode.VIDEO);
  };

  const handleDeleteAsset = (id: string) => {
    setGeneratedAssets(prev => prev.filter(asset => asset.id !== id));
  };

  return (
    <div className="min-h-screen text-text-primary font-sans selection:bg-brand selection:text-bg overflow-hidden transition-colors duration-300">
      
      <Header 
        currentMode={mode} 
        setMode={setMode} 
        theme={theme} 
        toggleTheme={toggleTheme} 
        isAdmin={isAdmin}
        setIsAdmin={setIsAdmin}
      />

      <main className="relative z-10 h-screen pt-20 overflow-hidden">
        {mode === AppMode.ADMIN ? (
          <div className="h-full overflow-y-auto"><AdminPanel /></div>
        ) : mode === AppMode.EXPLORE ? (
          <div className="h-full overflow-y-auto"><ExplorePage /></div>
        ) : (mode === AppMode.STUDIO && isAdmin) ? (
          <StudioPage />
        ) : mode === AppMode.VIDEO ? (
          <div className="h-full overflow-y-auto"><VideoPage initialImage={videoReferenceImageUrl} /></div>
        ) : mode === AppMode.EDIT ? (
          <EditPage 
            key={editingImageUrl || 'default'} 
            initialImage={editingImageUrl} 
            onAssetGenerated={handleAssetGeneratedFromEdit}
          />
        ) : mode === AppMode.CHARACTER ? (
          <div className="h-full overflow-y-auto"><CharacterPage /></div>
        ) : mode === AppMode.ASSIST ? (
          <div className="h-full overflow-y-auto"><AssistPage /></div>
        ) : (
          <div className="h-full overflow-y-auto">
            <ImageGallery 
              assets={generatedAssets} 
              onEdit={handleEditImage} 
              onDelete={handleDeleteAsset}
              onToVideo={handleToVideo}
            />
          </div>
        )}
      </main>

      {mode !== AppMode.ADMIN && mode !== AppMode.EXPLORE && mode !== AppMode.VIDEO && mode !== AppMode.EDIT && mode !== AppMode.CHARACTER && mode !== AppMode.ASSIST && mode !== AppMode.STUDIO && !isDrawMode && (
        <ControlBar 
          config={config} 
          setConfig={setConfig} 
          onGenerate={handleGenerate}
          onEnterDrawMode={() => setIsDrawMode(true)}
          isGenerating={isGenerating}
          inputImages={inputImages}
          setInputImages={setInputImages}
        />
      )}

      {isDrawMode && (
        <DrawEditor 
          onClose={() => setIsDrawMode(false)} 
          onUseSketch={handleUseSketch} 
        />
      )}
    </div>
  );
};

export default App;
