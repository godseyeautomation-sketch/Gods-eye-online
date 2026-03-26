import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import { registerCronRoutes, loadAndScheduleAll } from './services/cronEngine.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// ── Local Bridge Proxy ───────────────────────────────────────────────────────
// The local bridge server (local-bridge-server.cjs) runs on the HOST machine
// (not inside Docker) because it spawns local CLI processes (claude, codex).
// This proxy forwards /bridge requests from the container to the host bridge.
const BRIDGE_HOST = process.env.BRIDGE_HOST || 'host.docker.internal';
const BRIDGE_PORT = process.env.BRIDGE_PORT || '3456';
const BRIDGE_TARGET = `http://${BRIDGE_HOST}:${BRIDGE_PORT}`;

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const kimiApiKey = process.env.KIMI_API_KEY || process.env.VITE_KIMI_API_KEY;
const uploadPostApiKey = process.env.UPLOAD_POST_API_KEY;

// Middleware for JSON parsing with large body limits
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// CORS headers if needed (for same-origin it might not be required but kept for safety)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ── fal.ai API Proxy (queue.fal.run) ───────────────────────────────────────
const falKey = process.env.FAL_KEY;

app.all('/api/fal/*', async (req, res) => {
  try {
    if (!falKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

    const falPath = req.path.replace('/api/fal/', '');
    const targetUrl = `https://queue.fal.run/${falPath}`;

    const fetchOptions = {
      method: req.method,
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── fal.ai Storage Proxy (rest.fal.ai) ──────────────────────────────────────
// Used to initiate signed uploads for local images (returns upload_url + file_url)
app.all('/api/fal-storage/*', async (req, res) => {
  try {
    if (!falKey) return res.status(500).json({ error: 'FAL_KEY not configured on server' });

    const storagePath = req.path.replace('/api/fal-storage/', '');
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `https://rest.fal.ai/${storagePath}${query}`;

    const fetchOptions = {
      method: req.method,
      headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── fal.ai Binary Upload Proxy ──────────────────────────────────────────────
// Receives { upload_url, base64, content_type } and PUTs binary to signed URL
// from the server side — avoids browser CORS restrictions on fal.media
app.post('/api/fal-upload', async (req, res) => {
  try {
    const { upload_url, base64, content_type } = req.body;
    if (!upload_url || !base64) return res.status(400).json({ error: 'upload_url and base64 are required' });

    const buffer = Buffer.from(base64, 'base64');
    const response = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': content_type || 'application/octet-stream' },
      body: buffer,
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Upload PUT failed: ${response.status}` });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Hostinger Media Upload ──────────────────────────────────────────────────
// Relays base64 media to the PHP upload handler on Hostinger.
// Replaces the old Supabase edge function — media never touches Supabase.
app.post('/api/hostinger-upload', async (req, res) => {
  try {
    const { media, type, userId } = req.body;
    if (!media || !type || !userId) {
      return res.status(400).json({ error: 'Missing required parameters: media, type, userId' });
    }

    const base64 = media.replace(/^data:\w+\/\w+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    const timestamp = Date.now();
    const ext = type === 'image' ? 'webp' : 'mp4';
    const filename = `${timestamp}.${ext}`;
    const ftpPath = `media/${userId}/${type}s/${filename}`;

    const { FormData, Blob } = await import('node:buffer').catch(() => ({ FormData: globalThis.FormData, Blob: globalThis.Blob }));
    const formData = new (globalThis.FormData || FormData)();
    formData.append('file', new (globalThis.Blob || Blob)([buffer]));
    formData.append('path', ftpPath);

    const response = await fetch('https://orchid-hawk-883968.hostingersite.com/upload-handler.php', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: errText });
    }

    const result = await response.json();
    res.json({ url: result.url, size: buffer.length, compressionRatio: '0%' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Upload-Post API Proxy ────────────────────────────────────────────────────
// Proxies all requests to Upload-Post API, keeping the API key server-side.
const UPLOAD_POST_BASE = 'https://api.upload-post.com';

// Helper: proxy a request to Upload-Post
async function proxyUploadPost(req, res, method, apiPath, body) {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });

    const url = `${UPLOAD_POST_BASE}${apiPath}`;
    const fetchOpts = {
      method,
      headers: {
        'Authorization': `Apikey ${uploadPostApiKey}`,
        'Content-Type': 'application/json',
      },
    };
    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOpts.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOpts);
    const data = await response.text();
    try {
      res.status(response.status).json(JSON.parse(data));
    } catch {
      res.status(response.status).send(data);
    }
  } catch (error) {
    console.error('[Upload-Post] Proxy error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

// Upload videos
app.post('/api/upload-post/videos', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload_videos', req.body));

// Upload photos
app.post('/api/upload-post/photos', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload_photos', req.body));

// Upload text
app.post('/api/upload-post/text', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload_text', req.body));

// Upload documents
app.post('/api/upload-post/documents', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload-document', req.body));

// Check upload status
app.get('/api/upload-post/status', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/status${qs}`);
});

// Upload history
app.get('/api/upload-post/history', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/history${qs}`);
});

// Schedule management
app.get('/api/upload-post/schedule', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/schedule'));
app.delete('/api/upload-post/schedule/:jobId', (req, res) => proxyUploadPost(req, res, 'DELETE', `/api/uploadposts/schedule/${req.params.jobId}`));
app.patch('/api/upload-post/schedule/:jobId', (req, res) => proxyUploadPost(req, res, 'PATCH', `/api/uploadposts/schedule/${req.params.jobId}`, req.body));

// Queue settings
app.get('/api/upload-post/queue/settings', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/queue/settings'));
app.post('/api/upload-post/queue/settings', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/queue/settings', req.body));
app.get('/api/upload-post/queue/preview', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/queue/preview'));

// Analytics
app.get('/api/upload-post/analytics/:username', (req, res) => proxyUploadPost(req, res, 'GET', `/api/analytics/${req.params.username}`));
app.get('/api/upload-post/post-analytics/:requestId', (req, res) => proxyUploadPost(req, res, 'GET', `/api/uploadposts/post-analytics/${req.params.requestId}`));
app.get('/api/upload-post/impressions/:username', (req, res) => proxyUploadPost(req, res, 'GET', `/api/uploadposts/total-impressions/${req.params.username}`));

// Platform-specific helpers
app.get('/api/upload-post/facebook/pages', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/facebook/pages${qs}`);
});
app.get('/api/upload-post/linkedin/pages', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/linkedin/pages${qs}`);
});
app.get('/api/upload-post/pinterest/boards', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/pinterest/boards${qs}`);
});

// User/profile management
app.post('/api/upload-post/users', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/users', req.body));
app.get('/api/upload-post/users', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/users'));
app.delete('/api/upload-post/users', (req, res) => proxyUploadPost(req, res, 'DELETE', '/api/uploadposts/users', req.body));

// JWT token management — generates a secure URL for users to connect social accounts
app.post('/api/upload-post/users/generate-jwt', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/users/generate-jwt', req.body));
app.post('/api/upload-post/users/validate-jwt', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/users/validate-jwt', req.body));

// Account verification
app.get('/api/upload-post/me', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/me'));

// Media retrieval
app.get('/api/upload-post/media', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/media${qs}`);
});

// FFmpeg editor
app.post('/api/upload-post/ffmpeg-editor', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/ffmpeg-editor', req.body));
app.get('/api/upload-post/ffmpeg-editor/status/:jobId', (req, res) => proxyUploadPost(req, res, 'GET', `/api/uploadposts/ffmpeg-editor/status/${req.params.jobId}`));

// ── Brand Scanner (scrape website + Shopify API + multi-page crawl) ──────────
app.get('/api/scrape-brand', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000), redirect: 'follow',
    });
    if (!response.ok) return res.json({ logoUrl: '', images: [] });
    const html = await response.text();
    const base = new URL(url);
    const resolve = (src) => { if (!src) return null; try { if (src.startsWith('//')) return 'https:' + src; return new URL(src, base).href; } catch { return null; } };

    // Logo detection
    let logoSrc = '';
    for (const m of html.matchAll(/<img[^>]+>/gi)) { const tag = m[0]; if (/(?:id|class)=["'][^"']*logo[^"']*["']/i.test(tag)) { const src = tag.match(/src=["']([^"']+)["']/i)?.[1]; if (src) { logoSrc = src; break; } } }
    if (!logoSrc) logoSrc = html.match(/<a[^>]+(?:id|class)=["'][^"']*(?:logo|brand|header)[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
    if (!logoSrc) logoSrc = html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
    if (!logoSrc) logoSrc = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const logoUrl = resolve(logoSrc) || '';

    // CSS extraction
    const inlineCssBlocks = []; for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) inlineCssBlocks.push(m[1]);
    const cssLinks = []; for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) { const href = resolve(m[1]); if (href && !href.includes('fonts.googleapis.com')) cssLinks.push(href); }
    const externalCssResults = await Promise.allSettled(cssLinks.slice(0, 3).map(link => fetch(link, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.text() : '')));
    const cssText = inlineCssBlocks.join('\n') + '\n' + externalCssResults.map(r => r.status === 'fulfilled' ? r.value : '').join('\n');
    const colorSet = new Set(); for (const m of cssText.matchAll(/#[0-9a-fA-F]{6}\b/g)) colorSet.add(m[0].toLowerCase()); for (const m of cssText.matchAll(/--[\w-]+\s*:\s*(#[0-9a-fA-F]{6})\b/g)) colorSet.add(m[1].toLowerCase()); for (const m of html.matchAll(/style=["'][^"']*?(#[0-9a-fA-F]{6})[^"']*?["']/g)) colorSet.add(m[1].toLowerCase());
    const NOISE_COLORS = new Set(['#ffffff','#000000','#fffffe','#fefefe','#111111','#222222','#333333','#f5f5f5','#fafafa','#eeeeee']);
    const cssColors = Array.from(colorSet).filter(c => !NOISE_COLORS.has(c)).slice(0, 15);
    const fontSet = new Set(); const GENERIC_FONTS = new Set(['inherit','initial','unset','sans-serif','serif','monospace','cursive','fantasy','system-ui','-apple-system','blinkmacsystemfont','segoe ui','roboto','helvetica neue','helvetica','arial','verdana','tahoma','georgia','impact']);
    for (const m of cssText.matchAll(/font-family\s*:\s*([^;}\n]+)/g)) { for (const part of m[1].split(',')) { const f = part.trim().replace(/['"]/g, '').replace(/\s*!important/i, '').trim(); if (f && f.length > 1 && !GENERIC_FONTS.has(f.toLowerCase())) fontSet.add(f); } }
    const cssFonts = Array.from(fontSet).slice(0, 5);

    // Image helpers
    const IMAGE_CDN_DOMAINS = ['cdn.shopify.com','cdn2.shopify.com','res.cloudinary.com','images.ctfassets.net','images.prismic.io','cdn.sanity.io','framerusercontent.com','uploads-ssl.webflow.com','assets.website-files.com','images.squarespace-cdn.com','static1.squarespace.com','static.wixstatic.com','media.wix.com','imgix.net','media.graphassets.com','wp-content/uploads','lh3.googleusercontent.com','storage.googleapis.com','amazonaws.com'];
    const isRaster = (src) => { if (!src || src.startsWith('data:')) return false; const p = src.split('?')[0].toLowerCase(); if (p.endsWith('.svg')) return false; if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/.test(p)) return true; if (IMAGE_CDN_DOMAINS.some(cdn => src.includes(cdn))) return true; if (/\/(images?|media|assets?|photos?|uploads?|files?|img)\//i.test(p)) return true; return false; };
    const hasProductSignal = (src, altText) => { if (/\/(product|products|catalog|shop|item|items|variant|sku|collection|collections|merchandise|buy|store)\//i.test(src)) return true; if (/[-_](product|item|sku|variant|buy)/i.test(src)) return true; if (/cdn\.shopify\.com\/.*\/products\//i.test(src)) return true; if (altText && /\b(buy|price|product|bottle|jar|supplement|capsule|serum|cream|oil|powder|resin|shilajit)\b/i.test(altText)) return true; return false; };
    const isNoise = (src) => /1x1|pixel|tracking|beacon|spacer|sprite|\.ico$|\/arrow|\/chevron|\/icon[-_]|\/check|\/star[-_]|\/rating|\/logo|placeholder|loading|spinner/i.test(src) || src.length < 20;
    const addImg = (src, pSet, lSet, alt) => { if (!src || !isRaster(src) || isNoise(src)) return; if (hasProductSignal(src, alt)) pSet.add(src); else lSet.add(src); };

    const mainHtml = html.replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '');
    const productSet = new Set(); const lifestyleSet = new Set();

    // Extract images from HTML
    for (const m of mainHtml.matchAll(/<img[^>]+>/gi)) { const tag = m[0]; const alt = tag.match(/alt=["']([^"']+)["']/i)?.[1] || ''; for (const attr of ['src','data-src','data-lazy-src','data-original']) { const val = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'))?.[1]; if (val) { const s = resolve(val); if (s) addImg(s, productSet, lifestyleSet, alt); } } }
    for (const m of html.matchAll(/"(?:image|thumbnail|photo|heroImage)"\s*:\s*"(https?:\/\/[^"]+)"/gi)) { const s = resolve(m[1]); if (s) addImg(s, productSet, lifestyleSet); }

    // Shopify products.json API
    const detectedProducts = [];
    const isShopify = html.includes('Shopify') || html.includes('cdn.shopify.com');
    if (isShopify) {
      try {
        const productsUrl = new URL('/products.json?limit=20', base).href;
        console.log(`[brand-scraper] Shopify detected — fetching ${productsUrl}`);
        const shopifyRes = await fetch(productsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
        if (shopifyRes.ok) { const d = await shopifyRes.json(); for (const p of (d.products || [])) { const name = p.title || ''; const img = p.images?.[0]?.src || ''; if (name && img) { detectedProducts.push({ name, imageUrl: img }); productSet.add(img); } } console.log(`[brand-scraper] Shopify API: found ${detectedProducts.length} products`); }
      } catch (e) { console.warn('[brand-scraper] Shopify API failed:', e.message); }
    }

    // JSON-LD Product schema
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try { const ld = JSON.parse(m[1]); const items = Array.isArray(ld) ? ld : (ld['@graph'] || [ld]); for (const item of items) { if (item['@type'] === 'Product') { const name = item.name || ''; const img = Array.isArray(item.image) ? item.image[0] : (item.image || ''); const imgUrl = resolve(typeof img === 'string' ? img : (img?.url || '')); if (name && imgUrl && !detectedProducts.find(dp => dp.name === name)) { detectedProducts.push({ name, imageUrl: imgUrl }); productSet.add(imgUrl); } } } } catch {}
    }

    let productImages = Array.from(productSet).slice(0, 15);
    let lifestyleImages = Array.from(lifestyleSet).slice(0, 15);
    if (productImages.length === 0 && lifestyleImages.length > 0) { productImages = lifestyleImages.splice(0, Math.min(6, lifestyleImages.length)); }
    const images = [...productImages, ...lifestyleImages].slice(0, 30);

    console.log(`[brand-scraper] ${url} → logo:${!!logoUrl} colors:${cssColors.length} fonts:${cssFonts.length} product:${productImages.length} lifestyle:${lifestyleImages.length} named:${detectedProducts.length}`);
    res.json({ logoUrl, cssColors, cssFonts, productImages, lifestyleImages, images, detectedProducts });
  } catch (err) {
    console.error('[Scrape] Error:', err.message);
    res.json({ logoUrl: '', images: [] });
  }
});

// ── Image Proxy ──────────────────────────────────────────────────────────────
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (!response.ok) return res.status(response.status).json({ error: 'Fetch failed' });
    const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!contentType.startsWith('image/') || contentType.includes('svg')) return res.status(415).json({ error: `Unsupported: ${contentType}` });
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'Image too large' });
    res.json({ dataUrl: `data:${contentType};base64,${buf.toString('base64')}`, mimeType: contentType });
  } catch (err) { console.error('[ProxyImage]', err.message); res.status(500).json({ error: err.message }); }
});

// ── Gemini Embedding 2 Proxy ─────────────────────────────────────────────────
// Proxies embedContent requests to gemini-embedding-2-preview
// Keeps API key server-side, supports multimodal (text + image) inputs
app.post('/api/embed', async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });

    const { model, content, outputDimensionality } = req.body;
    const embedModel = model || 'gemini-embedding-2-preview';

    const requestBody = { content };
    if (outputDimensionality) {
      requestBody.outputDimensionality = outputDimensionality;
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${embedModel}:embedContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('[Embed] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Brain Memory Summarizers ────────────────────────────────────────────────
app.post('/api/gemini/summarize-style', async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });
    const { prompt } = req.body;

    const requestBody = {
      contents: [{ parts: [{ text: `Extract the visual style, lighting, and camera angle constraints from this image prompt. Respond ONLY with a comma-separated list of keywords, max 10 words. Prompt: "${prompt}"` }] }],
      generationConfig: { temperature: 0.2 }
    };

    const fetchRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const json = await fetchRes.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt.split(' ').slice(0, 5).join(', ');
    res.json({ style_summary: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/gemini/rollup-memory', async (req, res) => {
  try {
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured' });
    const { rules } = req.body;

    const requestBody = {
      contents: [{ parts: [{ text: `Here are several styling preferences a user has shown over time:\n\n${rules.join('\n')}\n\nCombine all of these into a strict, bulletproof 3-sentence Brand Style Guide that can be safely prepended to future image generation prompts. Do not use markdown or pleasantries, just the 3 sentences.` }] }],
      generationConfig: { temperature: 0.2 }
    };

    const fetchRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const json = await fetchRes.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || rules.join(', ').slice(0, 200);
    res.json({ condensed_summary: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Gemini API Proxy Endpoint (POST)
app.post('/api/gemini/*', async (req, res) => {
  try {
    const targetPath = req.path.replace('/api/gemini/', '');
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured on server' });

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetPath}?key=${apiKey}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });

    res.status(response.status);
    response.headers.forEach((val, key) => {
      // Don't forward transfer-encoding, content-encoding, or content-length 
      // as fetch already decodes the body and streaming changes lengths
      const lowerKey = key.toLowerCase();
      if (lowerKey !== 'transfer-encoding' && lowerKey !== 'content-encoding' && lowerKey !== 'content-length') {
        res.setHeader(key, val);
      }
    });

    if (response.body) {
      const { Readable } = await import('node:stream');
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Gemini API Proxy Endpoint (GET) - For operation polling
app.get('/api/gemini/*', async (req, res) => {
  try {
    const targetPath = req.path.replace('/api/gemini/', '');
    if (!apiKey) return res.status(500).json({ error: 'Gemini API key not configured on server' });

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/${targetPath}?key=${apiKey}`;
    console.log('[Server] Polling Gemini operation:', targetPath);

    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    res.status(response.status);
    response.headers.forEach((val, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== 'transfer-encoding' && lowerKey !== 'content-encoding' && lowerKey !== 'content-length') {
        res.setHeader(key, val);
      }
    });

    if (response.body) {
      const { Readable } = await import('node:stream');
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ── Kimi (Moonshot) API Proxy ──
// OpenAI-compatible API at api.moonshot.ai
app.post('/api/kimi/chat/completions', async (req, res) => {
  try {
    if (!kimiApiKey) return res.status(500).json({ error: 'Kimi API key not configured on server' });

    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${kimiApiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    res.status(response.status);
    // Forward headers (skip transfer-encoding etc.)
    response.headers.forEach((val, key) => {
      const lk = key.toLowerCase();
      if (lk !== 'transfer-encoding' && lk !== 'content-encoding' && lk !== 'content-length') {
        res.setHeader(key, val);
      }
    });

    if (response.body) {
      const { Readable } = await import('node:stream');
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error('[Kimi proxy error]', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to provide environment variables to the frontend dynamically
app.get('/api/config', (req, res) => {
  res.json({
    GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
    SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ''
  });
});

// ── Klint Sync API ──────────────────────────────────────────────────────────
// Shared state store so Chrome (browser) and Gods Eye (Electron) stay in sync.
// Both read/write to the same JSON file on disk via this API.
const SYNC_DIR = path.join(process.env.HOME || '', '.klint', 'sync');
if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });

// Helper: read/write sync file
function readSyncFile(name) {
  const fp = path.join(SYNC_DIR, `${name}.json`);
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}
function writeSyncFile(name, data) {
  const fp = path.join(SYNC_DIR, `${name}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/sync/:store — read a store (brands, calendar, gallery, videos, videoProjects)
app.get('/api/sync/:store', (req, res) => {
  try {
    const data = readSyncFile(req.params.store);
    res.json({ ok: true, data: data || [], updatedAt: data?._updatedAt || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sync/:store — write a store (full replace)
app.post('/api/sync/:store', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.data) return res.status(400).json({ ok: false, error: 'Missing data field' });
    const storeData = { ...payload, _updatedAt: new Date().toISOString(), _source: payload._source || 'unknown' };
    writeSyncFile(req.params.store, storeData);
    res.json({ ok: true, updatedAt: storeData._updatedAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/sync — list all synced stores with last update times
app.get('/api/sync', (_req, res) => {
  try {
    const files = fs.readdirSync(SYNC_DIR).filter(f => f.endsWith('.json'));
    const stores = files.map(f => {
      const name = f.replace('.json', '');
      const data = readSyncFile(name);
      return { name, updatedAt: data?._updatedAt || null, itemCount: Array.isArray(data?.data) ? data.data.length : 0 };
    });
    res.json({ ok: true, stores });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sync/all — bulk sync all stores at once (used by Gods Eye context sync)
app.post('/api/sync/all', (req, res) => {
  try {
    const { brands, calendar, gallery, videos, videoProjects } = req.body;
    const now = new Date().toISOString();
    const source = req.body._source || 'unknown';
    if (brands) writeSyncFile('brands', { data: brands, _updatedAt: now, _source: source });
    if (calendar) writeSyncFile('calendar', { data: calendar, _updatedAt: now, _source: source });
    if (gallery) writeSyncFile('gallery', { data: gallery, _updatedAt: now, _source: source });
    if (videos) writeSyncFile('videos', { data: videos, _updatedAt: now, _source: source });
    if (videoProjects) writeSyncFile('videoProjects', { data: videoProjects, _updatedAt: now, _source: source });
    res.json({ ok: true, updatedAt: now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Local Bridge HTTP Proxy ───────────────────────────────────────────────────
// Forward /bridge/* HTTP requests (health, available-models, mcp/*) to bridge
app.use('/bridge', createProxyMiddleware({
  target: BRIDGE_TARGET,
  changeOrigin: true,
  pathRewrite: { '^/bridge': '' },
  logLevel: 'warn',
  on: {
    error: (err, req, res) => {
      console.warn('[Bridge Proxy] Bridge server unreachable:', err.message);
      if (res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Local bridge server not running. Run: node local-bridge-server.cjs' }));
      }
    },
  },
}));

// ── Native Cron Scheduler ────────────────────────────────────────────────────
// Register cron API routes and load scheduled jobs from Supabase
registerCronRoutes(app);
loadAndScheduleAll().catch(err => console.error('[Cron] Startup error:', err.message));

// Serve static files from the dist directory, but DON'T serve index.html automatically
// This forces index.html requests to fall through to our custom injector below.
app.use(express.static(path.join(__dirname, 'dist'), { index: false }));

// Handle SPA routing: serve index.html with injected configuration
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');

  // If the file doesn't exist (e.g. during dev or partial build), just send 404
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Not Found');
  }

  // Read index.html and inject the configuration
  let html = fs.readFileSync(indexPath, 'utf8');

  const config = {
    VITE_GEMINI_API_KEY: process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || ''
  };

  console.log('[Server] Injected Config Summary:', {
    hasGemini: !!config.VITE_GEMINI_API_KEY,
    hasSupabase: !!config.VITE_SUPABASE_URL,
    supabasePrefix: config.VITE_SUPABASE_URL?.substring(0, 10),
    envKeys: Object.keys(process.env).filter(k => k.startsWith('VITE_') || k.includes('GEMINI'))
  });

  const configScript = `
    <script>
      window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};
    </script>
  `;

  // Inject before the closing </head> or at the placeholder
  if (html.includes('<!-- RUNTIME_CONFIG -->')) {
    html = html.replace('<!-- RUNTIME_CONFIG -->', configScript);
  } else {
    html = html.replace('</head>', `${configScript}</head>`);
  }

  res.send(html);
});

// ── Create HTTP server with WebSocket upgrade for bridge ──────────────────────
const server = createServer(app);

// WebSocket upgrade proxy for /bridge path
const bridgeWsProxy = createProxyMiddleware({
  target: BRIDGE_TARGET,
  ws: true,
  changeOrigin: true,
  pathRewrite: { '^/bridge': '' },
  logLevel: 'warn',
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/bridge' || req.url?.startsWith('/bridge')) {
    bridgeWsProxy.upgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Gemini API key configured: ${!!apiKey}`);
  console.log(`Bridge proxy target: ${BRIDGE_TARGET}`);
});

