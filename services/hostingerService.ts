// Media uploads go directly to Hostinger via Cloud Run server — no Supabase involved.
// Storage quota and file tracking are managed in localStorage.

export interface UploadResult {
    url: string;
    size: number;
    compressionRatio: string;
}

export interface StorageQuota {
    user_id: string;
    total_bytes: number;
    max_bytes: number;
    percentage_used: number;
}

const QUOTA_KEY = (userId: string) => `klint_quota_${userId}`;
const FILES_KEY = (userId: string) => `klint_media_files_${userId}`;
const MAX_BYTES = 1073741824; // 1GB

/**
 * Upload media (image/video) to Hostinger via Cloud Run proxy.
 */
export const uploadToHostinger = async (
    mediaBase64: string,
    type: 'image' | 'video',
    userId: string,
    originalSize?: number
): Promise<UploadResult> => {
    const response = await fetch('/api/hostinger-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media: mediaBase64, type, userId }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upload to Hostinger');
    }

    const result = await response.json() as UploadResult;

    // Track in localStorage
    const files = getUserMediaFilesSync(userId);
    files.push({ id: crypto.randomUUID(), user_id: userId, file_type: type, file_url: result.url, compressed_size: result.size, created_at: new Date().toISOString() });
    localStorage.setItem(FILES_KEY(userId), JSON.stringify(files));

    const quota = getUserStorageQuotaSync(userId);
    quota.total_bytes += result.size;
    localStorage.setItem(QUOTA_KEY(userId), JSON.stringify(quota));

    return result;
};

function getUserStorageQuotaSync(userId: string): StorageQuota {
    try {
        const stored = localStorage.getItem(QUOTA_KEY(userId));
        return stored ? JSON.parse(stored) : { user_id: userId, total_bytes: 0, max_bytes: MAX_BYTES, percentage_used: 0 };
    } catch { return { user_id: userId, total_bytes: 0, max_bytes: MAX_BYTES, percentage_used: 0 }; }
}

function getUserMediaFilesSync(userId: string): any[] {
    try { return JSON.parse(localStorage.getItem(FILES_KEY(userId)) || '[]'); } catch { return []; }
}

export const getUserStorageQuota = async (userId: string): Promise<StorageQuota | null> => {
    const q = getUserStorageQuotaSync(userId);
    return { ...q, percentage_used: (q.total_bytes / q.max_bytes) * 100 };
};

export const getUserMediaFiles = async (userId: string) => getUserMediaFilesSync(userId);

export const deleteMediaFile = async (fileId: string, userId?: string) => {
    if (!userId) return false;
    const files = getUserMediaFilesSync(userId);
    const file = files.find((f: any) => f.id === fileId);
    const updated = files.filter((f: any) => f.id !== fileId);
    localStorage.setItem(FILES_KEY(userId), JSON.stringify(updated));
    if (file) {
        const quota = getUserStorageQuotaSync(userId);
        quota.total_bytes = Math.max(0, quota.total_bytes - (file.compressed_size || 0));
        localStorage.setItem(QUOTA_KEY(userId), JSON.stringify(quota));
    }
    return true;
};

/**
 * Helper to convert bytes to human-readable format
 */
export const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const decimals = 2;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
};
