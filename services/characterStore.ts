import { openDB, IDBPDatabase } from 'idb';
import type { Character } from '../types';

/**
 * Character Store — local IndexedDB persistence for user-created Character profiles.
 *
 * Why a separate DB from localStorageService?
 *   Keeping characters in their own database means we don't have to bump the
 *   main DB's version + risk a costly migration during a hot deploy. Each
 *   character holds 3-12 reference image data URLs (~5-50MB total), so the
 *   IO and quota patterns are different from generations / brands.
 *
 * Schema:
 *   - object store `characters` (keyPath: id)
 *   - index `userId` for per-user filtering (currently every user has their
 *     own browser, but we still scope by user_id for future cross-device sync)
 *   - index `updatedAt` for sorting most-recent-first
 *
 * Image format: every reference image is stored as a base64 data URL string.
 * That makes them directly droppable into <img src> and into fal.ai's
 * `image_urls` payload without any conversion. Trade-off: ~33% size overhead
 * vs raw blob storage. Acceptable for max 12 images per character.
 */

const DB_NAME = 'gods-eye-characters';
const STORE_NAME = 'characters';
const VERSION = 1;

export const MIN_REFERENCE_IMAGES = 3;
export const MAX_REFERENCE_IMAGES = 12;

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('userId', 'userId');
        store.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
}

/** Internal row shape — adds userId + timestamps on top of the public Character. */
interface CharacterRow extends Character {
  userId: string;
  createdAt: number;
  updatedAt: number;
}

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * Create a new character. Validates image count.
 * @throws Error if name is blank or images.length is outside [3, 12].
 */
export async function createCharacter(
  userId: string,
  name: string,
  images: string[]
): Promise<Character> {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Character name is required.');
  if (!Array.isArray(images) || images.length < MIN_REFERENCE_IMAGES) {
    throw new Error(`At least ${MIN_REFERENCE_IMAGES} reference photos are required.`);
  }
  if (images.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`At most ${MAX_REFERENCE_IMAGES} reference photos are allowed.`);
  }
  for (const img of images) {
    if (typeof img !== 'string' || !img.startsWith('data:image/')) {
      throw new Error('All reference photos must be valid image files.');
    }
  }

  const now = Date.now();
  const row: CharacterRow = {
    id: newId(),
    userId,
    name: cleanName,
    thumbnail: images[0],
    images,
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDB();
  await db.put(STORE_NAME, row);
  return toPublic(row);
}

/** List every character for the user, most-recently-updated first. */
export async function listCharacters(userId: string): Promise<Character[]> {
  if (!userId) return [];
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const idx = tx.store.index('userId');
  const rows = (await idx.getAll(userId)) as CharacterRow[];
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows.map(toPublic);
}

export async function getCharacter(id: string): Promise<Character | null> {
  if (!id) return null;
  const db = await getDB();
  const row = (await db.get(STORE_NAME, id)) as CharacterRow | undefined;
  return row ? toPublic(row) : null;
}

/** Append more reference images. Throws if total would exceed MAX_REFERENCE_IMAGES. */
export async function addImagesToCharacter(id: string, newImages: string[]): Promise<Character> {
  const db = await getDB();
  const row = (await db.get(STORE_NAME, id)) as CharacterRow | undefined;
  if (!row) throw new Error('Character not found.');
  const combined = [...row.images, ...newImages];
  if (combined.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`At most ${MAX_REFERENCE_IMAGES} reference photos are allowed.`);
  }
  row.images = combined;
  row.updatedAt = Date.now();
  await db.put(STORE_NAME, row);
  return toPublic(row);
}

/** Remove a single reference image by index. Refuses below MIN_REFERENCE_IMAGES. */
export async function removeImageFromCharacter(id: string, imageIndex: number): Promise<Character> {
  const db = await getDB();
  const row = (await db.get(STORE_NAME, id)) as CharacterRow | undefined;
  if (!row) throw new Error('Character not found.');
  if (row.images.length <= MIN_REFERENCE_IMAGES) {
    throw new Error(`A character needs at least ${MIN_REFERENCE_IMAGES} reference photos.`);
  }
  if (imageIndex < 0 || imageIndex >= row.images.length) {
    throw new Error('Invalid image index.');
  }
  row.images.splice(imageIndex, 1);
  // Refresh thumbnail if we just removed the first image
  row.thumbnail = row.images[0];
  row.updatedAt = Date.now();
  await db.put(STORE_NAME, row);
  return toPublic(row);
}

export async function renameCharacter(id: string, name: string): Promise<Character> {
  const cleanName = (name || '').trim();
  if (!cleanName) throw new Error('Character name is required.');
  const db = await getDB();
  const row = (await db.get(STORE_NAME, id)) as CharacterRow | undefined;
  if (!row) throw new Error('Character not found.');
  row.name = cleanName;
  row.updatedAt = Date.now();
  await db.put(STORE_NAME, row);
  return toPublic(row);
}

export async function deleteCharacter(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

function toPublic(row: CharacterRow): Character {
  return {
    id: row.id,
    name: row.name,
    thumbnail: row.thumbnail,
    images: row.images,
  };
}
