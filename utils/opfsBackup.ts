import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { openDB } from 'idb';

const DB_NAME = 'klint-studio-db';
const BRAND_PROFILES_STORE = 'brand_profiles';
const CONTENT_SLOTS_STORE = 'content_slots';

/**
 * Recursively reads a directory and adds all its files into the provided JSZip folder.
 */
async function addDirectoryToZip(dirHandle: FileSystemDirectoryHandle, zipFolder: JSZip) {
    for await (const [name, handle] of (dirHandle as any).entries()) {
        if (handle.kind === 'file') {
            const file = await handle.getFile();
            zipFolder.file(name, file);
        } else if (handle.kind === 'directory') {
            const subFolder = zipFolder.folder(name);
            if (subFolder) {
                await addDirectoryToZip(handle, subFolder);
            }
        }
    }
}

/**
 * Exports the entire OPFS root directory into a downloadable ZIP file.
 */
export const exportOPFSToZip = async (filename: string = 'KlintBrain_Backup.zip') => {
    try {
        const rootDir = await navigator.storage.getDirectory();
        const zip = new JSZip();

        // Iterate through root and add folders (soul, memory, assets, etc)
        await addDirectoryToZip(rootDir, zip);

        // Backup Local DB (Brand Profiles and Content Slots)
        try {
            const db = await openDB(DB_NAME, 4);
            const profiles = await db.getAll(BRAND_PROFILES_STORE);
            const slots = await db.getAll(CONTENT_SLOTS_STORE);

            const dbDump = JSON.stringify({ brand_profiles: profiles, content_slots: slots });
            zip.file('klint_database_backup.json', dbDump);
        } catch (dbErr) {
            console.warn('Could not backup IndexedDB data:', dbErr);
        }

        // Generate zip blob and trigger download
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, filename);

        return true;
    } catch (error) {
        console.error('Failed to export OPFS:', error);
        return false;
    }
};

/**
 * Recursively restores a JSZip instance into an OPFS DirectoryHandle
 */
async function extractZipToDirectory(zipFolder: JSZip, targetDirHandle: FileSystemDirectoryHandle) {
    // Get all paths in the zip relative to this folder
    const files = Object.keys(zipFolder.files).filter(path => !zipFolder.files[path].dir);

    for (const relativePath of files) {
        const zipObject = zipFolder.files[relativePath];
        if (!zipObject) continue;

        // Split path to handle nested folders inside the zip
        const pathParts = relativePath.split('/');
        const fileName = pathParts.pop();
        if (!fileName) continue;

        // Navigate/create subdirectories in OPFS
        let currentDirHandle = targetDirHandle;
        for (const part of pathParts) {
            if (part) {
                currentDirHandle = await currentDirHandle.getDirectoryHandle(part, { create: true });
            }
        }

        // Write file data
        const fileData = await zipObject.async('blob');
        const fileHandle = await currentDirHandle.getFileHandle(fileName, { create: true });

        // @ts-ignore - TS doesn't know about File System Access API's createWritable in some typed configs
        const writable = await fileHandle.createWritable();
        await writable.write(fileData);
        await writable.close();
    }
}

/**
 * Imports a ZIP file, clearing the existing OPFS root, and extracting the zip contents.
 */
export const importOPFSFromZip = async (zipFile: File): Promise<boolean> => {
    try {
        const rootDir = await navigator.storage.getDirectory();

        // 1. Wipe current OPFS root clean
        for await (const [name] of (rootDir as any).entries()) {
            await rootDir.removeEntry(name, { recursive: true });
        }

        // 2. Load zip file
        const zip = await JSZip.loadAsync(zipFile);

        // 3. Extract to OPFS
        await extractZipToDirectory(zip, rootDir);

        // 4. Restore Local DB (Brands) if present
        const dbBackupJSON = zip.file('klint_database_backup.json');
        if (dbBackupJSON) {
            try {
                const dbDataStr = await dbBackupJSON.async('string');
                const dbData = JSON.parse(dbDataStr);
                const db = await openDB(DB_NAME, 4);

                // Restore logic
                if (dbData.brand_profiles) {
                    const tx = db.transaction(BRAND_PROFILES_STORE, 'readwrite');
                    for (const row of dbData.brand_profiles) await tx.store.put(row);
                    await tx.done;
                }
                if (dbData.content_slots) {
                    const tx = db.transaction(CONTENT_SLOTS_STORE, 'readwrite');
                    for (const row of dbData.content_slots) await tx.store.put(row);
                    await tx.done;
                }
            } catch (dbErr) {
                console.error("Failed to restore IndexedDB brand data:", dbErr);
            }
        }

        return true;
    } catch (error) {
        console.error('Failed to import OPFS:', error);
        return false;
    }
};
