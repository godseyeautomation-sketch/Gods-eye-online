import React, { useState, useCallback, useRef } from 'react';
import {
  ArrowLeft, ScanSearch, UploadCloud, Loader2, Copy, CheckCircle2,
  ArrowRight, X, FileJson, FileText, FileCode, ImageIcon
} from 'lucide-react';
import { analyzeImageToText } from '../../services/geminiService';

/* ═══ System prompt for image analysis ═══ */
const ANALYSIS_SYSTEM_PROMPT = `You are an Image to Prompt Generator.
Your task is to analyze a reference image and generate three outputs that perfectly describe the image so another AI can recreate it exactly.

Output formats:
1. Plain Text Prompt
2. JSON Prompt
3. YAML Prompt

Image Accuracy Requirements:
The generated prompt must recreate the original image with 100% visual accuracy.
You must carefully analyze and describe:
- Object shapes, alignment and positioning
- Colors of every element, lighting conditions
- Camera angle and perspective
- Body pose, gestures, facial expressions
- Eye color/shape/direction, teeth, nose, ear shape
- Eyebrow density and color, skin color and gradients
- Materials and textures (plastic, metal, wood, matte, glossy, etc.)
- Any 3D, holographic, glass, or lens effects
- Stroke outlines, color gradients, rotation angles
- Size relationships between objects
- Environment (studio, nature, indoor, city)
- Camera framing and angle

Character Description: If a human appears, describe face structure, eye color/shape, eyebrows, nose, mouth/teeth, skin tone, hair style/color, body proportions, exact position.

Identity: If a recognizable public figure, identify by name.

Logos/Icons: Describe shape, font style, colors, alignment, stroke, icon structure.

Flags: Identify country, describe colors, placement, symbols.

Strict Rule: Do not add elements that don't exist. Do not modify poses or expressions. Match everything exactly.

Return ONLY the three formatted outputs, clearly labeled.`;

interface PromptResults {
  plainText: string;
  json: string;
  yaml: string;
}

interface ImageToPromptAppProps {
  onBack: () => void;
  onUseInImages: (prompt: string) => void;
}

export const ImageToPromptApp: React.FC<ImageToPromptAppProps> = ({ onBack, onUseInImages }) => {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<PromptResults | null>(null);
  const [activeTab, setActiveTab] = useState<'plain' | 'json' | 'yaml'>('plain');
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setSourceImage(e.target?.result as string);
      setResults(null);
      setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  }, [handleFile]);

  const analyzeImage = useCallback(async () => {
    if (!sourceImage) return;
    setIsAnalyzing(true);
    setError(null);
    setResults(null);

    try {
      // Use Gemini text API (vision mode) to actually analyze the image
      const plainTextPrompt = `${ANALYSIS_SYSTEM_PROMPT}

Analyze the provided image and generate ONLY the Plain Text Prompt format.
Write a single, highly detailed paragraph that an AI image generator can use to recreate this exact image.
Include every visual detail: subjects, poses, expressions, clothing, objects, background, environment, lighting direction/color/intensity, camera angle, color palette, textures, materials, mood, art style, composition.
Be extremely specific — mention exact colors (e.g. "warm amber #D4A574"), exact positions (e.g. "center-left of frame"), exact lighting (e.g. "soft golden key light from upper right").
Do NOT include labels, headers, or formatting — just the raw prompt text.`;

      const plainText = await analyzeImageToText({
        prompt: plainTextPrompt,
        imageDataUrl: sourceImage,
        model: 'gemini-2.5-flash',
      });

      // Now generate JSON format from the plain text
      const jsonPromptText = `Based on this image, generate a structured JSON prompt object for AI image generation.

The JSON should have these fields:
- "prompt": The main detailed description (2-3 sentences covering subject, scene, composition)
- "subject": Primary subject description (person, object, scene)
- "pose_action": Body pose, gesture, or action if applicable
- "expression": Facial expression or emotional tone
- "clothing_accessories": What subjects are wearing or holding
- "background": Environment and background details
- "lighting": Lighting setup (direction, color, intensity, type)
- "camera": Camera angle, lens, framing, depth of field
- "color_palette": Dominant colors and color mood
- "style": Art/photography style
- "textures_materials": Key textures and materials visible
- "mood": Overall mood and atmosphere
- "quality": "ultra high definition, 8K resolution, professional quality"
- "negative_prompt": "blurry, low quality, distorted, deformed, watermark, text overlay"

Return ONLY valid JSON, no markdown backticks, no explanation.`;

      const jsonRaw = await analyzeImageToText({
        prompt: jsonPromptText,
        imageDataUrl: sourceImage,
        model: 'gemini-2.5-flash',
      });

      // Clean JSON response (remove possible markdown fencing)
      let jsonCleaned = jsonRaw.trim();
      if (jsonCleaned.startsWith('```')) {
        jsonCleaned = jsonCleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      // Pretty-print it
      try {
        const parsed = JSON.parse(jsonCleaned);
        jsonCleaned = JSON.stringify(parsed, null, 2);
      } catch {
        // If JSON parsing fails, use as-is
      }

      // Generate YAML format
      const yamlPromptText = `Based on this image, generate a YAML-formatted prompt for AI image generation.

Use this structure:
prompt: |
  (detailed multi-line description)
subject: (primary subject)
pose_action: (body pose or action)
expression: (facial expression)
clothing_accessories: (what they wear/hold)
background: (environment details)
lighting: (lighting description)
camera: (angle, lens, framing)
color_palette: (dominant colors)
style: (art/photography style)
textures_materials: (key textures)
mood: (atmosphere)
quality: ultra high definition, 8K
negative_prompt: blurry, low quality, distorted, deformed, watermark

Return ONLY valid YAML, no markdown backticks, no explanation.`;

      const yamlRaw = await analyzeImageToText({
        prompt: yamlPromptText,
        imageDataUrl: sourceImage,
        model: 'gemini-2.5-flash',
      });

      let yamlCleaned = yamlRaw.trim();
      if (yamlCleaned.startsWith('```')) {
        yamlCleaned = yamlCleaned.replace(/^```(?:yaml)?\s*/, '').replace(/\s*```$/, '');
      }

      setResults({ plainText: plainText.trim(), json: jsonCleaned, yaml: yamlCleaned });
    } catch (e: any) {
      setError(e.message || 'Failed to analyze image');
    } finally {
      setIsAnalyzing(false);
    }
  }, [sourceImage]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const getActiveContent = () => {
    if (!results) return '';
    if (activeTab === 'plain') return results.plainText;
    if (activeTab === 'json') return results.json;
    return results.yaml;
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0a] text-white overflow-hidden pt-20">
      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-5 py-3 border-b border-white/[0.06]">
        <button onClick={onBack} className="w-8 h-8 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-all">
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <ScanSearch size={14} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none">Image to Prompt</h1>
            <p className="text-[10px] text-white/30">Extract detailed prompts from any image</p>
          </div>
        </div>
        {results && (
          <button
            onClick={() => onUseInImages(results.plainText)}
            className="ml-auto flex items-center gap-1.5 px-4 py-2 text-[10px] font-bold bg-[#c8ff00] hover:bg-[#d4ff33] text-black rounded-lg transition-all"
          >
            <ImageIcon size={11} /> Use in Images <ArrowRight size={11} />
          </button>
        )}
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-5 mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-950/80 border border-red-800/30 rounded-xl text-red-300 text-[11px]">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}><X size={12} /></button>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden flex">
        {!sourceImage ? (
          /* ═══ Upload Phase ═══ */
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-lg flex flex-col items-center gap-8">
              <div className="text-center">
                <h2 className="text-3xl sm:text-4xl font-black text-white mb-2 tracking-tight">Image to Prompt</h2>
                <p className="text-xs text-white/30 uppercase tracking-[0.2em] font-bold">Upload an image and get AI-ready prompts</p>
              </div>
              <div
                onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full aspect-[1.6/1] flex flex-col items-center justify-center border-2 border-dashed rounded-3xl cursor-pointer transition-all duration-300 ${
                  dragActive ? 'border-blue-400 bg-blue-400/5 shadow-[0_0_40px_rgba(96,165,250,0.1)]' : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
                }`}
              >
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mb-5 transition-all ${
                  dragActive ? 'bg-blue-400/10 border-blue-400/30' : 'bg-white/[0.03] border-white/[0.06]'
                }`}>
                  <UploadCloud size={24} className={dragActive ? 'text-blue-400' : 'text-white/30'} />
                </div>
                <span className="text-white/60 font-bold text-sm mb-1">Drop your image here</span>
                <span className="text-white/20 text-[11px]">PNG, JPG, WebP — any image works</span>
              </div>
            </div>
          </div>
        ) : (
          /* ═══ Analysis Phase ═══ */
          <>
            {/* Left: Image preview */}
            <div className="w-[380px] flex-shrink-0 border-r border-white/[0.06] flex flex-col p-5 gap-4 overflow-y-auto">
              <div className="aspect-square bg-black rounded-2xl border border-white/[0.06] overflow-hidden relative">
                <img src={sourceImage} alt="Source" className="w-full h-full object-contain" />
              </div>

              <button
                onClick={analyzeImage}
                disabled={isAnalyzing}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-purple-500 hover:brightness-110 text-white font-black text-[11px] uppercase tracking-[0.15em] transition-all disabled:opacity-50"
              >
                {isAnalyzing
                  ? <span className="flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> Analyzing Image...</span>
                  : <span className="flex items-center justify-center gap-2"><ScanSearch size={14} /> Analyze & Generate Prompts</span>}
              </button>

              <button
                onClick={() => { setSourceImage(null); setResults(null); }}
                className="w-full py-2 text-[10px] font-bold text-white/25 hover:text-white/50 transition-colors"
              >
                Upload Different Image
              </button>

              {results && (
                <div className="mt-auto space-y-2">
                  <button
                    onClick={() => onUseInImages(results.plainText)}
                    className="w-full py-3 rounded-xl bg-[#c8ff00] hover:bg-[#d4ff33] text-black font-black text-[10px] uppercase tracking-[0.15em] transition-all flex items-center justify-center gap-2"
                  >
                    <ImageIcon size={12} /> Use Prompt in Image Generator <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Right: Results */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {!results && !isAnalyzing ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center flex flex-col items-center gap-4">
                    <ScanSearch size={40} className="text-white/10" />
                    <div>
                      <p className="text-sm font-bold text-white/40 mb-1">Ready to Analyze</p>
                      <p className="text-[11px] text-white/20">Click "Analyze & Generate Prompts" to extract descriptions</p>
                    </div>
                  </div>
                </div>
              ) : isAnalyzing ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center flex flex-col items-center gap-4">
                    <Loader2 size={32} className="animate-spin text-blue-400" />
                    <div>
                      <p className="text-sm font-bold text-white mb-1">Analyzing your image...</p>
                      <p className="text-[11px] text-white/30">Extracting visual details, composition, and style</p>
                    </div>
                  </div>
                </div>
              ) : results && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {/* Format tabs */}
                  <div className="flex-shrink-0 flex items-center gap-1 px-5 py-3 border-b border-white/[0.06]">
                    <button onClick={() => setActiveTab('plain')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                        activeTab === 'plain' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
                      }`}>
                      <FileText size={12} /> Plain Text
                    </button>
                    <button onClick={() => setActiveTab('json')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                        activeTab === 'json' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
                      }`}>
                      <FileJson size={12} /> JSON
                    </button>
                    <button onClick={() => setActiveTab('yaml')}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                        activeTab === 'yaml' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
                      }`}>
                      <FileCode size={12} /> YAML
                    </button>

                    <button
                      onClick={() => copyToClipboard(getActiveContent(), activeTab)}
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-white/40 hover:text-white border border-white/8 hover:border-white/20 rounded-lg transition-all"
                    >
                      {copied === activeTab ? <><CheckCircle2 size={11} className="text-emerald-400" /> Copied!</> : <><Copy size={11} /> Copy</>}
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-5">
                    <pre className="text-[12px] text-white/70 leading-relaxed whitespace-pre-wrap font-mono bg-white/[0.02] rounded-2xl border border-white/[0.06] p-5">
                      {getActiveContent()}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
