import { openDB, IDBPDatabase } from 'idb';

const DB_NAME = 'klint-studio-db';
const STORE_NAME = 'generations';
const SLOT_IMAGES_STORE = 'slot_images';
const BRAND_PROFILES_STORE = 'brand_profiles';
const CONTENT_SLOTS_STORE = 'content_slots';
const VIDEO_STORE = 'video_generations';
const VIDEO_PROJECTS_STORE = 'video_projects';
const CONVERSATIONS_STORE = 'conversations';
const CHAT_MESSAGES_STORE = 'chat_messages';
const VERSION = 7;

interface LocalGeneration {
    id: string;
    userId: string; // SCOPE BY USER
    url: string | Blob; // Allow Blob for strict memory optimization
    prompt: string;
    model: string;
    aspectRatio: string;
    timestamp: number;
    isDeleted: boolean;
}

// 1. Initialize IndexedDB
async function getDB(): Promise<IDBPDatabase> {
    try {
        return await openDB(DB_NAME, VERSION, {
            upgrade(db, oldVersion, _newVersion, transaction) {
                // v1: create generations store
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('timestamp', 'timestamp');
                    store.createIndex('userId', 'userId');
                } else if (oldVersion < 2) {
                    const store = transaction.objectStore(STORE_NAME);
                    if (!store.indexNames.contains('userId')) {
                        store.createIndex('userId', 'userId');
                    }
                }
                // v3: slot images store (brand calendar generated images)
                if (!db.objectStoreNames.contains(SLOT_IMAGES_STORE)) {
                    db.createObjectStore(SLOT_IMAGES_STORE, { keyPath: 'key' });
                }
                // v4: brand intelligence stores (completely detached from Supabase)
                if (!db.objectStoreNames.contains(BRAND_PROFILES_STORE)) {
                    const store = db.createObjectStore(BRAND_PROFILES_STORE, { keyPath: 'id' });
                    store.createIndex('user_id', 'user_id'); // Allow querying all brands for a user
                }
                if (!db.objectStoreNames.contains(CONTENT_SLOTS_STORE)) {
                    // We use a composite key for slots: brand_id + date + format (just like Supabase constraint)
                    const store = db.createObjectStore(CONTENT_SLOTS_STORE, { keyPath: 'id' });
                    store.createIndex('brand_id', 'brand_id'); // Allow querying slots by brand
                    store.createIndex('slot_date', 'slot_date');
                }
                // v5: video generations store — stores video blobs so they survive CDN URL expiry
                if (!db.objectStoreNames.contains(VIDEO_STORE)) {
                    const store = db.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
                // v6: video projects (folders) + projectId index on videos
                if (!db.objectStoreNames.contains(VIDEO_PROJECTS_STORE)) {
                    const store = db.createObjectStore(VIDEO_PROJECTS_STORE, { keyPath: 'id' });
                    store.createIndex('createdAt', 'createdAt');
                }
                if (oldVersion < 6 && db.objectStoreNames.contains(VIDEO_STORE)) {
                    const vStore = transaction.objectStore(VIDEO_STORE);
                    if (!vStore.indexNames.contains('projectId')) {
                        vStore.createIndex('projectId', 'projectId');
                    }
                }
                // v7: conversations + chat messages for conversational home page
                if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
                    const store = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: 'id' });
                    store.createIndex('userId', 'userId');
                    store.createIndex('updatedAt', 'updatedAt');
                }
                if (!db.objectStoreNames.contains(CHAT_MESSAGES_STORE)) {
                    const store = db.createObjectStore(CHAT_MESSAGES_STORE, { keyPath: 'id' });
                    store.createIndex('conversationId', 'conversationId');
                    store.createIndex('timestamp', 'timestamp');
                }
            },
        });
    } catch (error: any) {
        // Soft fallback for "The requested version (3) is less than the existing version (4)"
        // This stops active sessions with unsaved UI state from breaking during live deployments.
        if (error.name === 'VersionError' || (error.message && error.message.includes('less than the existing version'))) {
            console.warn(`[IndexedDB] Version mismatch caught. Opening latest version softly instead of locking to ${VERSION}.`);
            return await openDB(DB_NAME);
        }
        throw error;
    }
}

// ── Sync API: push IndexedDB changes to server so Chrome ↔ Electron stay in sync ──
const SYNC_API_BASE = (typeof window !== 'undefined' && (window as any).__RUNTIME_CONFIG__?.apiBaseUrl) || 'http://localhost:3002';

// Debounced sync: waits 2s after last change before pushing to server
let _syncTimers: Record<string, ReturnType<typeof setTimeout>> = {};
function debouncedSyncStore(storeName: string) {
    if (_syncTimers[storeName]) clearTimeout(_syncTimers[storeName]);
    _syncTimers[storeName] = setTimeout(() => syncStoreToServer(storeName), 2000);
}

async function syncStoreToServer(storeName: string) {
    try {
        const db = await getDB();
        const allData = await db.getAll(storeName);
        // Strip large blobs (don't send image data, just metadata)
        const cleanData = allData.map((item: any) => {
            const clean = { ...item };
            // Remove blob/base64 data — too large for sync
            if (typeof clean.url === 'object') clean.url = '[blob]';
            if (typeof clean.url === 'string' && clean.url.length > 1000) clean.url = clean.url.slice(0, 100) + '...[truncated]';
            if (clean.videoBlob) delete clean.videoBlob;
            if (clean.blob) delete clean.blob;
            if (clean.imageData && clean.imageData.length > 1000) clean.imageData = '[has data]';
            return clean;
        });
        await fetch(`${SYNC_API_BASE}/api/sync/${storeName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: cleanData, _source: 'browser' }),
        }).catch(() => {}); // Non-blocking — don't break app if server is down
    } catch (err) {
        console.warn(`[Klint Sync] Failed to sync ${storeName}:`, err);
    }
}

// ── Initial full sync: push ALL IndexedDB stores to server on page load ──
// This ensures data that existed before the sync code was added gets pushed.
let _initialSyncDone = false;
// Chat stores (conversations, chat_messages) are NOT included here — they sync
// on every write/delete via syncChatToServer/syncChatToServerImmediate.
// Including them here would overwrite the server with stale restored data after cache clears.
const ALL_SYNC_STORES = [STORE_NAME, BRAND_PROFILES_STORE, CONTENT_SLOTS_STORE, VIDEO_STORE, VIDEO_PROJECTS_STORE];

export async function syncAllStoresToServer() {
    if (_initialSyncDone) return;
    _initialSyncDone = true;
    console.log('[Klint Sync] 🔄 Running initial full sync of all stores...');
    for (const store of ALL_SYNC_STORES) {
        try {
            await syncStoreToServer(store);
            console.log(`[Klint Sync] ✅ Synced ${store}`);
        } catch (err) {
            console.warn(`[Klint Sync] ❌ Failed to sync ${store}:`, err);
        }
    }
    console.log('[Klint Sync] 🔄 Initial full sync complete!');
}

// Auto-run initial sync after a short delay (let app boot first)
if (typeof window !== 'undefined') {
    setTimeout(() => syncAllStoresToServer(), 3000);

    // Flush pending chat syncs before page unload (covers tab close, navigation, refresh)
    window.addEventListener('beforeunload', () => {
        // Use sendBeacon for reliable delivery during unload
        const syncViaBeacon = async (storeName: string) => {
            try {
                const db = await openDB(DB_NAME);
                const allData = await db.getAll(storeName);
                const cleanData = allData.map((item: any) => {
                    const clean = { ...item };
                    if (typeof clean.url === 'object') clean.url = '[blob]';
                    if (typeof clean.url === 'string' && clean.url.length > 1000) clean.url = clean.url.slice(0, 100) + '...[truncated]';
                    if (clean.videoBlob) delete clean.videoBlob;
                    if (clean.blob) delete clean.blob;
                    return clean;
                });
                navigator.sendBeacon(
                    `${SYNC_API_BASE}/api/sync/${storeName}`,
                    new Blob([JSON.stringify({ data: cleanData, _source: 'browser-unload' })], { type: 'application/json' })
                );
            } catch {}
        };
        syncViaBeacon(CONVERSATIONS_STORE);
        syncViaBeacon(CHAT_MESSAGES_STORE);
    });
}

// ── Slot Image Helpers (brand calendar) ────────────────────────────────────

export const saveSlotImage = async (key: string, dataUrl: string): Promise<void> => {
    const db = await getDB();
    let storedVal: string | Blob = dataUrl;
    try {
        const res = await fetch(dataUrl);
        storedVal = await res.blob();
    } catch (e) {
        // Fallback to raw string if conversion fails
    }
    await db.put(SLOT_IMAGES_STORE, { key, dataUrl: storedVal });
};

export const getSlotImage = async (key: string): Promise<string | null> => {
    const db = await getDB();
    const record = await db.get(SLOT_IMAGES_STORE, key);
    if (!record?.dataUrl) return null;

    const val = record.dataUrl;
    if (val instanceof Blob) {
        return URL.createObjectURL(val);
    } else if (typeof val === 'string' && val.startsWith('data:image')) {
        try {
            const res = await fetch(val);
            const blob = await res.blob();
            // Fire and forget upgrade for legacy base64 strings
            db.put(SLOT_IMAGES_STORE, { key, dataUrl: blob }).catch(() => { });
            return URL.createObjectURL(blob);
        } catch (e) {
            return val;
        }
    }
    return val;
};

export const deleteSlotImage = async (key: string): Promise<void> => {
    const db = await getDB();
    await db.delete(SLOT_IMAGES_STORE, key);
};

// ── Brand Profiles (Local DB) ──────────────────────────────────────────────

export const saveLocalBrandProfile = async (userId: string, profile: any): Promise<any> => {
    const db = await getDB();
    // Ensure the ID exists. If no ID is provided, create one.
    const id = profile.id || crypto.randomUUID();
    const toSave = { ...profile, id, user_id: userId, updated_at: new Date().toISOString() };
    await db.put(BRAND_PROFILES_STORE, toSave);
    debouncedSyncStore(BRAND_PROFILES_STORE);
    return toSave;
};

export const getLocalBrandProfile = async (userId: string): Promise<any | null> => {
    const db = await getDB();
    // Query the user_id index
    const allBrands = await db.getAllFromIndex(BRAND_PROFILES_STORE, 'user_id', userId);
    // Backward compatibility: Returns the first brand if you just want *a* brand
    return allBrands.length > 0 ? allBrands[0] : null;
};

export const getAllLocalBrandProfiles = async (userId: string): Promise<any[]> => {
    const db = await getDB();
    const allBrands = await db.getAllFromIndex(BRAND_PROFILES_STORE, 'user_id', userId);
    // Sort by updated_at descending (most recently updated first)
    return allBrands.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
};

export const deleteLocalBrandProfile = async (brandId: string): Promise<void> => {
    const db = await getDB();

    // Delete the brand record explicitly by brandId
    await db.delete(BRAND_PROFILES_STORE, brandId);

    // Also cascade delete all content slots tied to this brand
    const tx = db.transaction(CONTENT_SLOTS_STORE, 'readwrite');
    const index = tx.store.index('brand_id');
    let cursor = await index.openCursor(brandId);
    while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
    }
    await tx.done;
    debouncedSyncStore(BRAND_PROFILES_STORE);
    debouncedSyncStore(CONTENT_SLOTS_STORE);
};

// ── Content Slots (Local Calendar DB) ──────────────────────────────────────

export const getLocalSlotsForMonth = async (brandId: string, _year: number, _month: number): Promise<any[]> => {
    const db = await getDB();
    const allSlots = await db.getAllFromIndex(CONTENT_SLOTS_STORE, 'brand_id', brandId);
    return allSlots;
};

export const upsertLocalSlot = async (
    userId: string,
    brandId: string,
    slotDate: string,
    format: string,
    patch: any
): Promise<any> => {
    const db = await getDB();
    const id = `${brandId}_${slotDate}_${format}`;

    const existing = await db.get(CONTENT_SLOTS_STORE, id);
    const toSave = {
        id,
        user_id: userId,
        brand_id: brandId,
        slot_date: slotDate,
        format,
        ...existing,
        ...patch,
        updated_at: new Date().toISOString()
    };

    await db.put(CONTENT_SLOTS_STORE, toSave);
    debouncedSyncStore(CONTENT_SLOTS_STORE);
    return toSave;
};

// 2a. Save a generated image asset (fal.ai / CDN URL) to the gallery.
//     Uses an explicit caller-supplied id so App.tsx state and IndexedDB always
//     share the same ID — no remapping needed.
//     Phase 1 (sync): saves the URL string immediately so the record exists in DB
//                     before we ever call setGeneratedAssets.
//     Phase 2 (async, fire-and-forget): tries to download + store a permanent
//                     Blob so the image survives after the CDN URL expires.
export const saveGeneratedAsset = async (
    id: string,
    url: string,
    prompt: string,
    aspectRatio: string,
    model: string,
    userId: string
): Promise<void> => {
    const db = await getDB();
    const safeUserId = userId || 'anonymous';

    // Phase 1: write the URL immediately — this is fast and can't be CORS-blocked.
    const item: LocalGeneration = {
        id,
        userId: safeUserId,
        url,           // plain CDN URL — <img> tag can always display this
        prompt,
        model,
        aspectRatio,
        timestamp: Date.now(),
        isDeleted: false,
    };
    await db.put(STORE_NAME, item);
    debouncedSyncStore(STORE_NAME);
    console.log(`[LocalStorage] ✅ Saved (URL) id=${id}`);

    // Phase 2: background upgrade to Blob for permanent storage.
    // If the CDN URL expires, the Blob in IndexedDB will still work.
    (async () => {
        try {
            const response = await fetch(url);
            if (!response.ok) return;
            const blob = await response.blob();
            const upgraded = { ...item, url: blob };
            await db.put(STORE_NAME, upgraded);
            console.log(`[LocalStorage] ✅ Upgraded to Blob id=${id}`);
        } catch {
            // CORS blocked or fetch failed — URL version is already persisted above.
            console.warn(`[LocalStorage] Blob upgrade skipped for id=${id} (CORS/network)`);
        }
    })();
};

// 2. Save Image to Local Gallery (IndexedDB)
export const saveToLocalGallery = async (
    base64: string,
    prompt: string,
    aspectRatio: string,
    model: string,
    userId: string // REQUIRED
): Promise<string> => {
    const db = await getDB();

    // ROBUST ID STRATEGY: Composite Key
    // Allows us to identify ownership purely by ID if needed
    const safeUserId = userId || 'anonymous';
    const uuid = crypto.randomUUID();
    const id = `${safeUserId}::${uuid}`;

    // Convert massive base64 string to a Blob before storing.
    // IndexedDB stores Blobs much more efficiently, avoiding string allocation crashes.
    let storedUrl: string | Blob = base64;
    try {
        const response = await fetch(base64);
        storedUrl = await response.blob();
    } catch (err) {
        console.warn('[LocalStorage] Failed to convert base64 to Blob. Falling back to string.', err);
    }

    const item: LocalGeneration = {
        id,
        userId: safeUserId,
        url: storedUrl,
        prompt,
        model: model || 'gemini-3.1-flash-image-preview',
        aspectRatio: aspectRatio || '1:1',
        timestamp: Date.now(),
        isDeleted: false
    };

    await db.put(STORE_NAME, item);
    debouncedSyncStore(STORE_NAME);
    console.log(`[LocalStorage] ✅ Saved Composite ID: ${id} as ${storedUrl instanceof Blob ? 'Blob' : 'Base64'}`);
    return id;
};

// 3. Fetch All Images for Gallery (Filtered by User)
export const getLocalGallery = async (userId?: string): Promise<LocalGeneration[]> => {
    const db = await getDB();
    const all = await db.getAllFromIndex(STORE_NAME, 'timestamp'); // Get all sorted by time

    console.log(`[LocalStorage] 🔍 Fetching for User: "${userId}"`);

    const filtered = all.filter(item => {
        if (item.isDeleted) return false;

        // Strict User Matching
        // Check explicit userId field OR composite key prefix
        if (userId) {
            const isOwner = item.userId === userId || item.id.startsWith(`${userId}::`);
            return isOwner;
        }

        // If no userId provided (logged out), only show anonymous? 
        // Or maybe showing nothing is safer. 
        return false;
    });

    console.log(`[LocalStorage] 🎯 Found: ${filtered.length}`);

    // Process items sequentially or in batches if needed, but fetch for blob conversion is fast.
    const processed = await Promise.all(filtered.map(async (item) => {
        let displayUrl = item.url as string;

        // If it's a natively stored Blob, create an object URL
        if (item.url instanceof Blob) {
            displayUrl = URL.createObjectURL(item.url);
        } else if (typeof item.url === 'string' && item.url.startsWith('data:image')) {
            // Legacy items: Convert massive base64 strings to tiny Blob URLs to stop UI hanging
            try {
                const response = await fetch(item.url);
                const blob = await response.blob();
                displayUrl = URL.createObjectURL(blob);

                // Fire and forget upgrade: save the blob back to DB so we don't do this again next time
                const upgradedItem = { ...item, url: blob };
                db.put(STORE_NAME, upgradedItem).catch(() => { });
            } catch (err) {
                // Fallback to base64 if conversion fails
                console.warn('[LocalStorage] Failed to create blob URL for legacy image:', item.id);
            }
        }

        return { ...item, url: displayUrl } as LocalGeneration;
    }));

    return processed.reverse();
};

// 4. Delete Image (Soft or Hard)
export const deleteLocalImage = async (id: string): Promise<void> => {
    const db = await getDB();
    await db.delete(STORE_NAME, id);
    debouncedSyncStore(STORE_NAME);
    console.log('[LocalStorage] Deleted:', id);
};

// 5. Trigger Browser Download (For "Save to Computer")
export const triggerDownload = (base64: string, prompt: string) => {
    const link = document.createElement('a');
    link.href = base64;

    // Format Date: YYYY-MM-DD
    const date = new Date().toISOString().split('T')[0];
    // Sanitize Prompt for Filename
    const safePrompt = prompt.slice(0, 30).replace(/[^a-z0-9]/gi, '_');

    // Filename: Gods Eye Images/godseye_2025-12-23_prompt_start.png
    // Note: Browser support for subfolders varies (Works in Chrome/Edge, unreliable in Safari/FF)
    link.download = `Gods Eye Images/godseye_${date}_${safePrompt}.png`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    console.log('[LocalStorage] Triggered Download');
};

// ── Video Generation Persistence (IndexedDB blobs) ─────────────────────────

export interface StoredVideo {
    id: string;
    url: string;       // Original CDN URL (fallback)
    blob?: Blob;       // Permanent local blob
    prompt: string;
    modelName: string;
    aspectRatio: string;
    createdAt: number;
    projectId?: string; // If set, belongs to a video project/folder
}

export interface VideoProject {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    thumbnailVideoId?: string; // ID of a video to use as folder cover
}

/**
 * Save a generated video to IndexedDB.
 * Phase 1: saves metadata + CDN URL immediately.
 * Phase 2: downloads the video blob in background for permanent storage.
 */
export const saveVideoGeneration = async (video: StoredVideo): Promise<void> => {
    const db = await getDB();

    // Phase 1: Save with URL immediately
    await db.put(VIDEO_STORE, { ...video });
    debouncedSyncStore(VIDEO_STORE);
    console.log(`[VideoStore] ✅ Saved (URL) id=${video.id}`);

    // Phase 2: Download blob in background (fire-and-forget)
    (async () => {
        try {
            const response = await fetch(video.url);
            if (!response.ok) return;
            const blob = await response.blob();
            // Re-read to avoid overwriting any concurrent updates
            const existing = await db.get(VIDEO_STORE, video.id);
            if (existing) {
                await db.put(VIDEO_STORE, { ...existing, blob });
                console.log(`[VideoStore] ✅ Upgraded to Blob id=${video.id} (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
            }
        } catch {
            console.warn(`[VideoStore] Blob download skipped for id=${video.id} (CORS/network)`);
        }
    })();
};

/**
 * Load all videos from IndexedDB, returning blob URLs where available.
 * Falls back to CDN URL if blob wasn't downloaded yet.
 */
export const getVideoGenerations = async (): Promise<StoredVideo[]> => {
    const db = await getDB();
    const all: StoredVideo[] = await db.getAll(VIDEO_STORE);

    // Deduplicate by original URL — keep only the newest record per unique video
    const seenUrls = new Map<string, StoredVideo>();
    const duplicateIds: string[] = [];
    const sortedOldFirst = [...all].sort((a, b) => a.createdAt - b.createdAt);
    for (const v of sortedOldFirst) {
        const key = v.url.replace(/\?.*$/, '');
        if (seenUrls.has(key)) {
            duplicateIds.push(seenUrls.get(key)!.id);
        }
        seenUrls.set(key, v);
    }
    if (duplicateIds.length > 0) {
        console.log(`[VideoStore] Removing ${duplicateIds.length} duplicate video(s)`);
        (async () => {
            for (const id of duplicateIds) {
                try { await db.delete(VIDEO_STORE, id); } catch {}
            }
        })();
    }

    const unique = [...seenUrls.values()];
    const processed = unique.map(v => {
        let displayUrl = v.url;
        if (v.blob instanceof Blob && v.blob.size > 0) {
            displayUrl = URL.createObjectURL(v.blob);
        }
        return { ...v, url: displayUrl };
    });

    processed.sort((a, b) => b.createdAt - a.createdAt);
    console.log(`[VideoStore] 🎬 Loaded ${processed.length} videos (deduped from ${all.length})`);
    return processed;
};

/** Delete a single video from IndexedDB */
export const deleteVideoGeneration = async (id: string): Promise<void> => {
    const db = await getDB();
    await db.delete(VIDEO_STORE, id);
    debouncedSyncStore(VIDEO_STORE);
    console.log(`[VideoStore] 🗑️ Deleted id=${id}`);
};

/** Clear all videos from IndexedDB */
export const clearVideoGenerations = async (): Promise<void> => {
    const db = await getDB();
    await db.clear(VIDEO_STORE);
    console.log(`[VideoStore] 🗑️ Cleared all videos`);
};

// ── Video Projects (Folders) ──────────────────────────────────────────────

export const saveVideoProject = async (project: VideoProject): Promise<void> => {
    const db = await getDB();
    await db.put(VIDEO_PROJECTS_STORE, project);
    debouncedSyncStore(VIDEO_PROJECTS_STORE);
    console.log(`[VideoProjects] ✅ Saved project "${project.name}" id=${project.id}`);
};

export const getVideoProjects = async (): Promise<VideoProject[]> => {
    const db = await getDB();
    const all: VideoProject[] = await db.getAll(VIDEO_PROJECTS_STORE);
    all.sort((a, b) => b.createdAt - a.createdAt);
    return all;
};

export const deleteVideoProject = async (id: string): Promise<void> => {
    const db = await getDB();
    // Unassign all videos from this project (they become unorganized)
    const tx = db.transaction(VIDEO_STORE, 'readwrite');
    const index = tx.store.index('projectId');
    let cursor = await index.openCursor(id);
    while (cursor) {
        const video = { ...cursor.value, projectId: undefined };
        await cursor.update(video);
        cursor = await cursor.continue();
    }
    await tx.done;
    // Delete the project record
    await db.delete(VIDEO_PROJECTS_STORE, id);
    debouncedSyncStore(VIDEO_PROJECTS_STORE);
    console.log(`[VideoProjects] 🗑️ Deleted project id=${id}`);
};

export const getVideosByProject = async (projectId: string): Promise<StoredVideo[]> => {
    const db = await getDB();
    const all: StoredVideo[] = await db.getAllFromIndex(VIDEO_STORE, 'projectId', projectId);

    // Deduplicate by original URL — keep only the newest record per unique video URL
    const seenUrls = new Map<string, StoredVideo>();
    const duplicateIds: string[] = [];
    // Sort oldest first so newest overwrites in the map
    const sorted = [...all].sort((a, b) => a.createdAt - b.createdAt);
    for (const v of sorted) {
        // Normalize URL for comparison (strip blob: prefix, use raw CDN url stored in record)
        const key = v.url.replace(/\?.*$/, ''); // strip query params for dedup
        if (seenUrls.has(key)) {
            duplicateIds.push(seenUrls.get(key)!.id); // mark older one as duplicate
        }
        seenUrls.set(key, v);
    }
    // Clean up duplicates in background
    if (duplicateIds.length > 0) {
        console.log(`[VideoStore] Removing ${duplicateIds.length} duplicate video(s)`);
        (async () => {
            for (const id of duplicateIds) {
                try { await db.delete(VIDEO_STORE, id); } catch {}
            }
        })();
    }

    const unique = [...seenUrls.values()];
    const processed = unique.map(v => {
        let displayUrl = v.url;
        if (v.blob instanceof Blob && v.blob.size > 0) {
            displayUrl = URL.createObjectURL(v.blob);
        }
        return { ...v, url: displayUrl };
    });
    processed.sort((a, b) => b.createdAt - a.createdAt);
    return processed;
};

export const assignVideoToProject = async (videoId: string, projectId: string): Promise<void> => {
    const db = await getDB();
    const video = await db.get(VIDEO_STORE, videoId);
    if (video) {
        await db.put(VIDEO_STORE, { ...video, projectId });
    }
};

/** Get unorganized videos (no projectId) */
export const getUnorganizedVideos = async (): Promise<StoredVideo[]> => {
    const db = await getDB();
    const all: StoredVideo[] = await db.getAll(VIDEO_STORE);
    const unorganized = all.filter(v => !v.projectId);
    const processed = unorganized.map(v => {
        let displayUrl = v.url;
        if (v.blob instanceof Blob && v.blob.size > 0) {
            displayUrl = URL.createObjectURL(v.blob);
        }
        return { ...v, url: displayUrl };
    });
    processed.sort((a, b) => b.createdAt - a.createdAt);
    return processed;
};

/** Get raw video blob from IndexedDB (for ffmpeg processing) */
export const getVideoBlob = async (videoId: string): Promise<Blob | null> => {
    const db = await getDB();
    const video = await db.get(VIDEO_STORE, videoId);
    if (!video) return null;
    if (video.blob instanceof Blob) return video.blob;
    // Try to fetch from URL as fallback
    try {
        const res = await fetch(video.url);
        if (res.ok) return await res.blob();
    } catch {}
    return null;
};

// ── Chat Sync: Push conversations + messages to server ─────────────────────

export function syncChatToServer() {
    debouncedSyncStore(CONVERSATIONS_STORE);
    debouncedSyncStore(CHAT_MESSAGES_STORE);
}

/**
 * Immediately sync chat stores to server (no debounce).
 * Used after deletes so the server never holds stale/deleted data.
 */
export async function syncChatToServerImmediate(): Promise<void> {
    // Cancel any pending debounced syncs for these stores
    if (_syncTimers[CONVERSATIONS_STORE]) clearTimeout(_syncTimers[CONVERSATIONS_STORE]);
    if (_syncTimers[CHAT_MESSAGES_STORE]) clearTimeout(_syncTimers[CHAT_MESSAGES_STORE]);
    await syncStoreToServer(CONVERSATIONS_STORE);
    await syncStoreToServer(CHAT_MESSAGES_STORE);
}

/**
 * Restore conversations and chat messages from server into IndexedDB.
 * Called on app load when IndexedDB is empty (e.g. after browser cache clear).
 * Returns true if data was restored.
 */
export async function restoreChatFromServer(): Promise<boolean> {
    const db = await getDB();

    // Check if IndexedDB already has conversations
    const existingConvs = await db.getAll(CONVERSATIONS_STORE);
    if (existingConvs.length > 0) {
        return false; // Data exists, no restore needed
    }

    console.log('[Klint Sync] IndexedDB empty — attempting chat restore from server...');

    // Use relative URLs so Vite proxy handles routing (works in both dev and prod)
    const fetchBase = typeof window !== 'undefined' && window.location.origin
        ? '' // relative URL — Vite proxy or prod server handles /api/sync/*
        : SYNC_API_BASE;

    try {
        // Fetch conversations from server
        const convRes = await fetch(`${fetchBase}/api/sync/${CONVERSATIONS_STORE}`);
        if (!convRes.ok) throw new Error(`conversations fetch failed: ${convRes.status}`);
        const convData = await convRes.json();
        const conversations = convData?.data || [];

        // Fetch messages from server
        const msgRes = await fetch(`${fetchBase}/api/sync/${CHAT_MESSAGES_STORE}`);
        if (!msgRes.ok) throw new Error(`chat_messages fetch failed: ${msgRes.status}`);
        const msgData = await msgRes.json();
        const chatMessages = msgData?.data || [];

        if (conversations.length === 0 && chatMessages.length === 0) {
            console.log('[Klint Sync] No chat data on server to restore.');
            return false;
        }

        // Write conversations back into IndexedDB
        const convTx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
        for (const conv of conversations) {
            await convTx.store.put(conv);
        }
        await convTx.done;

        // Write messages back into IndexedDB
        const msgTx = db.transaction(CHAT_MESSAGES_STORE, 'readwrite');
        for (const msg of chatMessages) {
            await msgTx.store.put(msg);
        }
        await msgTx.done;

        console.log(`[Klint Sync] ✅ Restored ${conversations.length} conversations and ${chatMessages.length} messages from server.`);
        return true;
    } catch (err) {
        console.warn('[Klint Sync] ❌ Failed to restore chat from server:', err);
        return false;
    }
}
