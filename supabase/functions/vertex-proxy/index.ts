import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Global Cache (Persists across Warm Starts)
let cachedAccessToken: string | null = null;
let cachedTokenExpiry: number = 0;
let cachedCryptoKey: CryptoKey | null = null;
let cachedServiceAccount: any = null;

serve(async (req) => {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { prompt, model, type, aspectRatio, baseImages, quality } = await req.json()

        // 2. Get GCP Credentials (Cached)
        if (!cachedServiceAccount) {
            const serviceAccountStr = Deno.env.get('GCP_SERVICE_ACCOUNT')
            if (!serviceAccountStr) throw new Error('Missing GCP_SERVICE_ACCOUNT secret')
            try {
                cachedServiceAccount = JSON.parse(serviceAccountStr)
            } catch (e) {
                throw new Error('GCP_SERVICE_ACCOUNT is not valid JSON')
            }
        }

        // 3. Import Private Key (Cached)
        if (!cachedCryptoKey) {
            try {
                const pemContents = cachedServiceAccount.private_key
                    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
                    .replace(/-----END PRIVATE KEY-----/g, '')
                    .replace(/\s/g, '');

                const binaryDerString = atob(pemContents);
                const binaryDer = new Uint8Array(binaryDerString.length);
                for (let i = 0; i < binaryDerString.length; i++) {
                    binaryDer[i] = binaryDerString.charCodeAt(i);
                }

                cachedCryptoKey = await crypto.subtle.importKey(
                    "pkcs8",
                    binaryDer,
                    {
                        name: "RSASSA-PKCS1-v1_5",
                        hash: "SHA-256",
                    },
                    true,
                    ["sign"]
                );
            } catch (e) {
                console.error("Key Import Error:", e);
                throw new Error(`Failed to import Private Key: ${e.message}`);
            }
        }

        // 4. Get Access Token (Cached or Refresh)
        const now = Math.floor(Date.now() / 1000);
        let accessToken = cachedAccessToken;

        if (!accessToken || now >= cachedTokenExpiry) {
            console.log('Generating New Google Access Token...');

            // Generate JWT
            const signedJwt = await create(
                { alg: "RS256", typ: "JWT" },
                {
                    iss: cachedServiceAccount.client_email,
                    scope: "https://www.googleapis.com/auth/cloud-platform",
                    aud: "https://oauth2.googleapis.com/token",
                    exp: getNumericDate(60 * 60),
                    iat: getNumericDate(0),
                },
                cachedCryptoKey
            )

            // Exchange for Access Token
            const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    assertion: signedJwt,
                }),
            })

            if (!tokenResp.ok) {
                const errText = await tokenResp.text();
                throw new Error(`Google Token Error: ${tokenResp.status} - ${errText}`);
            }

            const tokenData = await tokenResp.json()
            accessToken = tokenData.access_token

            // Cache it (Expiry - 60s buffer)
            cachedAccessToken = accessToken;
            cachedTokenExpiry = now + (tokenData.expires_in || 3600) - 60;
        } else {
            console.log('Using Cached Google Access Token (Warm Start)');
        }

        const projectId = cachedServiceAccount.project_id
        const location = "us-central1"
        let apiUrl = "";
        let requestBody = {};

        if (model.startsWith('gemini')) {
            // GEMINI API (Multimodal)
            // Gemini 3 Pro Image requires 'global' location, not regional
            const useGlobal = model === 'gemini-3-pro-image-preview'
            const effectiveLocation = useGlobal ? 'global' : location

            if (useGlobal) {
                // Global endpoint (no region prefix)
                apiUrl = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/global/publishers/google/models/${model}:generateContent`
            } else {
                // Regional endpoint
                apiUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`
            }

            const parts: any[] = [{ text: prompt }];

            if (baseImages && baseImages.length > 0) {
                baseImages.forEach((img: string) => {
                    const cleanBase64 = img.replace(/^data:image\/\w+;base64,/, "");
                    parts.push({
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: cleanBase64
                        }
                    });
                });
            }

            // Map quality to imageSize for Gemini 3 Pro Image
            let imageSize = undefined;
            if (model === 'gemini-3-pro-image-preview' && quality) {
                const qualityMap: Record<string, string> = {
                    'standard': '1K',
                    'regular': '1K',
                    '1K': '1K',
                    'hd': '2K',
                    'HD': '2K',
                    '2K': '2K',
                    'qhd': '4K',
                    'QHD': '4K',
                    'uhd': '4K',
                    'UHD': '4K',
                    '4K': '4K'
                };
                imageSize = qualityMap[quality] || '1K';
            }

            requestBody = {
                contents: [{ role: "user", parts: parts }],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    imageConfig: {
                        aspectRatio: aspectRatio || "1:1",
                        ...(imageSize && { imageSize })
                    }
                }
            };
        } else if (type === 'image') {
            // IMAGEN API (Predict)
            apiUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predict`

            const instance: any = { prompt: prompt };

            // Handle Reference Image (Sketch/Edit)
            if (baseImages && baseImages.length > 0) {
                const cleanBase64 = baseImages[0].replace(/^data:image\/\w+;base64,/, "");
                instance.image = { bytesBase64Encoded: cleanBase64 };
            }

            requestBody = {
                instances: [instance],
                parameters: {
                    sampleCount: 1,
                    aspectRatio: aspectRatio || "1:1",
                }
            };
        } else if (type === 'video') {
            // VEO API (Predict)
            apiUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/veo-2.0-generate-preview-001:predict`
            requestBody = {
                instances: [{ prompt: prompt, aspect_ratio: aspectRatio || "16:9" }],
                parameters: {}
            };
        }

        const aiResponse = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify(requestBody)
        });

        const aiData = await aiResponse.json();

        // DEBUG: Log the full response to understand structure
        console.log('API Response Status:', aiResponse.status);
        console.log('API Response Data:', JSON.stringify(aiData, null, 2));

        if (!aiResponse.ok) {
            const errorMessage = aiData?.error?.message || JSON.stringify(aiData);

            // Special handling for Gemini 3 Pro Image errors
            if (model === 'gemini-3-pro-image-preview') {
                if (aiResponse.status === 429) {
                    throw new Error('Nano Banana Pro is currently overloaded. Please try again in a few moments.');
                } else if (aiResponse.status === 503) {
                    throw new Error('Nano Banana Pro service is temporarily unavailable. Please try again.');
                } else {
                    throw new Error(`Nano Banana Pro Error (${aiResponse.status}): ${errorMessage}`);
                }
            }

            throw new Error(`Vertex AI API Error: ${JSON.stringify(aiData)}`)
        }

        return new Response(
            JSON.stringify(aiData),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )

    } catch (error) {
        console.error("Edge Function Error:", error)
        return new Response(
            JSON.stringify({
                error: error.message,
                stack: error.stack,
                details: "Check Supabase Edge Function Logs for more info."
            }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        )
    }
})
