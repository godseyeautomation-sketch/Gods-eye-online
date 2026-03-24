import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { publicId, resourceType = 'image' } = await req.json()

        if (!publicId) {
            throw new Error('Missing publicId')
        }

        // Get credentials from Environment Variables
        const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME') || Deno.env.get('VITE_CLOUDINARY_CLOUD_NAME')
        const apiKey = Deno.env.get('CLOUDINARY_API_KEY')
        const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET')

        if (!cloudName || !apiKey || !apiSecret) {
            throw new Error('Server missing Cloudinary credentials')
        }

        // Generate Signature for authenticated request
        const timestamp = Math.round(new Date().getTime() / 1000)
        const params = `public_id=${publicId}&timestamp=${timestamp}`

        // Simple SHA-1 signature generation (Cloudinary requirement)
        const encoder = new TextEncoder()
        const data = encoder.encode(params + apiSecret)
        const hashBuffer = await crypto.subtle.digest('SHA-1', data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

        const formData = new FormData()
        formData.append('public_id', publicId)
        formData.append('api_key', apiKey)
        formData.append('timestamp', timestamp.toString())
        formData.append('signature', signature)
        formData.append('resource_type', resourceType)

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
            method: 'POST',
            body: formData
        })

        const result = await response.json()

        return new Response(
            JSON.stringify(result),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
