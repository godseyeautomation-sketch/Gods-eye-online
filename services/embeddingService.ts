/**
 * Gemini Embedding 2 Service
 *
 * Uses gemini-embedding-2-preview — Google's first natively multimodal embedding model.
 * Supports text, images, video, audio, and documents in a single embedding space.
 *
 * - 768 dimensions (optimal balance of quality + storage)
 * - Matryoshka Representation Learning (can scale down to 128 if needed)
 * - All requests proxied through /api/embed to hide API key
 *
 * Integrated with OPFS Vector Store for zero-cost local persistence.
 */

import { addVector, searchVectors, type VectorEntry, type SearchResult } from './opfsVectorStore';
import { smartCompress } from './imageCompressionService';

// ── Config ───────────────────────────────────────────────────────────────────

const EMBED_MODEL = 'gemini-embedding-2-preview';
const DIMENSIONS = 768;  // Recommended balance of quality/storage

// ── Core: Get Embedding ──────────────────────────────────────────────────────

/**
 * Embed text content via server proxy
 */
export async function embedText(text: string): Promise<Float32Array> {
  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      content: {
        parts: [{ text }]
      },
      outputDimensionality: DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('No embedding returned from API');
  }

  return new Float32Array(values);
}

/**
 * Embed image content (multimodal) — sends image + optional text description
 */
export async function embedImage(imageDataUrl: string, description?: string): Promise<Float32Array> {
  // Compress for embedding (don't need full resolution)
  const compressed = await smartCompress(imageDataUrl);
  const mimeMatch = compressed.match(/^data:(image\/\w+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const base64Data = compressed.replace(/^data:image\/\w+;base64,/, '');

  const parts: any[] = [
    { inlineData: { mimeType, data: base64Data } },
  ];

  // Add text description for richer multimodal embedding
  if (description) {
    parts.push({ text: description });
  }

  const response = await fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      content: { parts },
      outputDimensionality: DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Embedding API error: ${response.status}`);
  }

  const data = await response.json();
  const values = data.embedding?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('No embedding returned from API');
  }

  return new Float32Array(values);
}

// ── High-Level: Train (Embed + Store) ────────────────────────────────────────

/**
 * Train the brain with a text prompt (style, brand rule, etc.)
 * Embeds it and stores in OPFS vector store.
 */
export async function trainText(
  projectTag: string,
  text: string,
  type: VectorEntry['type'] = 'style',
  id?: string
): Promise<void> {
  const vector = await embedText(text);
  const entryId = id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await addVector(projectTag, {
    id: entryId,
    type,
    text,
  }, vector);

  console.log(`[Embedding] Trained ${type}: "${text.slice(0, 50)}..." (${vector.length}d)`);
}

/**
 * Train the brain with an image asset
 * Creates multimodal embedding (image + description in same space).
 */
export async function trainImage(
  projectTag: string,
  imageDataUrl: string,
  description: string,
  type: VectorEntry['type'] = 'asset',
  id?: string
): Promise<void> {
  const vector = await embedImage(imageDataUrl, description);
  const entryId = id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await addVector(projectTag, {
    id: entryId,
    type,
    text: description,
    imageUrl: imageDataUrl.slice(0, 200), // store thumbnail reference, not full base64
  }, vector);

  console.log(`[Embedding] Trained image ${type}: "${description.slice(0, 50)}..." (${vector.length}d)`);
}

/**
 * Train brand DNA (colors, tone, style rules, etc.)
 */
export async function trainBrandDNA(
  projectTag: string,
  brandData: {
    name?: string;
    tagline?: string;
    tone?: string[];
    colors?: string[];
    visual_style?: string;
    keywords?: string[];
    avoid?: string[];
  }
): Promise<void> {
  // Compose a rich text description from brand fields
  const parts: string[] = [];
  if (brandData.name) parts.push(`Brand: ${brandData.name}`);
  if (brandData.tagline) parts.push(`Tagline: ${brandData.tagline}`);
  if (brandData.tone?.length) parts.push(`Tone: ${brandData.tone.join(', ')}`);
  if (brandData.colors?.length) parts.push(`Colors: ${brandData.colors.join(', ')}`);
  if (brandData.visual_style) parts.push(`Visual style: ${brandData.visual_style}`);
  if (brandData.keywords?.length) parts.push(`Keywords: ${brandData.keywords.join(', ')}`);
  if (brandData.avoid?.length) parts.push(`Avoid: ${brandData.avoid.join(', ')}`);

  const text = parts.join('. ');

  await trainText(projectTag, text, 'brand', `brand_dna_${Date.now()}`);
}

// ── High-Level: Retrieve (Search) ────────────────────────────────────────────

/**
 * Retrieve relevant context for a generation prompt.
 * Returns the top-K most similar training entries.
 */
export async function retrieveContext(
  projectTag: string,
  prompt: string,
  topK: number = 5,
  typeFilter?: VectorEntry['type']
): Promise<SearchResult[]> {
  const queryVector = await embedText(prompt);
  const results = await searchVectors(projectTag, queryVector, topK, typeFilter);

  console.log(`[RAG] Query: "${prompt.slice(0, 40)}..." → ${results.length} results (top score: ${results[0]?.score.toFixed(3) || 'N/A'})`);

  return results;
}

/**
 * Build a context string from RAG results for prompt injection.
 * Only includes results above the similarity threshold.
 */
export async function buildRAGContext(
  projectTag: string,
  prompt: string,
  options: {
    topK?: number;
    threshold?: number;
    typeFilter?: VectorEntry['type'];
  } = {}
): Promise<string> {
  const { topK = 5, threshold = 0.3, typeFilter } = options;

  const results = await retrieveContext(projectTag, prompt, topK, typeFilter);

  // Filter by threshold
  const relevant = results.filter(r => r.score >= threshold);

  if (relevant.length === 0) return '';

  // Build context string
  const contextLines = relevant.map((r, i) => {
    const label = r.entry.type.toUpperCase();
    return `[${label}] ${r.entry.text}`;
  });

  return `--- STYLE CONTEXT (from training) ---\n${contextLines.join('\n')}\n--- END CONTEXT ---`;
}
