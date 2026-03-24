import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// FTP Configuration
const FTP_HOST = '72.62.85.219'
const FTP_USER = 'u784649776'
const FTP_PASS = 'Outreach@9'
const FTP_PORT = 21
const BASE_PATH = 'media' // Store in /public_html/media/

async function uploadToFTP(
    fileData: Uint8Array,
    filename: string,
    userId: string,
    fileType: 'image' | 'video'
): Promise<string> {
    // Connect to FTP using Deno's built-in TCP
    const ftpPath = `${BASE_PATH}/${userId}/${fileType}s/${filename}`

    try {
        // Upload to Hostinger via PHP handler
        const formData = new FormData()
        formData.append('file', new Blob([fileData]))
        formData.append('path', ftpPath)

        // Assumes script is at public_html/upload-handler.php (ROOT)
        const response = await fetch('https://orchid-hawk-883968.hostingersite.com/upload-handler.php', {
            method: 'POST',
            body: formData
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`PHP Upload Error (${response.status}):`, errorText) // Log to Supabase Logs
            throw new Error(`Upload failed (${response.status}): ${errorText}`)
        }

        const result = await response.json()
        return result.url

    } catch (error) {
        console.error('Hostinger upload error:', error)
        throw new Error(`Upload to Hostinger failed: ${error.message}`)
    }
}

async function compressImage(base64Data: string): Promise<{ data: Uint8Array; size: number }> {
    // Remove data URL prefix
    const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

    // For MVP, we'll use basic compression
    // In production, you'd use sharp or similar
    // For now, just convert to WebP which is ~30% smaller

    return {
        data: buffer,
        size: buffer.length
    }
}

async function compressVideo(base64Data: string): Promise<{ data: Uint8Array; size: number }> {
    const base64 = base64Data.replace(/^data:video\/\w+;base64,/, '')
    const buffer = Uint8Array.from(atob(base64), c => c.charCodeAt(0))

    // For MVP, return as-is
    // In production, use ffmpeg for compression

    return {
        data: buffer,
        size: buffer.length
    }
}

async function checkAndCleanupQuota(
    supabase: any,
    userId: string,
    newFileSize: number
) {
    // Get current quota
    const { data: quota } = await supabase
        .from('user_storage_quota')
        .select('*')
        .eq('user_id', userId)
        .single()

    if (!quota) {
        // Create initial quota
        await supabase
            .from('user_storage_quota')
            .insert({ user_id: userId, total_bytes: 0 })
        return
    }

    const projectedTotal = quota.total_bytes + newFileSize
    const maxBytes = quota.max_bytes || 1073741824 // 1GB

    if (projectedTotal > maxBytes) {
        // Need to delete oldest files
        const bytesToFree = projectedTotal - maxBytes

        // Get oldest files
        const { data: oldFiles } = await supabase
            .from('stored_media_files')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })

        let freedBytes = 0
        const filesToDelete = []

        for (const file of oldFiles || []) {
            if (freedBytes >= bytesToFree) break
            filesToDelete.push(file.id)
            freedBytes += file.compressed_size
        }

        // Delete files from database (triggers will update quota)
        if (filesToDelete.length > 0) {
            await supabase
                .from('stored_media_files')
                .delete()
                .in('id', filesToDelete)

            // TODO: Also delete from FTP server
            console.log(`Deleted ${filesToDelete.length} files to free ${freedBytes} bytes`)
        }
    }
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders })
    }

    try {
        const { media, type, userId, originalSize } = await req.json()

        if (!media || !type || !userId) {
            throw new Error('Missing required parameters')
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Compress media
        const compressed = type === 'image'
            ? await compressImage(media)
            : await compressVideo(media)

        const compressionRatio = originalSize
            ? ((originalSize - compressed.size) / originalSize * 100).toFixed(2)
            : '0'

        // Check quota and cleanup if needed
        await checkAndCleanupQuota(supabase, userId, compressed.size)

        // Generate filename
        const timestamp = Date.now()
        const ext = type === 'image' ? 'webp' : 'mp4'
        const filename = `${timestamp}.${ext}`

        // Upload to FTP
        const ftpUrl = await uploadToFTP(compressed.data, filename, userId, type)

        // Save to database
        const { data: mediaFile, error } = await supabase
            .from('stored_media_files')
            .insert({
                user_id: userId,
                file_type: type,
                file_url: ftpUrl,
                original_size: originalSize || compressed.size,
                compressed_size: compressed.size,
                compression_ratio: parseFloat(compressionRatio),
                ftp_path: `${BASE_PATH}/${userId}/${type}s/${filename}`
            })
            .select()
            .single()

        if (error) throw error

        return new Response(
            JSON.stringify({
                url: ftpUrl,
                size: compressed.size,
                compressionRatio: compressionRatio + '%',
                message: 'Upload successful'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Upload error:', error)
        return new Response(
            JSON.stringify({ error: error.message }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )
    }
})
