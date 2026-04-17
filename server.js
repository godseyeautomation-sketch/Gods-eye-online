import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';
import dotenv from 'dotenv';
import { registerCronRoutes, loadAndScheduleAll } from './services/cronEngine.js';
import { mountMcpEndpoints } from './services/mcpServer.js';
import { executeScout } from './services/scoutAgent.js';
import { executePriya } from './services/priyaAgent.js';
import { executeReview, handleSlackAction, getReviewStatus } from './services/reviewAgent.js';
import { executeDispatch } from './services/dispatchAgent.js';
import { executeKarma } from './services/karmaAgent.js';
import {
  approveItem, rejectItem, getApprovalQueue, bulkApprove,
  getPipelineRuns, getPipelineStageLogs, distillPerformanceSignals,
  runSingleAgent,
} from './services/pipelineOrchestrator.js';

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

// ── Autopilot Pipeline & Approval Queue Routes ─────────────────────────────
// Approval Queue (local sync file based)
app.get('/api/approval-queue', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.user_id;
    const brandId = req.query.brand_id;
    const status = req.query.status || 'pending';

    const queueFile = readSyncFile('approval_queue');
    let items = queueFile?.data || [];

    if (brandId) items = items.filter(i => i.brand_id === brandId);
    if (status && status !== 'all') items = items.filter(i => i.status === status);

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ ok: true, items: items.slice(0, 50) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/approval-queue/:id/approve', (req, res) => {
  try {
    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Item not found' });

    items[idx].status = 'approved';
    items[idx].resolved_at = new Date().toISOString();
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });

    // Also update the content slot status
    const slotsFile = readSyncFile('content_slots');
    const slots = slotsFile?.data || [];
    const slotIdx = slots.findIndex(s => s.id === items[idx].slot_id);
    if (slotIdx >= 0) {
      slots[slotIdx].status = 'approved';
      slots[slotIdx].approved = true;
      slots[slotIdx].generated_image = items[idx].generated_image || slots[slotIdx].generated_image;
      slots[slotIdx].updated_at = new Date().toISOString();
      writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
    }

    res.json({ ok: true, approved: items[idx].slot_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/approval-queue/:id/reject', (req, res) => {
  try {
    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Item not found' });

    items[idx].status = 'rejected';
    items[idx].reviewer_notes = req.body?.reason || '';
    items[idx].resolved_at = new Date().toISOString();
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });

    res.json({ ok: true, rejected: items[idx].slot_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/approval-queue/bulk-approve', (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ error: 'ids[] required' });

    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const slotsFile = readSyncFile('content_slots');
    const slots = slotsFile?.data || [];

    const results = [];
    for (const id of ids) {
      const idx = items.findIndex(i => i.id === id);
      if (idx >= 0) {
        items[idx].status = 'approved';
        items[idx].resolved_at = new Date().toISOString();
        const slotIdx = slots.findIndex(s => s.id === items[idx].slot_id);
        if (slotIdx >= 0) {
          slots[slotIdx].status = 'approved';
          slots[slotIdx].approved = true;
          slots[slotIdx].generated_image = items[idx].generated_image || slots[slotIdx].generated_image;
          slots[slotIdx].updated_at = new Date().toISOString();
        }
        results.push({ id, success: true });
      }
    }

    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });
    writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });

    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pipeline Runs
app.get('/api/pipeline/runs', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const runs = await getPipelineRuns(userId, { brandId: req.query.brand_id, limit: parseInt(req.query.limit) || 10 });
    res.json({ ok: true, runs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pipeline/runs/:runId/stages', async (req, res) => {
  try {
    const logs = await getPipelineStageLogs(req.params.runId);
    res.json({ ok: true, stages: logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pipeline/distill-signals', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const { brand_id } = req.body;
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });
    const signals = await distillPerformanceSignals(userId, brand_id);
    res.json({ ok: true, signals });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Run individual agent (matching dev-server.js)
app.post('/api/pipeline/run-agent', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.user_id;
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const { agent_id, brand_id, brand, config } = req.body;
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });
    if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

    console.log(`[Pipeline] Running agent: ${agent_id} for brand ${brand_id} (brand payload: ${brand ? 'yes' : 'no'})`);

    // If frontend sent the brand directly, persist it to sync file NOW
    if (brand && brand.id) {
      try {
        const brandsFile = path.join(SYNC_DIR, 'brand_profiles.json');
        let syncData = { _updatedAt: new Date().toISOString(), data: [] };
        if (fs.existsSync(brandsFile)) {
          try {
            const existing = JSON.parse(fs.readFileSync(brandsFile, 'utf-8'));
            syncData = Array.isArray(existing?.data) ? existing : { _updatedAt: new Date().toISOString(), data: Array.isArray(existing) ? existing : [] };
          } catch {}
        }
        const idx = syncData.data.findIndex(b => b.id === brand.id);
        const merged = { ...(idx >= 0 ? syncData.data[idx] : {}), ...brand, user_id: brand.user_id || userId, updated_at: new Date().toISOString() };
        if (idx >= 0) syncData.data[idx] = merged;
        else syncData.data.push(merged);
        syncData._updatedAt = new Date().toISOString();
        fs.writeFileSync(brandsFile, JSON.stringify(syncData, null, 2), 'utf-8');
        console.log(`[Pipeline] Synced brand "${brand.name}" to local file`);
      } catch (e) {
        console.warn('[Pipeline] Brand sync failed:', e.message);
      }
    }

    if (agent_id === 'scout') {
      const result = await executeScout(userId, brand_id, config || {});
      res.json({ ok: true, text: `Scout completed: ${result.filename}`, result });
    } else if (agent_id === 'creative' || agent_id === 'priya') {
      const result = await executePriya(userId, brand_id, config || {});
      res.json({ ok: true, text: `Priya created ${result.slots_created}/${result.slots_total} slots`, result });
    } else if (agent_id === 'reviewer' || agent_id === 'review') {
      const result = await executeReview(userId, brand_id, config || {});
      res.json({ ok: true, text: `Review: ${result.decision}`, result });
    } else if (agent_id === 'dispatcher' || agent_id === 'dispatch') {
      const result = await executeDispatch(userId, brand_id, config || {});
      res.json({ ok: true, text: `Published ${result.published_count} posts`, result });
    } else if (agent_id === 'analyst' || agent_id === 'karma') {
      const result = await executeKarma(userId, brand_id, config || {});
      res.json({ ok: true, text: `Analytics: ${result.insights_count} insights`, result });
    } else {
      res.json({ ok: true, text: `Unknown agent ${agent_id}` });
    }
  } catch (err) {
    console.error(`[Pipeline] Agent error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Review status polling
app.get('/api/pipeline/review-status/:reviewId', (req, res) => {
  const status = getReviewStatus(req.params.reviewId);
  res.json({ ok: true, ...status });
});

// Download scout report
app.get('/api/pipeline/scout-report/:filename', (req, res) => {
  try {
    const docsDir = path.join(process.env.HOME || '', '.klint', 'scout-reports');
    const filepath = path.join(docsDir, req.params.filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Report not found' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.sendFile(filepath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve Scout's report — unlocks Priya
app.patch('/api/pipeline/scout/approve', (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const { brand_id } = req.body;
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });

    const syncData = readSyncFile('brand_profiles');
    const isWrapped = !!(syncData && !Array.isArray(syncData) && Array.isArray(syncData.data));
    const allBrands = isWrapped ? syncData.data : (Array.isArray(syncData) ? syncData : []);
    const idx = allBrands.findIndex(b => b.id === brand_id);
    if (idx < 0) return res.status(404).json({ error: 'Brand not found' });
    if (!allBrands[idx].scout_report) return res.status(400).json({ error: 'No scout report on this brand' });

    const approvedAt = new Date().toISOString();
    allBrands[idx] = {
      ...allBrands[idx],
      scout_report: {
        ...allBrands[idx].scout_report,
        awaiting_approval: false,
        approved_at: approvedAt,
      },
      updated_at: approvedAt,
    };
    const updatedSync = isWrapped ? { ...syncData, data: allBrands, _updatedAt: approvedAt } : allBrands;
    writeSyncFile('brand_profiles', updatedSync);
    res.json({ ok: true, approved_at: approvedAt });
  } catch (err) {
    console.error('[Scout approve] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Priya's progress (per-brand)
app.get('/api/pipeline/priya-progress/:brandId', (req, res) => {
  const data = readSyncFile(`priya_progress_${req.params.brandId}`);
  if (!data) return res.json({ ok: true, progress: null });
  res.json({ ok: true, progress: data?.data || data });
});

// Slack interactions webhook
app.post('/api/slack/interactions', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload || '{}');
    console.log(`[Slack] Button click from @${payload.user?.username || '?'}`);
    handleSlackAction(payload);
    res.status(200).send('');
  } catch (err) {
    console.error('[Slack] Interaction error:', err.message);
    res.status(200).send('');
  }
});

console.log('[Pipeline] 🤖 Autopilot & approval queue routes registered');



const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// In-memory cron tasks keyed by job ID


// Helper: call Supabase REST API
async function supabaseRest(tablePath, method = 'GET', body = null, extraHeaders = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  const url = `${SUPABASE_URL}/rest/v1/${tablePath}`;
  const opts = {
    method,
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
      ...extraHeaders,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${method} ${tablePath}: ${res.status} ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('json')) return res.json();
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// CONNECTORS — Native OAuth connector system for 3rd party apps
// Stores tokens per-user in Supabase. Direct API wrappers (no MCP subprocess).
// ═══════════════════════════════════════════════════════════════════════

const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:3001`;

const CONNECTOR_PLATFORMS = {
  gmail: {
    name: 'Gmail', auth_type: 'oauth', icon: 'mail',
    description: 'Read, search, and send emails',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientIdEnv: 'GOOGLE_CLIENT_ID', clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  google_drive: {
    name: 'Google Drive', auth_type: 'oauth', icon: 'hard-drive',
    description: 'Search and read files from Drive',
    scopes: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/userinfo.email'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientIdEnv: 'GOOGLE_CLIENT_ID', clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  slack: {
    name: 'Slack', auth_type: 'oauth', icon: 'message-square',
    description: 'Send messages and read channels',
    scopes: ['channels:read', 'chat:write', 'users:read', 'search:read'],
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    profileUrl: null,
    clientIdEnv: 'SLACK_CLIENT_ID', clientSecretEnv: 'SLACK_CLIENT_SECRET',
    scopeJoin: ',',
  },
  github: {
    name: 'GitHub', auth_type: 'oauth', icon: 'github',
    description: 'Repos, issues, and pull requests',
    scopes: ['repo', 'read:user'],
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    profileUrl: 'https://api.github.com/user',
    clientIdEnv: 'GITHUB_CLIENT_ID', clientSecretEnv: 'GITHUB_CLIENT_SECRET',
  },
  notion: {
    name: 'Notion', auth_type: 'oauth', icon: 'file-text',
    description: 'Search, read, and create pages',
    scopes: [],
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    profileUrl: null,
    clientIdEnv: 'NOTION_CLIENT_ID', clientSecretEnv: 'NOTION_CLIENT_SECRET',
    authIsBasic: true,
    ownerField: 'owner',
  },
  brave_search: {
    name: 'Brave Search', auth_type: 'api_key', icon: 'search',
    description: 'Web search via Brave API',
  },
  google_maps: {
    name: 'Google Maps', auth_type: 'api_key', icon: 'map-pin',
    description: 'Places, directions, geocoding',
  },
  google_ads: {
    name: 'Google Ads', auth_type: 'oauth', icon: 'megaphone',
    description: 'Manage campaigns, view analytics, push ad creatives',
    scopes: ['https://www.googleapis.com/auth/adwords'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    clientIdEnv: 'GOOGLE_ADS_CLIENT_ID', clientSecretEnv: 'GOOGLE_ADS_CLIENT_SECRET',
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
  },
  meta_ads: {
    name: 'Meta Ads', auth_type: 'oauth', icon: 'target',
    description: 'Manage Facebook & Instagram ad campaigns',
    scopes: ['ads_management', 'ads_read', 'business_management'],
    authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    profileUrl: 'https://graph.facebook.com/v19.0/me',
    clientIdEnv: 'META_ADS_APP_ID', clientSecretEnv: 'META_ADS_APP_SECRET',
    extraAuthParams: {},
  },
};

// Helper: get OAuth client credentials from env
function getOAuthCreds(platform) {
  const cfg = CONNECTOR_PLATFORMS[platform];
  if (!cfg || cfg.auth_type !== 'oauth') return null;
  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// Helper: get a valid token, refreshing if expired
async function getValidToken(userId, platform) {
  const rows = await supabaseRest(
    `user_connectors?user_id=eq.${userId}&platform=eq.${platform}&select=*`
  );
  const connector = rows?.[0];
  if (!connector) throw new Error(`${platform} not connected`);
  if (!connector.enabled) throw new Error(`${platform} connector is disabled`);

  if (connector.auth_type === 'api_key') return { token: connector.api_key, type: 'api_key' };

  // Check if token is expired
  if (connector.token_expires_at && new Date(connector.token_expires_at) < new Date()) {
    const cfg = CONNECTOR_PLATFORMS[platform];
    const creds = getOAuthCreds(platform);
    if (!creds || !connector.refresh_token) throw new Error(`Cannot refresh ${platform} token — reconnect required`);

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connector.refresh_token,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) throw new Error(`Token refresh failed: ${tokenData.error_description || tokenData.error}`);

    await supabaseRest(`user_connectors?id=eq.${connector.id}`, 'PATCH', {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || connector.refresh_token,
      token_expires_at: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
        : connector.token_expires_at,
      updated_at: new Date().toISOString(),
    });

    return { token: tokenData.access_token, type: 'oauth' };
  }

  return { token: connector.access_token, type: 'oauth' };
}

// ── Connector API Routes ─────────────────────────────────────────────────

// List available platforms (public — no auth needed)
app.get('/api/connectors/platforms', (req, res) => {
  const platforms = Object.entries(CONNECTOR_PLATFORMS).map(([key, cfg]) => ({
    key,
    name: cfg.name,
    auth_type: cfg.auth_type,
    icon: cfg.icon,
    description: cfg.description,
    configured: cfg.auth_type !== 'oauth' || !!getOAuthCreds(key),
  }));
  res.json(platforms);
});

// List user's connected connectors
app.get('/api/connectors/list', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  try {
    const rows = await supabaseRest(
      `user_connectors?user_id=eq.${userId}&select=id,platform,auth_type,account_info,scopes,enabled,created_at,updated_at`
    );
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get OAuth authorization URL
app.get('/api/connectors/auth/:platform/url', (req, res) => {
  const { platform } = req.params;
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });

  const cfg = CONNECTOR_PLATFORMS[platform];
  if (!cfg || cfg.auth_type !== 'oauth') return res.status(400).json({ error: `OAuth not available for ${platform}` });

  const creds = getOAuthCreds(platform);
  if (!creds) return res.status(400).json({ error: `${cfg.clientIdEnv} not configured on server` });

  const state = Buffer.from(JSON.stringify({ user_id: userId, platform })).toString('base64url');
  const redirectUri = `${APP_BASE_URL.replace(':3001', ':3002')}/api/connectors/auth/callback`;
  const scopeStr = cfg.scopeJoin
    ? cfg.scopes.join(cfg.scopeJoin)
    : cfg.scopes.join(' ');

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    ...(scopeStr ? { scope: scopeStr } : {}),
    ...(cfg.extraAuthParams || {}),
  });

  // Notion uses 'owner' param instead of scope
  if (platform === 'notion') {
    params.set('owner', 'user');
  }

  const url = `${cfg.authUrl}?${params.toString()}`;
  res.json({ ok: true, url });
});

// Universal OAuth callback
app.get('/api/connectors/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`${APP_BASE_URL}/?connectorCallback=error&message=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return res.redirect(`${APP_BASE_URL}/?connectorCallback=error&message=missing_code`);
  }

  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return res.redirect(`${APP_BASE_URL}/?connectorCallback=error&message=invalid_state`);
  }

  const { user_id, platform } = stateData;
  const cfg = CONNECTOR_PLATFORMS[platform];
  const creds = getOAuthCreds(platform);
  if (!cfg || !creds) {
    return res.redirect(`${APP_BASE_URL}/?connectorCallback=error&message=unknown_platform`);
  }

  try {
    const redirectUri = `${APP_BASE_URL.replace(':3001', ':3002')}/api/connectors/auth/callback`;

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    });

    const tokenHeaders = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };

    // Notion uses Basic auth for token exchange
    if (cfg.authIsBasic) {
      const basicAuth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
      tokenHeaders['Authorization'] = `Basic ${basicAuth}`;
      tokenBody.delete('client_id');
      tokenBody.delete('client_secret');
    }

    const tokenRes = await fetch(cfg.tokenUrl, { method: 'POST', headers: tokenHeaders, body: tokenBody });
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      console.error(`[Connectors] Token exchange failed for ${platform}:`, tokenData);
      return res.redirect(`${APP_BASE_URL}/?connectorCallback=${platform}&status=error&message=${encodeURIComponent(tokenData.error_description || tokenData.error)}`);
    }

    // Extract tokens — Slack has a different structure
    let accessToken, refreshToken, expiresIn, scopes;
    if (platform === 'slack') {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
      scopes = (tokenData.scope || '').split(',');
    } else if (platform === 'notion') {
      accessToken = tokenData.access_token;
      scopes = [];
    } else {
      accessToken = tokenData.access_token;
      refreshToken = tokenData.refresh_token;
      expiresIn = tokenData.expires_in;
      scopes = (tokenData.scope || '').split(' ').filter(Boolean);
    }

    // Fetch user profile info
    let accountInfo = {};
    try {
      if (platform === 'slack') {
        const identityRes = await fetch('https://slack.com/api/auth.test', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const identity = await identityRes.json();
        accountInfo = { team: identity.team, user: identity.user, team_id: identity.team_id };
      } else if (platform === 'notion') {
        const owner = tokenData.owner;
        accountInfo = { workspace_name: tokenData.workspace_name, workspace_id: tokenData.workspace_id, owner };
      } else if (platform === 'google_ads') {
        // Fetch profile + accessible customer IDs
        const profileRes = await fetch(cfg.profileUrl, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        accountInfo = await profileRes.json();
        try {
          const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
          const custRes = await fetch('https://googleads.googleapis.com/v17/customers:listAccessibleCustomers', {
            headers: { Authorization: `Bearer ${accessToken}`, 'developer-token': devToken },
          });
          const custData = await custRes.json();
          accountInfo.customer_ids = (custData.resourceNames || []).map(n => n.replace('customers/', ''));
        } catch (e) { console.warn('[Connectors] Google Ads customer fetch failed:', e.message); }
      } else if (platform === 'meta_ads') {
        // Fetch profile + ad accounts
        const profileRes = await fetch(`${cfg.profileUrl}?fields=id,name,email&access_token=${accessToken}`);
        accountInfo = await profileRes.json();
        try {
          const acctRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`);
          const acctData = await acctRes.json();
          accountInfo.ad_accounts = (acctData.data || []).map(a => ({ id: a.id, name: a.name, status: a.account_status }));
        } catch (e) { console.warn('[Connectors] Meta ad accounts fetch failed:', e.message); }
      } else if (cfg.profileUrl) {
        const profileRes = await fetch(cfg.profileUrl, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'GodsEye/1.0' },
        });
        accountInfo = await profileRes.json();
      }
    } catch (err) {
      console.warn(`[Connectors] Profile fetch failed for ${platform}:`, err.message);
    }

    // Upsert into Supabase
    // Try update first, then insert
    const existing = await supabaseRest(
      `user_connectors?user_id=eq.${user_id}&platform=eq.${platform}&select=id`
    );

    const connectorData = {
      user_id,
      platform,
      auth_type: 'oauth',
      access_token: accessToken,
      refresh_token: refreshToken || null,
      token_expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      account_info: accountInfo,
      scopes: scopes || [],
      enabled: true,
      updated_at: new Date().toISOString(),
    };

    if (existing?.length > 0) {
      await supabaseRest(`user_connectors?id=eq.${existing[0].id}`, 'PATCH', connectorData);
    } else {
      connectorData.created_at = new Date().toISOString();
      await supabaseRest('user_connectors', 'POST', connectorData);
    }

    console.log(`[Connectors] ✅ ${platform} connected for user ${user_id}`);
    res.redirect(`${APP_BASE_URL}/?connectorCallback=${platform}&status=success`);
  } catch (err) {
    console.error(`[Connectors] OAuth callback error for ${platform}:`, err);
    res.redirect(`${APP_BASE_URL}/?connectorCallback=${platform}&status=error&message=${encodeURIComponent(err.message)}`);
  }
});

// Save API key connector
app.post('/api/connectors/api-key', async (req, res) => {
  const { user_id, platform, api_key } = req.body;
  if (!user_id || !platform || !api_key) return res.status(400).json({ error: 'user_id, platform, api_key required' });

  const cfg = CONNECTOR_PLATFORMS[platform];
  if (!cfg || cfg.auth_type !== 'api_key') return res.status(400).json({ error: `${platform} does not use API keys` });

  try {
    // Validate the key with a test call
    if (platform === 'brave_search') {
      const testRes = await fetch(`https://api.search.brave.com/res/v1/web/search?q=test&count=1`, {
        headers: { 'X-Subscription-Token': api_key, Accept: 'application/json' },
      });
      if (!testRes.ok) return res.status(400).json({ error: 'Invalid Brave API key' });
    } else if (platform === 'google_maps') {
      const testRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${api_key}`);
      const testData = await testRes.json();
      if (testData.error_message) return res.status(400).json({ error: `Invalid Google Maps key: ${testData.error_message}` });
    }

    const existing = await supabaseRest(
      `user_connectors?user_id=eq.${user_id}&platform=eq.${platform}&select=id`
    );

    const data = {
      user_id, platform, auth_type: 'api_key', api_key, enabled: true,
      account_info: { type: 'api_key' },
      updated_at: new Date().toISOString(),
    };

    if (existing?.length > 0) {
      await supabaseRest(`user_connectors?id=eq.${existing[0].id}`, 'PATCH', data);
    } else {
      data.created_at = new Date().toISOString();
      await supabaseRest('user_connectors', 'POST', data);
    }

    res.json({ success: true, platform });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect a connector
app.delete('/api/connectors/:platform', async (req, res) => {
  const { platform } = req.params;
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  try {
    await supabaseRest(`user_connectors?user_id=eq.${userId}&platform=eq.${platform}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle connector enabled/disabled
app.post('/api/connectors/:platform/toggle', async (req, res) => {
  const { platform } = req.params;
  const { user_id, enabled } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    await supabaseRest(
      `user_connectors?user_id=eq.${user_id}&platform=eq.${platform}`,
      'PATCH',
      { enabled: !!enabled, updated_at: new Date().toISOString() }
    );
    res.json({ success: true, enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connector Tool Declarations (for Gemini) ────────────────────────────

const CONNECTOR_TOOL_DEFS = {
  gmail: [
    { name: 'connector_gmail_search', description: 'Search Gmail inbox for emails matching a query', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query (e.g. "from:john subject:invoice")' }, max_results: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
    { name: 'connector_gmail_read', description: 'Read a specific Gmail email by ID', parameters: { type: 'object', properties: { message_id: { type: 'string', description: 'Gmail message ID' } }, required: ['message_id'] } },
    { name: 'connector_gmail_send', description: 'Send an email via Gmail', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email' }, subject: { type: 'string', description: 'Email subject' }, body: { type: 'string', description: 'Email body (plain text or HTML)' } }, required: ['to', 'subject', 'body'] } },
    { name: 'connector_gmail_labels', description: 'List Gmail labels/folders', parameters: { type: 'object', properties: {} } },
  ],
  google_drive: [
    { name: 'connector_drive_search', description: 'Search Google Drive for files', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, max_results: { type: 'number', description: 'Max results (default 10)' } }, required: ['query'] } },
    { name: 'connector_drive_read', description: 'Read a Google Drive file content', parameters: { type: 'object', properties: { file_id: { type: 'string', description: 'Drive file ID' } }, required: ['file_id'] } },
  ],
  slack: [
    { name: 'connector_slack_send', description: 'Send a message to a Slack channel', parameters: { type: 'object', properties: { channel: { type: 'string', description: 'Channel name or ID' }, text: { type: 'string', description: 'Message text' } }, required: ['channel', 'text'] } },
    { name: 'connector_slack_channels', description: 'List Slack channels', parameters: { type: 'object', properties: {} } },
    { name: 'connector_slack_search', description: 'Search Slack messages', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
  ],
  github: [
    { name: 'connector_github_repos', description: 'List GitHub repositories', parameters: { type: 'object', properties: { sort: { type: 'string', description: 'Sort by: updated, created, pushed (default updated)' } } } },
    { name: 'connector_github_issues', description: 'List issues for a GitHub repository', parameters: { type: 'object', properties: { repo: { type: 'string', description: 'Full repo name (owner/repo)' }, state: { type: 'string', description: 'open, closed, or all (default open)' } }, required: ['repo'] } },
    { name: 'connector_github_create_issue', description: 'Create a GitHub issue', parameters: { type: 'object', properties: { repo: { type: 'string', description: 'Full repo name (owner/repo)' }, title: { type: 'string', description: 'Issue title' }, body: { type: 'string', description: 'Issue body (markdown)' } }, required: ['repo', 'title'] } },
    { name: 'connector_github_prs', description: 'List pull requests for a GitHub repository', parameters: { type: 'object', properties: { repo: { type: 'string', description: 'Full repo name (owner/repo)' }, state: { type: 'string', description: 'open, closed, or all (default open)' } }, required: ['repo'] } },
  ],
  notion: [
    { name: 'connector_notion_search', description: 'Search Notion pages and databases', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
    { name: 'connector_notion_read', description: 'Read a Notion page content', parameters: { type: 'object', properties: { page_id: { type: 'string', description: 'Notion page ID' } }, required: ['page_id'] } },
    { name: 'connector_notion_create', description: 'Create a new Notion page', parameters: { type: 'object', properties: { parent_id: { type: 'string', description: 'Parent page or database ID' }, title: { type: 'string', description: 'Page title' }, content: { type: 'string', description: 'Page content (plain text)' } }, required: ['parent_id', 'title'] } },
  ],
  brave_search: [
    { name: 'connector_brave_search', description: 'Search the web using Brave Search', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, count: { type: 'number', description: 'Number of results (default 5)' } }, required: ['query'] } },
  ],
  google_maps: [
    { name: 'connector_maps_search', description: 'Search for places on Google Maps', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Place search query' } }, required: ['query'] } },
    { name: 'connector_maps_directions', description: 'Get directions between two locations', parameters: { type: 'object', properties: { origin: { type: 'string', description: 'Starting location' }, destination: { type: 'string', description: 'Destination location' }, mode: { type: 'string', description: 'driving, walking, bicycling, transit (default driving)' } }, required: ['origin', 'destination'] } },
  ],
  google_ads: [
    { name: 'connector_google_ads_list_campaigns', description: 'List all Google Ads campaigns with status and budget', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID (optional, uses default)' } } } },
    { name: 'connector_google_ads_campaign_metrics', description: 'Get performance metrics for a Google Ads campaign (impressions, clicks, CTR, CPC, spend, conversions, ROAS)', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, campaign_id: { type: 'string', description: 'Campaign ID' }, date_range: { type: 'string', description: 'LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH, LAST_MONTH (default LAST_30_DAYS)' } }, required: ['campaign_id'] } },
    { name: 'connector_google_ads_account_metrics', description: 'Get account-level aggregate metrics for Google Ads', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, date_range: { type: 'string', description: 'LAST_7_DAYS, LAST_30_DAYS, THIS_MONTH (default LAST_30_DAYS)' } } } },
    { name: 'connector_google_ads_create_campaign', description: 'Create a new Google Ads campaign', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, name: { type: 'string', description: 'Campaign name' }, budget_micros: { type: 'number', description: 'Daily budget in micros (1 dollar = 1000000 micros)' }, campaign_type: { type: 'string', description: 'SEARCH, DISPLAY, VIDEO, SHOPPING (default SEARCH)' } }, required: ['name', 'budget_micros'] } },
    { name: 'connector_google_ads_update_campaign', description: 'Update a Google Ads campaign (pause, resume, change budget)', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, campaign_id: { type: 'string', description: 'Campaign ID' }, status: { type: 'string', description: 'ENABLED or PAUSED' }, budget_micros: { type: 'number', description: 'New daily budget in micros' } }, required: ['campaign_id'] } },
    { name: 'connector_google_ads_upload_asset', description: 'Upload an image asset to Google Ads for use in ad creatives', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, image_url: { type: 'string', description: 'URL of the image to upload' }, asset_name: { type: 'string', description: 'Name for the asset' } }, required: ['image_url', 'asset_name'] } },
    { name: 'connector_google_ads_keyword_ideas', description: 'Get keyword suggestions with search volume and competition data', parameters: { type: 'object', properties: { customer_id: { type: 'string', description: 'Google Ads customer ID' }, keywords: { type: 'string', description: 'Seed keywords (comma-separated)' }, language: { type: 'string', description: 'Language code (default en)' } }, required: ['keywords'] } },
  ],
  meta_ads: [
    { name: 'connector_meta_ads_list_campaigns', description: 'List all Meta (Facebook/Instagram) ad campaigns', parameters: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID (optional, uses default)' } } } },
    { name: 'connector_meta_ads_campaign_insights', description: 'Get performance insights for a Meta Ads campaign (impressions, reach, clicks, spend, CTR, CPC, ROAS)', parameters: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' }, date_preset: { type: 'string', description: 'last_7d, last_30d, this_month, last_month (default last_30d)' } }, required: ['campaign_id'] } },
    { name: 'connector_meta_ads_account_insights', description: 'Get account-level aggregate insights for Meta Ads', parameters: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, date_preset: { type: 'string', description: 'last_7d, last_30d, this_month (default last_30d)' } } } },
    { name: 'connector_meta_ads_create_campaign', description: 'Create a new Meta Ads campaign', parameters: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, name: { type: 'string', description: 'Campaign name' }, objective: { type: 'string', description: 'OUTCOME_AWARENESS, OUTCOME_TRAFFIC, OUTCOME_ENGAGEMENT, OUTCOME_SALES (default OUTCOME_TRAFFIC)' }, daily_budget: { type: 'number', description: 'Daily budget in cents' }, status: { type: 'string', description: 'ACTIVE or PAUSED (default PAUSED)' } }, required: ['name', 'daily_budget'] } },
    { name: 'connector_meta_ads_update_campaign', description: 'Update a Meta Ads campaign', parameters: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' }, name: { type: 'string', description: 'New name' }, status: { type: 'string', description: 'ACTIVE or PAUSED' }, daily_budget: { type: 'number', description: 'New daily budget in cents' } }, required: ['campaign_id'] } },
    { name: 'connector_meta_ads_upload_creative', description: 'Upload an ad image to Meta Ads', parameters: { type: 'object', properties: { ad_account_id: { type: 'string', description: 'Ad account ID' }, image_url: { type: 'string', description: 'URL of the image to upload' }, name: { type: 'string', description: 'Creative name' } }, required: ['image_url', 'name'] } },
    { name: 'connector_meta_ads_list_adsets', description: 'List ad sets under a Meta Ads campaign', parameters: { type: 'object', properties: { campaign_id: { type: 'string', description: 'Campaign ID' } }, required: ['campaign_id'] } },
  ],
};

// Get tool declarations for a user's connected platforms
app.get('/api/connectors/tools', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.json({ declarations: [] });
  try {
    const connectors = await supabaseRest(
      `user_connectors?user_id=eq.${userId}&enabled=eq.true&select=platform`
    );
    const declarations = [];
    for (const c of (connectors || [])) {
      const tools = CONNECTOR_TOOL_DEFS[c.platform];
      if (tools) declarations.push(...tools);
    }
    res.json({ declarations });
  } catch {
    res.json({ declarations: [] });
  }
});

// ── Connector Tool Execution ─────────────────────────────────────────────

async function executeConnectorTool(userId, toolName, args) {
  // Parse platform from tool name: connector_{platform}_{action}
  const parts = toolName.replace('connector_', '').split('_');

  // Gmail tools
  if (toolName === 'connector_gmail_search') {
    const { token } = await getValidToken(userId, 'gmail');
    const q = encodeURIComponent(args.query || '');
    const max = args.max_results || 10;
    const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=${max}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    if (!listData.messages?.length) return { results: [], message: 'No emails found' };
    // Fetch snippets for each message
    const emails = await Promise.all(
      listData.messages.slice(0, max).map(async (m) => {
        const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const msg = await msgRes.json();
        const headers = {};
        (msg.payload?.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
        return { id: m.id, from: headers.from, subject: headers.subject, date: headers.date, snippet: msg.snippet };
      })
    );
    return { results: emails, count: emails.length };
  }

  if (toolName === 'connector_gmail_read') {
    const { token } = await getValidToken(userId, 'gmail');
    const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${args.message_id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const msg = await msgRes.json();
    const headers = {};
    (msg.payload?.headers || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
    // Extract body text
    let body = '';
    const extractText = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      if (part.parts) part.parts.forEach(extractText);
    };
    if (msg.payload) extractText(msg.payload);
    return { id: msg.id, from: headers.from, to: headers.to, subject: headers.subject, date: headers.date, body: body.substring(0, 5000) };
  }

  if (toolName === 'connector_gmail_send') {
    const { token } = await getValidToken(userId, 'gmail');
    const email = [
      `To: ${args.to}`,
      `Subject: ${args.subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      args.body,
    ].join('\r\n');
    const raw = Buffer.from(email).toString('base64url');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const result = await sendRes.json();
    return { success: !result.error, messageId: result.id, error: result.error?.message };
  }

  if (toolName === 'connector_gmail_labels') {
    const { token } = await getValidToken(userId, 'gmail');
    const labelsRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await labelsRes.json();
    return { labels: (data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type })) };
  }

  // Google Drive tools
  if (toolName === 'connector_drive_search') {
    const { token } = await getValidToken(userId, 'google_drive');
    const q = encodeURIComponent(args.query || '');
    const max = args.max_results || 10;
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name+contains+'${q}'&pageSize=${max}&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await driveRes.json();
    return { files: data.files || [], count: (data.files || []).length };
  }

  if (toolName === 'connector_drive_read') {
    const { token } = await getValidToken(userId, 'google_drive');
    // Get file metadata first
    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${args.file_id}?fields=name,mimeType`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meta = await metaRes.json();
    // Export Google Docs as text, download others
    let content;
    if (meta.mimeType?.startsWith('application/vnd.google-apps')) {
      const exportRes = await fetch(`https://www.googleapis.com/drive/v3/files/${args.file_id}/export?mimeType=text/plain`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      content = await exportRes.text();
    } else {
      const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${args.file_id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      content = await dlRes.text();
    }
    return { name: meta.name, mimeType: meta.mimeType, content: content.substring(0, 10000) };
  }

  // Slack tools
  if (toolName === 'connector_slack_send') {
    const { token } = await getValidToken(userId, 'slack');
    const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: args.channel, text: args.text }),
    });
    const data = await slackRes.json();
    return { success: data.ok, ts: data.ts, channel: data.channel, error: data.error };
  }

  if (toolName === 'connector_slack_channels') {
    const { token } = await getValidToken(userId, 'slack');
    const slackRes = await fetch('https://slack.com/api/conversations.list?limit=100&types=public_channel,private_channel', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await slackRes.json();
    return { channels: (data.channels || []).map(c => ({ id: c.id, name: c.name, topic: c.topic?.value, num_members: c.num_members })) };
  }

  if (toolName === 'connector_slack_search') {
    const { token } = await getValidToken(userId, 'slack');
    const slackRes = await fetch(`https://slack.com/api/search.messages?query=${encodeURIComponent(args.query)}&count=10`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await slackRes.json();
    const msgs = (data.messages?.matches || []).map(m => ({
      text: m.text, user: m.username, channel: m.channel?.name, ts: m.ts,
    }));
    return { results: msgs, count: msgs.length };
  }

  // GitHub tools
  if (toolName === 'connector_github_repos') {
    const { token } = await getValidToken(userId, 'github');
    const sort = args.sort || 'updated';
    const ghRes = await fetch(`https://api.github.com/user/repos?sort=${sort}&per_page=20`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GodsEye/1.0' },
    });
    const repos = await ghRes.json();
    return { repos: (repos || []).map(r => ({ full_name: r.full_name, description: r.description, language: r.language, stars: r.stargazers_count, updated_at: r.updated_at, url: r.html_url })) };
  }

  if (toolName === 'connector_github_issues') {
    const { token } = await getValidToken(userId, 'github');
    const state = args.state || 'open';
    const ghRes = await fetch(`https://api.github.com/repos/${args.repo}/issues?state=${state}&per_page=20`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GodsEye/1.0' },
    });
    const issues = await ghRes.json();
    return { issues: (issues || []).map(i => ({ number: i.number, title: i.title, state: i.state, user: i.user?.login, created_at: i.created_at, labels: i.labels?.map(l => l.name) })) };
  }

  if (toolName === 'connector_github_create_issue') {
    const { token } = await getValidToken(userId, 'github');
    const ghRes = await fetch(`https://api.github.com/repos/${args.repo}/issues`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'GodsEye/1.0' },
      body: JSON.stringify({ title: args.title, body: args.body || '' }),
    });
    const issue = await ghRes.json();
    return { success: !!issue.id, number: issue.number, url: issue.html_url, title: issue.title };
  }

  if (toolName === 'connector_github_prs') {
    const { token } = await getValidToken(userId, 'github');
    const state = args.state || 'open';
    const ghRes = await fetch(`https://api.github.com/repos/${args.repo}/pulls?state=${state}&per_page=20`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GodsEye/1.0' },
    });
    const prs = await ghRes.json();
    return { pull_requests: (prs || []).map(p => ({ number: p.number, title: p.title, state: p.state, user: p.user?.login, created_at: p.created_at, url: p.html_url })) };
  }

  // Notion tools
  if (toolName === 'connector_notion_search') {
    const { token } = await getValidToken(userId, 'notion');
    const notionRes = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify({ query: args.query, page_size: 10 }),
    });
    const data = await notionRes.json();
    return { results: (data.results || []).map(r => ({ id: r.id, type: r.object, title: r.properties?.title?.title?.[0]?.plain_text || r.properties?.Name?.title?.[0]?.plain_text || 'Untitled', url: r.url, last_edited: r.last_edited_time })) };
  }

  if (toolName === 'connector_notion_read') {
    const { token } = await getValidToken(userId, 'notion');
    const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${args.page_id}/children?page_size=100`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    const data = await blocksRes.json();
    const text = (data.results || []).map(b => {
      const richText = b[b.type]?.rich_text || [];
      return richText.map(t => t.plain_text).join('');
    }).filter(Boolean).join('\n');
    return { page_id: args.page_id, content: text.substring(0, 10000) };
  }

  if (toolName === 'connector_notion_create') {
    const { token } = await getValidToken(userId, 'notion');
    const body = {
      parent: { page_id: args.parent_id },
      properties: { title: { title: [{ text: { content: args.title } }] } },
      children: args.content ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: args.content } }] } }] : [],
    };
    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
      body: JSON.stringify(body),
    });
    const page = await notionRes.json();
    return { success: !!page.id, id: page.id, url: page.url };
  }

  // Brave Search
  if (toolName === 'connector_brave_search') {
    const { token } = await getValidToken(userId, 'brave_search');
    const count = args.count || 5;
    const braveRes = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(args.query)}&count=${count}`, {
      headers: { 'X-Subscription-Token': token, Accept: 'application/json' },
    });
    const data = await braveRes.json();
    return { results: (data.web?.results || []).map(r => ({ title: r.title, url: r.url, description: r.description })) };
  }

  // Google Maps
  if (toolName === 'connector_maps_search') {
    const { token } = await getValidToken(userId, 'google_maps');
    const mapsRes = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(args.query)}&key=${token}`);
    const data = await mapsRes.json();
    return { places: (data.results || []).slice(0, 10).map(p => ({ name: p.name, address: p.formatted_address, rating: p.rating, types: p.types?.slice(0, 3) })) };
  }

  if (toolName === 'connector_maps_directions') {
    const { token } = await getValidToken(userId, 'google_maps');
    const mode = args.mode || 'driving';
    const dirRes = await fetch(`https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(args.origin)}&destination=${encodeURIComponent(args.destination)}&mode=${mode}&key=${token}`);
    const data = await dirRes.json();
    const route = data.routes?.[0];
    if (!route) return { error: 'No route found' };
    const leg = route.legs?.[0];
    return { distance: leg?.distance?.text, duration: leg?.duration?.text, start: leg?.start_address, end: leg?.end_address, steps: (leg?.steps || []).slice(0, 10).map(s => s.html_instructions?.replace(/<[^>]*>/g, '')) };
  }

  // ── Google Ads tools ───────────────────────────────────────────────────

  // Helper: get customer ID from args or account_info
  async function getGoogleAdsCustomerId(userId, providedId) {
    if (providedId) return providedId.replace(/-/g, '');
    const rows = await supabaseRest(`user_connectors?user_id=eq.${userId}&platform=eq.google_ads&select=account_info`);
    const info = rows?.[0]?.account_info;
    if (info?.customer_ids?.length) return info.customer_ids[0].replace(/-/g, '');
    throw new Error('No Google Ads customer ID found — please provide one or reconnect');
  }

  const GADS_DEV_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
  const GADS_API = 'https://googleads.googleapis.com/v17';

  async function gadsQuery(token, customerId, query) {
    const res = await fetch(`${GADS_API}/customers/${customerId}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': GADS_DEV_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    // searchStream returns array of batches
    const results = [];
    for (const batch of (Array.isArray(data) ? data : [data])) {
      if (batch.results) results.push(...batch.results);
    }
    return results;
  }

  if (toolName === 'connector_google_ads_list_campaigns') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const results = await gadsQuery(token, customerId,
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
              campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros
       FROM campaign ORDER BY campaign.name`
    );
    return {
      campaigns: results.map(r => ({
        id: r.campaign?.id, name: r.campaign?.name, status: r.campaign?.status,
        type: r.campaign?.advertisingChannelType,
        budget_micros: r.campaignBudget?.amountMicros,
        impressions: r.metrics?.impressions, clicks: r.metrics?.clicks,
        cost_micros: r.metrics?.costMicros,
      })),
      count: results.length,
    };
  }

  if (toolName === 'connector_google_ads_campaign_metrics') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const dateRange = args.date_range || 'LAST_30_DAYS';
    const results = await gadsQuery(token, customerId,
      `SELECT campaign.id, campaign.name, metrics.impressions, metrics.clicks,
              metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions,
              metrics.conversions_value, segments.date
       FROM campaign WHERE campaign.id = ${args.campaign_id}
       AND segments.date DURING ${dateRange}
       ORDER BY segments.date`
    );
    const daily = results.map(r => ({
      date: r.segments?.date, impressions: r.metrics?.impressions, clicks: r.metrics?.clicks,
      ctr: r.metrics?.ctr, cpc_micros: r.metrics?.averageCpc,
      cost_micros: r.metrics?.costMicros, conversions: r.metrics?.conversions,
    }));
    const totals = daily.reduce((acc, d) => ({
      impressions: (acc.impressions || 0) + Number(d.impressions || 0),
      clicks: (acc.clicks || 0) + Number(d.clicks || 0),
      cost_micros: (acc.cost_micros || 0) + Number(d.cost_micros || 0),
      conversions: (acc.conversions || 0) + Number(d.conversions || 0),
    }), {});
    totals.ctr = totals.impressions ? (totals.clicks / totals.impressions) : 0;
    totals.cpc_micros = totals.clicks ? Math.round(totals.cost_micros / totals.clicks) : 0;
    return { campaign_id: args.campaign_id, date_range: dateRange, totals, daily };
  }

  if (toolName === 'connector_google_ads_account_metrics') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const dateRange = args.date_range || 'LAST_30_DAYS';
    const results = await gadsQuery(token, customerId,
      `SELECT metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros,
              metrics.conversions, metrics.average_cpc
       FROM customer WHERE segments.date DURING ${dateRange}`
    );
    const m = results[0]?.metrics || {};
    return {
      date_range: dateRange,
      impressions: m.impressions, clicks: m.clicks, ctr: m.ctr,
      cost_micros: m.costMicros, conversions: m.conversions, average_cpc: m.averageCpc,
    };
  }

  if (toolName === 'connector_google_ads_create_campaign') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const campaignType = args.campaign_type || 'SEARCH';
    // Create budget first
    const budgetRes = await fetch(`${GADS_API}/customers/${customerId}/campaignBudgets:mutate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GADS_DEV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ create: { name: `${args.name} Budget`, amountMicros: String(args.budget_micros), deliveryMethod: 'STANDARD' } }],
      }),
    });
    const budgetData = await budgetRes.json();
    if (budgetData.error) return { error: budgetData.error.message };
    const budgetResourceName = budgetData.results?.[0]?.resourceName;

    // Create campaign
    const campaignRes = await fetch(`${GADS_API}/customers/${customerId}/campaigns:mutate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GADS_DEV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          create: {
            name: args.name,
            advertisingChannelType: campaignType,
            status: 'PAUSED',
            campaignBudget: budgetResourceName,
            manualCpc: {},
          },
        }],
      }),
    });
    const campaignData = await campaignRes.json();
    if (campaignData.error) return { error: campaignData.error.message };
    return { success: true, campaign: campaignData.results?.[0]?.resourceName, name: args.name };
  }

  if (toolName === 'connector_google_ads_update_campaign') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const update = { resourceName: `customers/${customerId}/campaigns/${args.campaign_id}` };
    const updateMask = [];
    if (args.status) { update.status = args.status; updateMask.push('status'); }
    if (args.budget_micros) { updateMask.push('campaign_budget'); }
    const res = await fetch(`${GADS_API}/customers/${customerId}/campaigns:mutate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GADS_DEV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [{ update, updateMask: updateMask.join(',') }] }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { success: true, updated: args.campaign_id };
  }

  if (toolName === 'connector_google_ads_upload_asset') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    // Download image and convert to base64
    const imgRes = await fetch(args.image_url);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const imgBase64 = imgBuffer.toString('base64');
    const res = await fetch(`${GADS_API}/customers/${customerId}/assets:mutate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GADS_DEV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{ create: { name: args.asset_name, type: 'IMAGE', imageAsset: { data: imgBase64 } } }],
      }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { success: true, asset: data.results?.[0]?.resourceName, name: args.asset_name };
  }

  if (toolName === 'connector_google_ads_keyword_ideas') {
    const { token } = await getValidToken(userId, 'google_ads');
    const customerId = await getGoogleAdsCustomerId(userId, args.customer_id);
    const keywords = (args.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    const res = await fetch(`${GADS_API}/customers/${customerId}:generateKeywordIdeas`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'developer-token': GADS_DEV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: `languageConstants/${args.language === 'en' || !args.language ? '1000' : '1000'}`,
        geoTargetConstants: ['geoTargetConstants/2840'], // US
        keywordSeed: { keywords },
      }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return {
      keywords: (data.results || []).slice(0, 20).map(r => ({
        keyword: r.text, avg_monthly_searches: r.keywordIdeaMetrics?.avgMonthlySearches,
        competition: r.keywordIdeaMetrics?.competition,
        low_cpc_micros: r.keywordIdeaMetrics?.lowTopOfPageBidMicros,
        high_cpc_micros: r.keywordIdeaMetrics?.highTopOfPageBidMicros,
      })),
    };
  }

  // ── Meta Ads tools ───────────────────────────────────────────────────

  async function getMetaAdAccountId(userId, providedId) {
    if (providedId) return providedId.startsWith('act_') ? providedId : `act_${providedId}`;
    const rows = await supabaseRest(`user_connectors?user_id=eq.${userId}&platform=eq.meta_ads&select=account_info`);
    const info = rows?.[0]?.account_info;
    if (info?.ad_accounts?.length) {
      const id = info.ad_accounts[0].id || info.ad_accounts[0];
      return id.startsWith('act_') ? id : `act_${id}`;
    }
    throw new Error('No Meta Ad Account ID found — please provide one or reconnect');
  }

  const META_API = 'https://graph.facebook.com/v19.0';

  if (toolName === 'connector_meta_ads_list_campaigns') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const accountId = await getMetaAdAccountId(userId, args.ad_account_id);
    const res = await fetch(`${META_API}/${accountId}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,created_time&limit=50&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { campaigns: data.data || [], count: (data.data || []).length };
  }

  if (toolName === 'connector_meta_ads_campaign_insights') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const preset = args.date_preset || 'last_30d';
    const res = await fetch(`${META_API}/${args.campaign_id}/insights?fields=impressions,reach,clicks,spend,ctr,cpc,actions,cost_per_action_type&date_preset=${preset}&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    const insights = data.data?.[0] || {};
    return {
      campaign_id: args.campaign_id, date_preset: preset,
      impressions: insights.impressions, reach: insights.reach,
      clicks: insights.clicks, spend: insights.spend,
      ctr: insights.ctr, cpc: insights.cpc,
      actions: insights.actions, cost_per_action: insights.cost_per_action_type,
    };
  }

  if (toolName === 'connector_meta_ads_account_insights') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const accountId = await getMetaAdAccountId(userId, args.ad_account_id);
    const preset = args.date_preset || 'last_30d';
    const res = await fetch(`${META_API}/${accountId}/insights?fields=impressions,reach,clicks,spend,ctr,cpc,actions&date_preset=${preset}&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { date_preset: preset, ...(data.data?.[0] || {}) };
  }

  if (toolName === 'connector_meta_ads_create_campaign') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const accountId = await getMetaAdAccountId(userId, args.ad_account_id);
    const objective = args.objective || 'OUTCOME_TRAFFIC';
    const status = args.status || 'PAUSED';
    const params = new URLSearchParams({
      name: args.name, objective, status,
      daily_budget: String(args.daily_budget),
      special_ad_categories: '[]',
      access_token: token,
    });
    const res = await fetch(`${META_API}/${accountId}/campaigns`, { method: 'POST', body: params });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { success: true, campaign_id: data.id, name: args.name };
  }

  if (toolName === 'connector_meta_ads_update_campaign') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const params = new URLSearchParams({ access_token: token });
    if (args.name) params.set('name', args.name);
    if (args.status) params.set('status', args.status);
    if (args.daily_budget) params.set('daily_budget', String(args.daily_budget));
    const res = await fetch(`${META_API}/${args.campaign_id}`, { method: 'POST', body: params });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { success: data.success !== false, campaign_id: args.campaign_id };
  }

  if (toolName === 'connector_meta_ads_upload_creative') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const accountId = await getMetaAdAccountId(userId, args.ad_account_id);
    // Download image
    const imgRes = await fetch(args.image_url);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const imgBase64 = imgBuffer.toString('base64');
    // Upload as base64 bytes
    const params = new URLSearchParams({
      access_token: token,
      bytes: imgBase64,
      name: args.name || 'GodsEye Creative',
    });
    const res = await fetch(`${META_API}/${accountId}/adimages`, { method: 'POST', body: params });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    const images = data.images || {};
    const firstKey = Object.keys(images)[0];
    return { success: true, hash: images[firstKey]?.hash, url: images[firstKey]?.url, name: args.name };
  }

  if (toolName === 'connector_meta_ads_list_adsets') {
    const { token } = await getValidToken(userId, 'meta_ads');
    const res = await fetch(`${META_API}/${args.campaign_id}/adsets?fields=id,name,status,daily_budget,targeting,optimization_goal&limit=50&access_token=${token}`);
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { adsets: data.data || [], count: (data.data || []).length };
  }

  throw new Error(`Unknown connector tool: ${toolName}`);
}

// Execute a connector tool
app.post('/api/connectors/execute', async (req, res) => {
  const { user_id, tool_name, args } = req.body;
  if (!user_id || !tool_name) return res.status(400).json({ error: 'user_id and tool_name required' });
  try {
    const result = await executeConnectorTool(user_id, tool_name, args || {});
    res.json({ success: true, result });
  } catch (err) {
    console.error(`[Connectors] Tool execution error (${tool_name}):`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// npm search for MCP packages (moved from bridge)
app.get('/api/connectors/search', async (req, res) => {
  try {
    const query = req.query.q || 'mcp';
    const npmRes = await fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query + ' mcp server')}&size=20`);
    const npmData = await npmRes.json();
    const results = (npmData.objects || [])
      .filter(o => {
        const name = o.package?.name || '';
        const desc = (o.package?.description || '').toLowerCase();
        return name.includes('mcp') || desc.includes('mcp') || desc.includes('model context protocol');
      })
      .map(o => ({
        id: o.package.name.replace(/@/g, '').replace(/\//g, '-').replace(/^mcp-/, ''),
        package: o.package.name,
        name: o.package.name.split('/').pop().replace(/^mcp-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: o.package.description || '',
        version: o.package.version,
        author: o.package.publisher?.username || '',
        downloads: o.downloads?.weekly || 0,
        url: o.package.links?.npm || '',
      }));
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// CAMPAIGN MANAGEMENT — CRUD + sync for ad campaigns & creatives
// ═══════════════════════════════════════════════════════════════════════

// List cached campaigns
app.get('/api/campaigns/list', async (req, res) => {
  const { user_id, brand_id, platform } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    let filter = `ad_campaigns?user_id=eq.${user_id}&select=*&order=updated_at.desc`;
    if (brand_id) filter += `&brand_id=eq.${brand_id}`;
    if (platform) filter += `&platform=eq.${platform}`;
    const rows = await supabaseRest(filter);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync campaigns from ad platform → local cache
app.post('/api/campaigns/sync', async (req, res) => {
  const { user_id, platform, brand_id } = req.body;
  if (!user_id || !platform) return res.status(400).json({ error: 'user_id and platform required' });
  try {
    let campaigns = [];
    if (platform === 'google_ads') {
      const result = await executeConnectorTool(user_id, 'connector_google_ads_list_campaigns', {});
      campaigns = (result.campaigns || []).map(c => ({
        user_id, brand_id: brand_id || null, platform: 'google_ads',
        external_campaign_id: String(c.id), name: c.name, status: c.status,
        impressions: Number(c.impressions || 0), clicks: Number(c.clicks || 0),
        spend_cents: Math.round(Number(c.cost_micros || 0) / 10000),
        daily_budget_cents: Math.round(Number(c.budget_micros || 0) / 10000),
        metrics_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }));
    } else if (platform === 'meta_ads') {
      const result = await executeConnectorTool(user_id, 'connector_meta_ads_list_campaigns', {});
      campaigns = (result.campaigns || []).map(c => ({
        user_id, brand_id: brand_id || null, platform: 'meta_ads',
        external_campaign_id: String(c.id), name: c.name, status: c.status,
        objective: c.objective,
        daily_budget_cents: Number(c.daily_budget || 0),
        metrics_updated_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }));
    }

    // Upsert each campaign
    for (const c of campaigns) {
      const existing = await supabaseRest(
        `ad_campaigns?user_id=eq.${user_id}&platform=eq.${platform}&external_campaign_id=eq.${c.external_campaign_id}&select=id`
      );
      if (existing?.length > 0) {
        await supabaseRest(`ad_campaigns?id=eq.${existing[0].id}`, 'PATCH', c);
      } else {
        c.created_at = new Date().toISOString();
        await supabaseRest('ad_campaigns', 'POST', c);
      }
    }

    // Return updated list
    const rows = await supabaseRest(`ad_campaigns?user_id=eq.${user_id}&platform=eq.${platform}&select=*&order=updated_at.desc`);
    res.json({ campaigns: rows || [], synced: campaigns.length });
  } catch (err) {
    console.error('[Campaigns] Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get campaign metrics (calls connector tool)
app.get('/api/campaigns/:id/metrics', async (req, res) => {
  const { user_id, date_range } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const campaign = (await supabaseRest(`ad_campaigns?id=eq.${req.params.id}&select=*`))?.[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    let metrics;
    if (campaign.platform === 'google_ads') {
      metrics = await executeConnectorTool(user_id, 'connector_google_ads_campaign_metrics', {
        campaign_id: campaign.external_campaign_id, date_range: date_range || 'LAST_30_DAYS',
      });
    } else {
      metrics = await executeConnectorTool(user_id, 'connector_meta_ads_campaign_insights', {
        campaign_id: campaign.external_campaign_id, date_preset: date_range || 'last_30d',
      });
    }
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push creative to ad platform
app.post('/api/campaigns/:id/push-creative', async (req, res) => {
  const { user_id, image_url, asset_name, platform } = req.body;
  if (!user_id || !image_url) return res.status(400).json({ error: 'user_id and image_url required' });
  try {
    const campaign = (await supabaseRest(`ad_campaigns?id=eq.${req.params.id}&select=*`))?.[0];
    const p = platform || campaign?.platform;

    let result;
    if (p === 'google_ads') {
      result = await executeConnectorTool(user_id, 'connector_google_ads_upload_asset', { image_url, asset_name: asset_name || 'GodsEye Creative' });
    } else if (p === 'meta_ads') {
      result = await executeConnectorTool(user_id, 'connector_meta_ads_upload_creative', { image_url, name: asset_name || 'GodsEye Creative' });
    } else {
      return res.status(400).json({ error: 'Unknown platform' });
    }

    if (result.error) return res.status(500).json({ error: result.error });

    // Record in ad_creatives
    await supabaseRest('ad_creatives', 'POST', {
      user_id, campaign_id: req.params.id !== 'none' ? req.params.id : null,
      platform: p, image_url, asset_name: asset_name || 'GodsEye Creative',
      external_asset_id: result.asset || result.hash || null,
      status: 'uploaded', created_at: new Date().toISOString(),
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create campaign via platform
app.post('/api/campaigns/create', async (req, res) => {
  const { user_id, platform, name, budget, objective, brand_id } = req.body;
  if (!user_id || !platform || !name) return res.status(400).json({ error: 'user_id, platform, name required' });
  try {
    let result;
    if (platform === 'google_ads') {
      result = await executeConnectorTool(user_id, 'connector_google_ads_create_campaign', {
        name, budget_micros: (budget || 1000) * 10000, campaign_type: 'SEARCH',
      });
    } else if (platform === 'meta_ads') {
      result = await executeConnectorTool(user_id, 'connector_meta_ads_create_campaign', {
        name, daily_budget: budget || 1000, objective: objective || 'OUTCOME_TRAFFIC', status: 'PAUSED',
      });
    }

    if (result?.error) return res.status(500).json({ error: result.error });

    // Record locally
    const campaignId = result.campaign_id || result.campaign?.split('/')?.pop();
    if (campaignId) {
      await supabaseRest('ad_campaigns', 'POST', {
        user_id, brand_id: brand_id || null, platform,
        external_campaign_id: String(campaignId), name, status: 'PAUSED',
        daily_budget_cents: budget || 1000,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }

    res.json({ success: true, campaign_id: campaignId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update campaign status (pause/resume)
app.post('/api/campaigns/:id/update-status', async (req, res) => {
  const { user_id, status } = req.body;
  if (!user_id || !status) return res.status(400).json({ error: 'user_id and status required' });
  try {
    const campaign = (await supabaseRest(`ad_campaigns?id=eq.${req.params.id}&select=*`))?.[0];
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Update on platform
    if (campaign.platform === 'google_ads') {
      await executeConnectorTool(user_id, 'connector_google_ads_update_campaign', {
        campaign_id: campaign.external_campaign_id, status,
      });
    } else if (campaign.platform === 'meta_ads') {
      await executeConnectorTool(user_id, 'connector_meta_ads_update_campaign', {
        campaign_id: campaign.external_campaign_id, status,
      });
    }

    // Update local cache
    await supabaseRest(`ad_campaigns?id=eq.${req.params.id}`, 'PATCH', {
      status, updated_at: new Date().toISOString(),
    });

    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List creatives
app.get('/api/campaigns/creatives', async (req, res) => {
  const { user_id, campaign_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    let filter = `ad_creatives?user_id=eq.${user_id}&select=*&order=created_at.desc`;
    if (campaign_id) filter += `&campaign_id=eq.${campaign_id}`;
    const rows = await supabaseRest(filter);
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP SSE Server (must be before static/SPA catch-all) ──
mountMcpEndpoints(app, { port: PORT });

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

