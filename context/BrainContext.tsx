import React, { createContext, useContext, useState, useEffect } from 'react';
import { trainText, trainImage, trainBrandDNA, buildRAGContext, retrieveContext } from '../services/embeddingService';
import { vectorCount, listVectors, clearVectors, removeVector, type SearchResult, type VectorEntry } from '../services/opfsVectorStore';

// Types for File System Access API
interface FileSystemDirectoryHandle {
    kind: 'directory';
    name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<any>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
}

interface BrainContextType {
    isConnected: boolean;
    dirHandle: FileSystemDirectoryHandle | null;
    currentProjectTag: string;
    availableTags: string[];
    vectorsCount: number;
    connectBrain: () => Promise<void>;
    setProjectTag: (tag: string) => void;
    addTag: (tag: string) => void;
    saveAssetToBrain: (imageUrl: string, prompt: string) => Promise<boolean>;
    removeAssetFromBrain: (prompt: string) => Promise<boolean>;
    trainFromDownload: (prompt: string) => Promise<void>;
    trainBrand: (brandData: any) => Promise<void>;
    getRAGContext: (prompt: string, topK?: number) => Promise<string>;
    searchBrain: (query: string, topK?: number) => Promise<SearchResult[]>;
    refreshVectorCount: () => Promise<void>;
    clearBrain: () => Promise<void>;
    listEntries: () => Promise<VectorEntry[]>;
    deleteEntry: (id: string) => Promise<void>;
}

const BrainContext = createContext<BrainContextType | undefined>(undefined);

export const BrainProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null);
    const [currentProjectTag, setCurrentProjectTag] = useState<string>('Default_Project');
    const [availableTags, setAvailableTags] = useState<string[]>(['Default_Project']);
    const [isConnected, setIsConnected] = useState<boolean>(false);
    const [vectorsCount, setVectorsCount] = useState<number>(0);

    // Load tags from local storage
    useEffect(() => {
        const savedTags = localStorage.getItem('klint_brain_tags');
        if (savedTags) {
            try {
                setAvailableTags(JSON.parse(savedTags));
            } catch (e) {
                console.error('Failed to parse saved tags', e);
            }
        }
        const savedCurrentTag = localStorage.getItem('klint_brain_current_tag');
        if (savedCurrentTag) {
            setCurrentProjectTag(savedCurrentTag);
        }
    }, []);

    const connectBrain = async () => {
        try {
            if (!navigator.storage || !navigator.storage.getDirectory) {
                console.error("OPFS is not supported in this browser.");
                alert("Your browser doesn't support OPFS. Please use Chrome/Edge/Safari/Firefox.");
                return;
            }

            const root = await navigator.storage.getDirectory();
            setDirHandle(root);

            await setupOpenClawArchitecture(root, currentProjectTag);

            setIsConnected(true);
            console.log('✅ Local OPFS Brain connected with Gemini Embedding 2 RAG.');

            // Load vector count
            try {
                const count = await vectorCount(currentProjectTag);
                setVectorsCount(count);
            } catch { /* first run, no vectors yet */ }
        } catch (error) {
            console.error('Failed to initialize OPFS Brain', error);
        }
    };

    const setupOpenClawArchitecture = async (rootHandle: FileSystemDirectoryHandle, projectTag: string) => {
        try {
            const projectDir = await rootHandle.getDirectoryHandle(projectTag, { create: true });

            await projectDir.getDirectoryHandle('soul', { create: true });
            await projectDir.getDirectoryHandle('memory', { create: true });
            await projectDir.getDirectoryHandle('assets', { create: true });
            await projectDir.getDirectoryHandle('campaigns', { create: true });
            await projectDir.getDirectoryHandle('vectors', { create: true });  // NEW: vector store
        } catch (error) {
            console.error('Error scaffolding architecture:', error);
        }
    };

    // Auto-connect on startup
    useEffect(() => {
        connectBrain();
    }, []);

    const addTag = (newTag: string) => {
        if (!newTag.trim()) return;
        const formattedTag = newTag.trim().replace(/[^a-zA-Z0-9_\- ]/g, '');
        if (!availableTags.includes(formattedTag)) {
            const updated = [...availableTags, formattedTag];
            setAvailableTags(updated);
            localStorage.setItem('klint_brain_tags', JSON.stringify(updated));
        }
        setProjectTag(formattedTag);
    };

    const setProjectTag = async (tag: string) => {
        setCurrentProjectTag(tag);
        localStorage.setItem('klint_brain_current_tag', tag);

        if (dirHandle) {
            await setupOpenClawArchitecture(dirHandle, tag);
        }

        // Update vector count for new tag
        try {
            const count = await vectorCount(tag);
            setVectorsCount(count);
        } catch { setVectorsCount(0); }
    };

    const refreshVectorCount = async () => {
        try {
            const count = await vectorCount(currentProjectTag);
            setVectorsCount(count);
        } catch { setVectorsCount(0); }
    };

    /**
     * Save image asset to OPFS + create multimodal embedding
     */
    const saveAssetToBrain = async (imageUrl: string, prompt: string): Promise<boolean> => {
        if (!dirHandle || !isConnected) {
            alert("Please connect your Local Brain first.");
            return false;
        }

        try {
            // 1. Save image blob to OPFS assets folder (existing behavior)
            const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: false });
            const assetsDir = await projectDir.getDirectoryHandle('assets', { create: false });

            const res = await fetch(imageUrl);
            const blob = await res.blob();

            const cleanPrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
            const filename = `klint_asset_${cleanPrompt}_${Date.now()}.png`.replace(/_+/g, '_');

            const fileHandle = await assetsDir.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            console.log('✅ Asset saved to Brain:', filename);

            // 2. NEW: Create embedding and store in vector index
            try {
                // Convert blob to data URL for embedding
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });

                await trainImage(currentProjectTag, dataUrl, prompt, 'asset');
                await refreshVectorCount();
                console.log('✅ Embedding created for asset');
            } catch (embErr) {
                console.warn('[Brain] Embedding failed (asset still saved):', embErr);
                // Fallback: still train with text-only embedding
                try {
                    await trainText(currentProjectTag, prompt, 'style');
                    await refreshVectorCount();
                } catch { /* silent */ }
            }

            return true;
        } catch (error) {
            console.error("Failed to save to Brain", error);
            return false;
        }
    };

    const removeAssetFromBrain = async (prompt: string): Promise<boolean> => {
        if (!dirHandle || !isConnected) return false;
        try {
            const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: false });
            const assetsDir = await projectDir.getDirectoryHandle('assets', { create: false });

            const cleanPrompt = prompt.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_');
            const prefix = `klint_asset_${cleanPrompt}`.replace(/_+/g, '_');

            for await (const [name] of (assetsDir as any).entries()) {
                if (typeof name === 'string' && name.startsWith(prefix)) {
                    await (assetsDir as any).removeEntry(name);
                    console.log('✅ Removed asset from Brain:', name);
                }
            }

            // Note: We don't remove the embedding since it's identified by auto-generated ID.
            // Old embeddings with low similarity will naturally rank lower in searches.

            return true;
        } catch (error) {
            console.error("Failed to remove asset from Brain", error);
            return false;
        }
    };

    /**
     * Train from a downloaded/liked image's prompt
     * Creates a text embedding of the style preferences
     */
    const trainFromDownload = async (prompt: string) => {
        if (!isConnected) return;
        try {
            await trainText(currentProjectTag, prompt, 'style');
            await refreshVectorCount();
            console.log('✅ Brain trained from download prompt');
        } catch (error) {
            console.error("Failed to train from download", error);
        }
    };

    /**
     * Train brand DNA — embeds all brand attributes as a rich vector
     */
    const trainBrand = async (brandData: any) => {
        if (!isConnected) return;
        try {
            await trainBrandDNA(currentProjectTag, brandData);
            await refreshVectorCount();
            console.log('✅ Brand DNA embedded into brain');
        } catch (error) {
            console.error("Failed to train brand DNA", error);
        }
    };

    /**
     * Get RAG context string for prompt injection into image generation
     * Returns formatted context from top-K similar training entries
     */
    const getRAGContext = async (prompt: string, topK: number = 5): Promise<string> => {
        if (!isConnected) return '';
        try {
            return await buildRAGContext(currentProjectTag, prompt, { topK, threshold: 0.3 });
        } catch (error) {
            console.error('[Brain] RAG retrieval failed:', error);
            return '';
        }
    };

    /**
     * Search brain for similar content (exposed for UI/debug)
     */
    const searchBrain = async (query: string, topK: number = 5): Promise<SearchResult[]> => {
        if (!isConnected) return [];
        try {
            return await retrieveContext(currentProjectTag, query, topK);
        } catch (error) {
            console.error('[Brain] Search failed:', error);
            return [];
        }
    };

    return (
        <BrainContext.Provider value={{
            isConnected, dirHandle, currentProjectTag, availableTags, vectorsCount,
            connectBrain, setProjectTag, addTag,
            saveAssetToBrain, removeAssetFromBrain, trainFromDownload,
            trainBrand, getRAGContext, searchBrain, refreshVectorCount,
            clearBrain: async () => {
                try {
                    await clearVectors(currentProjectTag);
                    setVectorsCount(0);
                    console.log('[Brain] Cleared all vectors for project:', currentProjectTag);
                } catch (err) {
                    console.error('[Brain] Clear failed:', err);
                }
            },
            listEntries: async () => {
                try {
                    return await listVectors(currentProjectTag);
                } catch (err) {
                    console.error('[Brain] List entries failed:', err);
                    return [];
                }
            },
            deleteEntry: async (id: string) => {
                try {
                    await removeVector(currentProjectTag, id);
                    setVectorsCount(prev => Math.max(0, prev - 1));
                    console.log('[Brain] Deleted vector:', id);
                } catch (err) {
                    console.error('[Brain] Delete entry failed:', err);
                }
            },
        }}>
            {children}
        </BrainContext.Provider>
    );
};

export const useBrain = () => {
    const context = useContext(BrainContext);
    if (context === undefined) {
        throw new Error('useBrain must be used within a BrainProvider');
    }
    return context;
};
