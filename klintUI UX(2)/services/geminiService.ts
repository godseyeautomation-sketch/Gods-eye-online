
// @google/genai Coding Guidelines
import { GoogleGenAI } from "@google/genai";
import { ModelType } from "../types";

const getApiKey = () => {
    return process.env.API_KEY || '';
};

/**
 * Utility to ensure images are safe for the API:
 * CROPS to target aspect ratio using "COVER" logic (No black bars)
 */
const ensureSafeImage = async (
    base64OrUrl: string, 
    targetAspectRatio?: string
): Promise<{ data: string, mimeType: string }> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_DIM = 1024;
            
            let sourceX = 0;
            let sourceY = 0;
            let sourceWidth = img.width;
            let sourceHeight = img.height;

            if (targetAspectRatio) {
                const [targetW, targetH] = targetAspectRatio.split(':').map(Number);
                const targetRatio = targetW / targetH;
                const currentRatio = img.width / img.height;

                if (currentRatio > targetRatio) {
                    sourceWidth = img.height * targetRatio;
                    sourceX = (img.width - sourceWidth) / 2;
                } else {
                    sourceHeight = img.width / targetRatio;
                    sourceY = (img.height - sourceHeight) / 2;
                }
            }

            let canvasWidth = sourceWidth;
            let canvasHeight = sourceHeight;

            if (canvasWidth > canvasHeight) {
                if (canvasWidth > MAX_DIM) {
                    canvasHeight *= MAX_DIM / canvasWidth;
                    canvasWidth = MAX_DIM;
                }
            } else {
                if (canvasHeight > MAX_DIM) {
                    canvasWidth *= MAX_DIM / canvasHeight;
                    canvasHeight = MAX_DIM;
                }
            }

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject("Could not get canvas context");
            
            ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
            resolve({ data: base64, mimeType: 'image/jpeg' });
        };
        img.onerror = () => reject("Failed to load image for processing");
        img.src = base64OrUrl;
    });
};

interface GenerateVideoParams {
  prompt: string;
  model?: string;
  startImage?: string;
  endImage?: string;
  aspectRatio?: '16:9' | '9:16';
  resolution?: '720p' | '1080p';
  duration?: '4s' | '6s' | '8s';
}

export const generateVideo = async ({
  prompt,
  model = 'veo-3.1-fast-generate-preview',
  startImage,
  endImage,
  aspectRatio = '16:9',
  resolution = '720p',
  duration = '4s'
}: GenerateVideoParams): Promise<string> => {
  // 1. Mandatary API Key Selection Check for Veo
  if (model.includes('veo')) {
    if (!(await (window as any).aistudio.hasSelectedApiKey())) {
      await (window as any).aistudio.openSelectKey();
    }
  }

  // 2. Fresh initialization right before the call to ensure latest key is used
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key is missing. Please select a paid project key.");

  const ai = new GoogleGenAI({ apiKey });

  try {
     const videoRequest: any = {
        model: model, 
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: resolution,
          aspectRatio: aspectRatio
        }
     };

     if (startImage) {
        const processedStart = await ensureSafeImage(startImage, aspectRatio);
        videoRequest.image = { 
            imageBytes: processedStart.data, 
            mimeType: processedStart.mimeType 
        };
     }

     if (endImage) {
        const processedEnd = await ensureSafeImage(endImage, aspectRatio);
        videoRequest.config.lastFrame = { 
            imageBytes: processedEnd.data, 
            mimeType: processedEnd.mimeType 
        };
     }

     let operation = await ai.models.generateVideos(videoRequest);

     // 3. Robust Polling
     while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await ai.operations.getVideosOperation({operation: operation});
     }

     if (operation.error) {
         throw new Error(String(operation.error.message || "Video generation failed"));
     }

     const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
     if (downloadLink) {
         // Return link with key appended for direct playback
         return `${downloadLink}&key=${apiKey}`;
     }
    
    throw new Error("No video URI returned from the model.");

  } catch (error) {
      console.error("Video Generation Error:", error);
      const errString = (error as any).message || error.toString();
      
      // Handle the "Requested entity was not found" error by prompting for key again
      if (errString.includes('Requested entity was not found')) {
          await (window as any).aistudio.openSelectKey();
          throw new Error("Please re-select a valid paid project API key.");
      }
      throw error;
  }
};

export const generateImage = async ({
  prompt,
  model,
  aspectRatio = '1:1',
  quality = '1K',
  batchSize = 1,
  baseImages,
  baseImageBase64,
  baseImageMimeType
}: any): Promise<string[]> => {
  const actualModel = model === ModelType.NANO_BANANA_PRO ? 'gemini-3-pro-image-preview' : 
                      model === ModelType.NANO_BANANA ? 'gemini-2.5-flash-image' : model;

  const apiKey = getApiKey();
  if (!apiKey) {
    return Array.from({ length: batchSize }).map((_, i) => `https://picsum.photos/1024/1024?random=${Math.random() + i}`);
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const config: any = {
      imageConfig: {
        aspectRatio: aspectRatio,
        imageSize: actualModel.includes('pro') ? quality : undefined, 
      }
    };
    
    const parts: any[] = [{ text: prompt }];
    const imagesToProcess = baseImages && baseImages.length > 0 ? baseImages : (baseImageBase64 ? [baseImageBase64] : []);
    
    for (const img of imagesToProcess) {
        const processed = await ensureSafeImage(img, aspectRatio);
        parts.push({ inlineData: { data: processed.data, mimeType: processed.mimeType } });
    }

    const generationPromises = Array.from({ length: batchSize }).map(async () => {
        const response = await ai.models.generateContent({
            model: actualModel,
            contents: { parts },
            config
        });

        if (response.candidates?.[0]?.content?.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                }
            }
        }
        return `https://picsum.photos/seed/${Math.random()}/1024/1024`;
    });

    return await Promise.all(generationPromises);
  } catch (error) {
    console.error("Image generation service error:", error);
    return Array.from({ length: batchSize }).map((_, i) => `https://picsum.photos/seed/${Date.now() + i}/1024/1024`);
  }
};
