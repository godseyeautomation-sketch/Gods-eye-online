
/**
 * Utility to compress images on the client side before sending to API
 * This helps stay within the 32MB limit of Google Cloud Run / Vercel
 */

export const compressImage = async (
    base64Str: string,
    maxWidth = 4096,
    maxHeight = 4096,
    quality = 1.0,
    outputFormat: 'image/jpeg' | 'image/png' = 'image/jpeg'
): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64Str;

        img.onload = () => {
            let width = img.width;
            let height = img.height;

            // Calculate new dimensions only if it exceeds 4K (Gemini's limit)
            if (width > maxWidth || height > maxHeight) {
                const ratio = Math.min(maxWidth / width, maxHeight / height);
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // Use high quality interpolation
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(img, 0, 0, width, height);

            const compressedB64 = canvas.toDataURL(outputFormat, quality);
            resolve(compressedB64);
        };

        img.onerror = (err) => {
            reject(new Error('Failed to load image for processing'));
        };
    });
};

/**
 * Automatically compress images before sending to the API proxy.
 *
 * Cloud Run has a hard 32MB request body limit. A single edit request
 * contains image + mask + optional reference images, all base64-encoded
 * (which inflates size by ~33%). We must keep the combined payload under ~24MB
 * of raw data so it fits within 32MB after base64 encoding.
 *
 * PNG files are inherently much larger than JPEG at the same dimensions because
 * they are lossless. After the mask fix (masks are now exported as PNG to preserve
 * clean edges), PNG masks at 4K can be 20-50MB — far over the 32MB Cloud Run limit.
 * We therefore apply a much lower threshold and smaller max dimensions for PNG,
 * while preserving PNG format to keep the mask edges crisp for the AI model.
 *
 * Budget per image assuming up to 3 images in one request (~24MB total raw):
 *   PNG (mask): ≤ 6MB  → max 1536×1536
 *   JPEG (source/reference): ≤ 15MB → max 3072×3072
 */
export const smartCompress = async (base64Str: string): Promise<string> => {
    const approxSize = (base64Str.length * 3) / 4;
    const sizeInMB = approxSize / (1024 * 1024);
    const isPng = base64Str.startsWith('data:image/png');

    console.log(`[SmartCompress] Size: ${sizeInMB.toFixed(2)}MB, format: ${isPng ? 'PNG' : 'JPEG/other'}`);

    if (isPng && sizeInMB > 4) {
        // PNG masks at full resolution are too large for Cloud Run's 32MB limit.
        // Resize to 1536×1536 max while keeping PNG format — this preserves the
        // clean, lossless mask edges the AI needs while fitting in the payload budget.
        console.log(`[SmartCompress] PNG exceeds 4MB — resizing to 1536×1536 max (keeping PNG for clean edges)...`);
        return await compressImage(base64Str, 1536, 1536, 1.0, 'image/png');
    }

    if (!isPng && sizeInMB > 15) {
        // JPEG/other: same behaviour as before — 0.95 quality is visually lossless
        // but meaningfully smaller than quality 1.0 in file weight.
        console.log(`[SmartCompress] JPEG exceeds 15MB — optimizing for transport...`);
        return await compressImage(base64Str, 3072, 3072, 0.95, 'image/jpeg');
    }

    return base64Str;
};


