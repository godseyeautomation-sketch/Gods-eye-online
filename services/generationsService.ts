import { saveToLocalGallery, getLocalGallery, deleteLocalImage } from './localStorageService';

export interface Generation {
    id: string;
    user_id: string;
    type: 'image' | 'video' | 'character';
    content_url: string;
    thumbnail_url?: string;
    title?: string;
    prompt?: string;
    metadata?: any;
    created_at: string;
}

/**
 * Save a generation — stored locally in IndexedDB, never sent to Supabase.
 */
export const saveGeneration = async (
    userId: string,
    type: 'image' | 'video' | 'character',
    contentUrl: string,
    options?: {
        thumbnailUrl?: string;
        title?: string;
        prompt?: string;
        metadata?: any;
    }
): Promise<Generation | null> => {
    // Blob URLs are temporary (videos) — can't persist them
    if (contentUrl.startsWith('blob:')) return null;

    try {
        const id = await saveToLocalGallery(
            contentUrl,
            options?.prompt || options?.title || '',
            options?.metadata?.aspectRatio || '1:1',
            options?.metadata?.provider || type,
            userId
        );
        return {
            id,
            user_id: userId,
            type,
            content_url: contentUrl,
            thumbnail_url: options?.thumbnailUrl,
            title: options?.title,
            prompt: options?.prompt,
            metadata: options?.metadata,
            created_at: new Date().toISOString(),
        };
    } catch (error: any) {
        console.error('Save generation error:', error);
        return null;
    }
};

/**
 * Get all generations for a user from local IndexedDB.
 */
export const getUserGenerations = async (
    userId: string,
    type?: 'image' | 'video' | 'character'
): Promise<Generation[]> => {
    const gens = await getLocalGallery(userId);
    const mapped: Generation[] = gens.map(g => ({
        id: g.id,
        user_id: userId,
        type: 'image' as const,
        content_url: g.url,
        prompt: g.prompt,
        created_at: new Date(g.timestamp).toISOString(),
    }));
    return type ? mapped.filter(g => g.type === type) : mapped;
};

/**
 * Delete a generation from local IndexedDB.
 */
export const deleteGeneration = async (id: string, _contentUrl?: string): Promise<boolean> => {
    try {
        await deleteLocalImage(id);
        return true;
    } catch (error: any) {
        console.error('Delete generation error:', error);
        return false;
    }
};

/**
 * Get generation statistics from local IndexedDB.
 */
export const getGenerationStats = async (userId: string) => {
    const gens = await getLocalGallery(userId);
    return {
        total: gens.length,
        images: gens.length,
        videos: 0,
        characters: 0,
    };
};
