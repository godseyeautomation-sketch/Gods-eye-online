/**
 * OPFS Vector Store
 *
 * Pure browser-side vector database using Origin Private File System.
 * Stores embeddings as flat Float32Arrays in OPFS for zero-cost persistence.
 * Supports cosine similarity search for RAG retrieval.
 *
 * Storage layout:
 *   OPFS Root / [ProjectTag] / vectors /
 *     index.json       — metadata array [{id, type, text, dimensions, createdAt}]
 *     vec_{id}.bin      — raw Float32Array binary
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface VectorEntry {
  id: string;
  type: 'style' | 'brand' | 'prompt' | 'image' | 'asset';
  text: string;            // original text / prompt that was embedded
  imageUrl?: string;       // optional image reference (for multimodal entries)
  dimensions: number;
  createdAt: number;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number;           // cosine similarity (0–1)
}

// ── Cosine Similarity (optimized for Float32Array) ───────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── OPFS Helpers ─────────────────────────────────────────────────────────────

async function getVectorsDir(projectTag: string): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const projectDir = await root.getDirectoryHandle(projectTag, { create: true });
  return projectDir.getDirectoryHandle('vectors', { create: true });
}

async function readIndex(vectorsDir: FileSystemDirectoryHandle): Promise<VectorEntry[]> {
  try {
    const fh = await vectorsDir.getFileHandle('index.json', { create: false });
    const file = await fh.getFile();
    const text = await file.text();
    return text ? JSON.parse(text) : [];
  } catch {
    return []; // file doesn't exist yet
  }
}

async function writeIndex(vectorsDir: FileSystemDirectoryHandle, entries: VectorEntry[]): Promise<void> {
  const fh = await vectorsDir.getFileHandle('index.json', { create: true });
  const writable = await (fh as any).createWritable();
  await writable.write(JSON.stringify(entries));
  await writable.close();
}

async function writeVector(vectorsDir: FileSystemDirectoryHandle, id: string, vector: Float32Array): Promise<void> {
  const fh = await vectorsDir.getFileHandle(`vec_${id}.bin`, { create: true });
  const writable = await (fh as any).createWritable();
  await writable.write(vector.buffer);
  await writable.close();
}

async function readVector(vectorsDir: FileSystemDirectoryHandle, id: string): Promise<Float32Array | null> {
  try {
    const fh = await vectorsDir.getFileHandle(`vec_${id}.bin`, { create: false });
    const file = await fh.getFile();
    const buf = await file.arrayBuffer();
    return new Float32Array(buf);
  } catch {
    return null;
  }
}

async function deleteVector(vectorsDir: FileSystemDirectoryHandle, id: string): Promise<void> {
  try {
    await (vectorsDir as any).removeEntry(`vec_${id}.bin`);
  } catch {
    // file may not exist
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Add a vector to the store
 */
export async function addVector(
  projectTag: string,
  entry: Omit<VectorEntry, 'dimensions' | 'createdAt'>,
  vector: Float32Array
): Promise<void> {
  const dir = await getVectorsDir(projectTag);
  const index = await readIndex(dir);

  // Deduplicate: remove existing entry with same id
  const filtered = index.filter(e => e.id !== entry.id);

  const fullEntry: VectorEntry = {
    ...entry,
    dimensions: vector.length,
    createdAt: Date.now(),
  };

  filtered.push(fullEntry);
  await writeVector(dir, entry.id, vector);
  await writeIndex(dir, filtered);
}

/**
 * Search for the top-K most similar vectors
 */
export async function searchVectors(
  projectTag: string,
  queryVector: Float32Array,
  topK: number = 5,
  typeFilter?: VectorEntry['type']
): Promise<SearchResult[]> {
  const dir = await getVectorsDir(projectTag);
  const index = await readIndex(dir);

  const filtered = typeFilter ? index.filter(e => e.type === typeFilter) : index;

  const scored: SearchResult[] = [];

  for (const entry of filtered) {
    const vec = await readVector(dir, entry.id);
    if (!vec) continue;
    const score = cosineSimilarity(queryVector, vec);
    scored.push({ entry, score });
  }

  // Sort descending by score, return top K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Remove a vector by id
 */
export async function removeVector(projectTag: string, id: string): Promise<void> {
  const dir = await getVectorsDir(projectTag);
  const index = await readIndex(dir);
  const filtered = index.filter(e => e.id !== id);
  await deleteVector(dir, id);
  await writeIndex(dir, filtered);
}

/**
 * List all entries (metadata only, no vectors loaded)
 */
export async function listVectors(projectTag: string): Promise<VectorEntry[]> {
  const dir = await getVectorsDir(projectTag);
  return readIndex(dir);
}

/**
 * Get total vector count
 */
export async function vectorCount(projectTag: string): Promise<number> {
  const dir = await getVectorsDir(projectTag);
  const index = await readIndex(dir);
  return index.length;
}

/**
 * Clear all vectors for a project
 */
export async function clearVectors(projectTag: string): Promise<void> {
  const dir = await getVectorsDir(projectTag);
  const index = await readIndex(dir);

  for (const entry of index) {
    await deleteVector(dir, entry.id);
  }

  await writeIndex(dir, []);
}
