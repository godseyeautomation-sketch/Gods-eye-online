import { useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
  SpaceNodeData,
  PromptNodeData,
  AssistantNodeData,
  ImageGeneratorNodeData,
  VideoGeneratorNodeData,
  EditNodeData,
  UpscalerNodeData,
  OutputExportNodeData,
  ImageUploadNodeData,
} from '../../types/spaces.types';
import { generateImage, editImage } from '../../services/geminiService';
import { generateVideo } from '../../services/falService';
import { saveGeneration } from '../../services/generationsService';
import { smartCompress } from '../../services/imageCompressionService';
import { ModelType } from '../../types';

// ---------------------------------------------------------------------------
// Topological sort — Kahn's BFS
// ---------------------------------------------------------------------------
function topoSort(
  nodeIds: string[],
  edges: { source: string; target: string }[]
): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const edge of edges) {
    adj.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adj.get(current) || []) {
      const newDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (result.length !== nodeIds.length) {
    throw new Error('Cycle detected in workflow — cannot execute.');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function generateWhiteMask(width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function getImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 512, height: 512 });
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useSpaceExecutor(userId: string) {
  const { getNodes, getEdges, setNodes } = useReactFlow();
  /** Patch a single node's data in React state (for UI updates) */
  const patchNode = useCallback(
    (id: string, patch: Partial<SpaceNodeData>) => {
      setNodes(ns =>
        ns.map(n => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
      );
    },
    [setNodes]
  );

  const execute = useCallback(async () => {
    const nodes = getNodes();
    const edges = getEdges();

    if (nodes.length === 0) {
      alert('Add some nodes to the canvas first.');
      return;
    }

    // --- Topological order ---
    let order: string[];
    try {
      order = topoSort(
        nodes.map(n => n.id),
        edges.map(e => ({ source: e.source, target: e.target }))
      );
    } catch (err: any) {
      alert(err.message);
      return;
    }

    // --- Reset UI status ---
    setNodes(ns =>
      ns.map(n => ({ ...n, data: { ...n.data, status: 'idle', error: undefined } }))
    );

    // -------------------------------------------------------------------
    // IMPORTANT: use a local synchronous outputs map so each node can
    // immediately read the results of upstream nodes without waiting for
    // React's async state batching to flush.
    // -------------------------------------------------------------------
    const outputs = new Map<string, SpaceNodeData>();
    for (const n of nodes) {
      outputs.set(n.id, { ...(n.data as unknown as SpaceNodeData) });
    }

    /** Read the first matching upstream value for a given (targetNodeId, handleId) pair */
    const resolveInput = (nodeId: string, handleId: string): string | undefined => {
      const incoming = edges.filter(
        e => e.target === nodeId && e.targetHandle === handleId
      );
      for (const edge of incoming) {
        const up = outputs.get(edge.source);
        if (!up) continue;
        if ('outputPrompt' in up && up.outputPrompt) return up.outputPrompt as string;
        if ('outputImages' in up && (up as any).outputImages?.[0]) return (up as any).outputImages[0];
        if ('outputImage' in up && (up as any).outputImage) return (up as any).outputImage;
        if ('outputVideoUrl' in up && (up as any).outputVideoUrl) return (up as any).outputVideoUrl;
      }
      return undefined;
    };

    /** Like resolveInput but only returns image data URLs / blob URLs — ignores text prompts */
    const resolveImageInput = (nodeId: string, handleId: string): string | undefined => {
      const incoming = edges.filter(
        e => e.target === nodeId && e.targetHandle === handleId
      );
      for (const edge of incoming) {
        const up = outputs.get(edge.source);
        if (!up) continue;
        if ('outputImages' in up && (up as any).outputImages?.[0]) return (up as any).outputImages[0];
        if ('outputImage' in up && (up as any).outputImage) return (up as any).outputImage;
        // Recurse 1 level — look at sources of this upstream node for an image
        const upIncoming = edges.filter(e => e.target === edge.source);
        for (const upEdge of upIncoming) {
          const upUp = outputs.get(upEdge.source);
          if (!upUp) continue;
          if ('outputImages' in upUp && (upUp as any).outputImages?.[0]) return (upUp as any).outputImages[0];
          if ('outputImage' in upUp && (upUp as any).outputImage) return (upUp as any).outputImage;
        }
      }
      return undefined;
    };

    // --- Execute in order ---
    for (const nodeId of order) {
      const d = outputs.get(nodeId);
      if (!d) continue;

      // Mark running in UI
      patchNode(nodeId, { status: 'running' } as Partial<SpaceNodeData>);
      outputs.set(nodeId, { ...d, status: 'running' });

      try {
        switch (d.nodeType) {

          // ── Prompt ──────────────────────────────────────────────────────
          case 'prompt': {
            const pd = d as PromptNodeData;
            let outputPrompt = pd.prompt?.trim() || '';

            if (!outputPrompt) throw new Error('Prompt node is empty.');

            if (pd.enhanceEnabled) {
              try {
                const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{
                      parts: [{
                        text: `You are a professional AI image prompt engineer. Enhance the following prompt to be more descriptive, vivid, and effective for image generation. Return only the enhanced prompt, no explanation.\n\nPrompt: ${outputPrompt}`
                      }]
                    }]
                  })
                });
                if (res.ok) {
                  const json = await res.json();
                  const enhanced = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
                  if (enhanced) outputPrompt = enhanced;
                }
              } catch (e) {
                console.warn('[Executor] Prompt enhance failed, using raw prompt:', e);
              }
            }

            const patch = { status: 'done' as const, outputPrompt };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Assistant (Creative Director) ────────────────────────────────
          case 'assistant': {
            const ad = d as AssistantNodeData;
            const instructions = ad.idea?.trim() || '';
            if (!instructions) throw new Error('Creative Director: add instructions describing what you want.');

            // Resolve upstream connection on idea-in (image or text)
            const upstreamValue = resolveInput(nodeId, 'idea-in');
            const isImage = !!upstreamValue && (
              upstreamValue.startsWith('data:image/') || upstreamValue.startsWith('blob:')
            );

            // Build parts — put role/instructions text FIRST so the model sees context
            // before the image, then image, then the actual instruction
            const parts: any[] = [];

            if (isImage && upstreamValue) {
              // Compress before sending
              const compressed = await smartCompress(upstreamValue);
              const mimeMatch = compressed.match(/^data:(image\/\w+);base64,/);
              const mimeType = mimeMatch?.[1] || 'image/jpeg';
              const base64 = compressed.replace(/^data:image\/\w+;base64,/, '');

              // System context baked into the text part (proxy may not support system_instruction)
              parts.push({
                text: [
                  'You are a creative director and expert AI image prompt engineer.',
                  'You have been given a reference image. Study it carefully:',
                  '  - Subject and objects present',
                  '  - Composition, framing, perspective',
                  '  - Colour palette, lighting, shadows',
                  '  - Art style, texture, mood, atmosphere',
                  'Using those visual details as the foundation, write a detailed image-generation prompt',
                  'that faithfully captures the image AND fulfills the following creative instructions.',
                  'Return ONLY the final prompt — no commentary, no preamble.',
                  '',
                  `Creative instructions: ${instructions}`,
                ].join('\n'),
              });
              parts.push({ inlineData: { mimeType, data: base64 } });
            } else {
              // Text-only mode
              if (upstreamValue) {
                parts.push({
                  text: [
                    'You are a creative director and expert AI image prompt engineer.',
                    `Reference context from upstream: ${upstreamValue}`,
                    '',
                    `Creative instructions: ${instructions}`,
                    '',
                    'Write a detailed, evocative image generation prompt that incorporates the reference context',
                    'and fulfills the creative instructions. Return ONLY the final prompt.',
                  ].join('\n'),
                });
              } else {
                parts.push({
                  text: [
                    'You are a creative director and expert AI image prompt engineer.',
                    'Transform the following idea into a detailed image generation prompt.',
                    'Focus on visual elements: subject, style, mood, lighting, composition, colours, details.',
                    'Return ONLY the final prompt — no commentary.',
                    '',
                    `Idea: ${instructions}`,
                  ].join('\n'),
                });
              }
            }

            let outputPrompt = instructions;
            const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { responseModalities: ['TEXT'] },
              }),
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(`Creative Director API error: ${err?.error?.message || res.status}`);
            }

            const json = await res.json();
            const refined = json.candidates?.[0]?.content?.parts
              ?.find((p: any) => p.text)?.text?.trim();
            if (refined) outputPrompt = refined;

            const patch = { status: 'done' as const, outputPrompt };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Image Generator ─────────────────────────────────────────────
          case 'imageGenerator': {
            const igd = d as ImageGeneratorNodeData;
            const prompt = resolveInput(nodeId, 'prompt-in') || '';
            const baseImage = resolveInput(nodeId, 'image-in');

            if (!prompt) throw new Error('Image Generator needs a prompt connected to "prompt-in".');

            const urls = await generateImage({
              prompt,
              model: igd.model || ModelType.NANO_BANANA_PRO,
              aspectRatio: igd.aspectRatio || '1:1',
              quality: igd.quality || '1K',
              baseImages: baseImage ? [baseImage] : [],
              userId,
            });

            if (!urls || urls.length === 0) throw new Error('Image Generator returned no images.');

            const patch = { status: 'done' as const, outputImages: urls };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Video Generator ─────────────────────────────────────────────
          case 'videoGenerator': {
            const vgd = d as VideoGeneratorNodeData;
            const prompt = resolveInput(nodeId, 'prompt-in') || '';
            // 1. Try an explicit image-in connection first
            // 2. Fallback: scan ALL connections to this node — look for any upstream image
            //    (handles the case where Image Upload → Creative Director → Video Generator
            //     with no direct Image Upload → Video Generator image-in edge)
            let startImage = resolveImageInput(nodeId, 'image-in');
            if (!startImage) {
              // Look for any image in all edges pointing to this node
              for (const edge of edges.filter(e => e.target === nodeId)) {
                const up = outputs.get(edge.source);
                if (!up) continue;
                // The upstream node may carry an image itself or got one from its upstream
                const img =
                  (up as any).outputImage ||
                  (up as any).outputImages?.[0];
                if (img) { startImage = img; break; }
                // Check one more level up
                for (const upEdge of edges.filter(e => e.target === edge.source)) {
                  const upUp = outputs.get(upEdge.source);
                  const upImg = (upUp as any)?.outputImage || (upUp as any)?.outputImages?.[0];
                  if (upImg) { startImage = upImg; break; }
                }
                if (startImage) break;
              }
            }

            if (!prompt) throw new Error('Video Generator needs a prompt connected to "prompt-in".');

            const modelId = vgd.model || 'fal-ai/kling-video/v3/standard/text-to-video';
            const isI2V = !!startImage;
            const finalModelId = isI2V ? modelId.replace('text-to-video', 'image-to-video') : modelId;

            // Format input specifically based on the selected model
            let reqFormat: any = { prompt };

            if (modelId.includes('seedance')) {
              reqFormat = {
                prompt,
                aspect_ratio: vgd.aspectRatio || '16:9',
                duration: 5,
                resolution: vgd.resolution === '1080p' ? '1080p' : '720p',
                ...(isI2V ? { image_url: startImage } : {})
              };
            } else if (modelId.includes('veo')) {
              reqFormat = {
                prompt,
                ...(isI2V ? { image_url: startImage } : {})
              };
            } else {
              // Kling default
              reqFormat = {
                prompt,
                duration: '5',
                aspect_ratio: vgd.aspectRatio || '16:9',
                resolution: vgd.resolution === '1080p' ? '1080' : '720',
                ...(isI2V ? { start_image_url: startImage } : {})
              };
            }

            const videoUrl = await generateVideo({
              modelId: finalModelId,
              input: reqFormat,
              onStatus: () => { }, // No-op, spaces handles its own status via order iteration
            });

            const patch = { status: 'done' as const, outputVideoUrl: videoUrl };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Edit Node ───────────────────────────────────────────────────
          case 'editNode': {
            const end = d as EditNodeData;
            const inputImage = resolveInput(nodeId, 'image-in');
            const prompt = resolveInput(nodeId, 'prompt-in') || '';

            if (!inputImage) throw new Error('Edit node requires an image connected to "image-in".');
            if (!prompt) throw new Error('Edit node requires a prompt connected to "prompt-in".');

            const { width, height } = await getImageDimensions(inputImage);
            const mask = await generateWhiteMask(width, height);

            const result = await editImage(
              inputImage,
              mask,
              prompt,
              end.model || ModelType.NANO_BANANA_PRO,
              end.aspectRatio || '1:1'
            );

            const patch = { status: 'done' as const, outputImage: result };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Upscaler ────────────────────────────────────────────────────
          case 'upscaler': {
            const upd = d as UpscalerNodeData;
            const inputImage = resolveInput(nodeId, 'image-in');

            if (!inputImage) throw new Error('Upscaler requires an image connected to "image-in".');

            const urls = await generateImage({
              prompt: upd.upscalePrompt?.trim() || 'Enhance, upscale, add fine detail, sharpen, 4K ultra HD',
              model: ModelType.NANO_BANANA_PRO,
              quality: '4K',
              baseImages: [inputImage],
              userId,
            });

            if (!urls || urls.length === 0) throw new Error('Upscaler returned no image.');

            const patch = { status: 'done' as const, outputImage: urls[0] };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Output / Export ─────────────────────────────────────────────
          case 'outputExport': {
            const oed = d as OutputExportNodeData;
            const media = resolveInput(nodeId, 'media-in');

            if (oed.saveToGallery && media && userId) {
              const type = media.startsWith('blob:') ? 'video' : 'image';
              const exportLabel = oed.label || 'Spaces export';
              await saveGeneration(userId, type, media, {
                thumbnailUrl: type === 'image' ? media : undefined,
                prompt: exportLabel,
              });
            }

            const patch = { status: 'done' as const };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          // ── Image Upload ─────────────────────────────────────────────────
          case 'imageUpload': {
            const iud = d as ImageUploadNodeData;
            if (!iud.outputImage) {
              throw new Error('Image Upload node has no image — please upload an image first.');
            }
            const patch = { status: 'done' as const };
            outputs.set(nodeId, { ...d, ...patch });
            patchNode(nodeId, patch);
            break;
          }

          default:
            outputs.set(nodeId, { ...d, status: 'done' });
            patchNode(nodeId, { status: 'done' } as Partial<SpaceNodeData>);
        }
      } catch (err: any) {
        console.error(`[Executor] Node ${nodeId} failed:`, err);
        const errPatch = { status: 'error' as const, error: err.message };
        outputs.set(nodeId, { ...d, ...errPatch });
        patchNode(nodeId, errPatch as Partial<SpaceNodeData>);
        return; // halt pipeline on first error
      }
    }
  }, [getNodes, getEdges, setNodes, patchNode, userId]);

  return { execute };
}
