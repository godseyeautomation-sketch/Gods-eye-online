// Simple Express server for dev - handles Gemini API calls, sync, and social media posting
import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountMcpEndpoints } from './services/mcpServer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3002; // Different port from Vite

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Skip JSON parsing for multipart/form-data requests (photo/video uploads)
app.use((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.startsWith('multipart/form-data')) return next();
  express.json({ limit: '100mb' })(req, res, next);
});

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const uploadPostApiKey = process.env.UPLOAD_POST_API_KEY;

app.post('/api/gemini/*', async (req, res) => {
  try {
    // Extract model and action from path: /api/gemini/models/{model}:{action}
    const pathMatch = req.path.match(/\/models\/([^:]+):(generateContent|predict)/);
    const model = pathMatch?.[1] || req.body.model || 'gemini-2.5-flash';
    const action = pathMatch?.[2] || 'generateContent';

    console.log(`[Dev Server] Proxying request for model: ${model} (Action: ${action})`);

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body)
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

    console.log('[Dev Server] Streaming response status:', response.status);
  } catch (error) {
    console.error('[Dev Server] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ── Gemini Embedding 2 Proxy ─────────────────────────────────────────────────
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
    console.log(`[Dev Server] Embedding request for model: ${embedModel}`);

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
    console.error('[Dev Server] Embed error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── fal.ai Proxy ────────────────────────────────────────────────────────────
const falKey = process.env.FAL_KEY;

app.all('/api/fal/*', async (req, res) => {
  try {
    if (!falKey) {
      return res.status(500).json({ error: 'FAL_KEY not configured. Add FAL_KEY to your .env file.' });
    }

    // Strip /api/fal/ prefix to get the fal.ai path
    const falPath = req.path.replace('/api/fal/', '');
    const targetUrl = `https://queue.fal.run/${falPath}`;
    console.log(`[Dev Server] Fal proxy: ${req.method} ${targetUrl}`);

    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (error) {
    console.error('[Dev Server] Fal proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── fal.ai Storage Proxy (rest.fal.ai) ──────────────────────────────────────
// Needed to initiate signed uploads for local images before sending to models
app.all('/api/fal-storage/*', async (req, res) => {
  try {
    if (!falKey) {
      return res.status(500).json({ error: 'FAL_KEY not configured. Add FAL_KEY to your .env file.' });
    }

    const storagePath = req.path.replace('/api/fal-storage/', '');
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const targetUrl = `https://rest.fal.ai/${storagePath}${query}`;
    console.log(`[Dev Server] Fal storage proxy: ${req.method} ${targetUrl}`);

    const fetchOptions = {
      method: req.method,
      headers: {
        'Authorization': `Key ${falKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();
    res.status(response.status).setHeader('Content-Type', 'application/json').send(data);
  } catch (error) {
    console.error('[Dev Server] Fal storage proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── fal.ai Binary Upload Proxy ───────────────────────────────────────────────
// Receives { upload_url, base64, content_type } and PUTs the binary to the
// signed URL server-side — avoids browser CORS restrictions on fal.media
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
    console.error('[Dev Server] Fal upload proxy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ── Brand Website Scraper ────────────────────────────────────────────────────
// Fetches a brand's website server-side (no CORS), extracts logo + hero images.
// Returns URLs only — images are converted to base64 on-demand via /api/proxy-image.
app.get('/api/scrape-brand', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'follow',
    });

    if (!response.ok) return res.json({ logoUrl: '', images: [] });

    const html = await response.text();
    const base = new URL(url);

    const resolve = (src) => {
      if (!src) return null;
      try {
        if (src.startsWith('//')) return 'https:' + src;
        return new URL(src, base).href;
      } catch { return null; }
    };

    // ── Logo detection (handles src before or after class) ──────────────────
    let logoSrc = '';
    // Find all img tags with logo-related class/id
    for (const m of html.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      if (/(?:id|class)=["'][^"']*logo[^"']*["']/i.test(tag)) {
        const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
        if (src) { logoSrc = src; break; }
      }
    }
    // Fallback chain
    if (!logoSrc) logoSrc = html.match(/<a[^>]+(?:id|class)=["'][^"']*(?:logo|brand|header)[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i)?.[1] || '';
    if (!logoSrc) logoSrc = html.match(/<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
    if (!logoSrc) logoSrc = html.match(/<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
    if (!logoSrc) logoSrc = html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["']/i)?.[1] || '';
    const logoUrl = resolve(logoSrc) || '';

    // ── CSS — inline blocks + fetch up to 3 external stylesheets ─────────────
    const inlineCssBlocks = [];
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) inlineCssBlocks.push(m[1]);

    const cssLinks = [];
    for (const m of html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi)) {
      const href = resolve(m[1]);
      if (href && !href.includes('fonts.googleapis.com')) cssLinks.push(href);
    }
    const externalCssResults = await Promise.allSettled(
      cssLinks.slice(0, 3).map(link =>
        fetch(link, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.text() : '')
      )
    );
    const externalCss = externalCssResults.map(r => r.status === 'fulfilled' ? r.value : '').join('\n');
    const cssText = inlineCssBlocks.join('\n') + '\n' + externalCss;

    const colorSet = new Set();
    for (const m of cssText.matchAll(/#[0-9a-fA-F]{6}\b/g)) colorSet.add(m[0].toLowerCase());
    for (const m of cssText.matchAll(/--[\w-]+\s*:\s*(#[0-9a-fA-F]{6})\b/g)) colorSet.add(m[1].toLowerCase());
    for (const m of html.matchAll(/style=["'][^"']*?(#[0-9a-fA-F]{6})[^"']*?["']/g)) colorSet.add(m[1].toLowerCase());
    const NOISE_COLORS = new Set(['#ffffff', '#000000', '#fffffe', '#fefefe', '#111111', '#222222', '#333333', '#f5f5f5', '#fafafa', '#eeeeee']);
    const cssColors = Array.from(colorSet).filter(c => !NOISE_COLORS.has(c)).slice(0, 15);

    const fontSet = new Set();
    const GENERIC_FONTS = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto', 'helvetica neue', 'helvetica', 'arial', 'verdana', 'tahoma', 'georgia', 'impact']);
    for (const m of cssText.matchAll(/font-family\s*:\s*([^;}\n]+)/g)) {
      for (const part of m[1].split(',')) {
        const f = part.trim().replace(/['"]/g, '').replace(/\s*!important/i, '').trim();
        if (f && f.length > 1 && !GENERIC_FONTS.has(f.toLowerCase())) fontSet.add(f);
      }
    }
    const cssFonts = Array.from(fontSet).slice(0, 5);

    // ── Image helpers ────────────────────────────────────────────────────────
    // Known image CDN domains that serve images without file extensions
    const IMAGE_CDN_DOMAINS = [
      'cdn.shopify.com', 'cdn2.shopify.com',
      'res.cloudinary.com',
      'images.ctfassets.net',
      'images.prismic.io',
      'cdn.sanity.io',
      'framerusercontent.com',
      'uploads-ssl.webflow.com', 'assets.website-files.com',
      'images.squarespace-cdn.com', 'static1.squarespace.com',
      'static.wixstatic.com', 'media.wix.com',
      'imgix.net',
      'media.graphassets.com',
      'wp-content/uploads',
      'lh3.googleusercontent.com',
      'storage.googleapis.com',
      'amazonaws.com',
    ];

    const isRaster = (src) => {
      if (!src || src.startsWith('data:')) return false;
      const p = src.split('?')[0].toLowerCase();
      if (p.endsWith('.svg') || p.includes('.svg?')) return false;
      // Has explicit raster extension
      if (/\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/.test(p)) return true;
      // Known image CDN domain
      if (IMAGE_CDN_DOMAINS.some(cdn => src.includes(cdn))) return true;
      // Generic path signals
      if (/\/(images?|media|assets?|photos?|pictures?|gallery|uploads?|files?|img)\//i.test(p)) return true;
      return false;
    };

    const hasProductSignal = (src, altText) => {
      // URL path signals
      if (/\/(product|products|catalog|catalogue|shop|item|items|variant|sku|pd|goods|collection|collections|merchandise|buy|store)\//i.test(src)) return true;
      if (/[-_](product|item|sku|variant|buy)/i.test(src)) return true;
      // Shopify CDN product patterns
      if (/cdn\.shopify\.com\/.*\/products\//i.test(src)) return true;
      // WooCommerce patterns
      if (/\/wp-content\/uploads\/.*product/i.test(src)) return true;
      // Common e-commerce image naming
      if (/\/(featured|hero|main|primary)[-_]?(image|img|photo|pic)/i.test(src)) return true;
      // Alt text signals (if available)
      if (altText && /\b(buy|price|order|add.to.cart|shop|product|pack|bottle|jar|tube|sachet|supplement|capsule|tablet|serum|cream|oil|powder|resin|shilajit)\b/i.test(altText)) return true;
      return false;
    };

    const isNoise = (src) =>
      /1x1|pixel|tracking|beacon|spacer|sprite|\.ico$|\/arrow|\/chevron|\/icon[-_]|\/check|\/star[-_]|\/rating|\/logo|placeholder|loading|spinner/i.test(src) ||
      src.length < 20;

    const addImg = (src, productSet, lifestyleSet, altText) => {
      if (!src || !isRaster(src) || isNoise(src)) return;
      if (hasProductSignal(src, altText)) productSet.add(src); else lifestyleSet.add(src);
    };

    // Strip nav/header/footer from HTML to isolate main content
    const mainHtml = html
      .replace(/<header[\s\S]*?<\/header>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '');

    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    const twitterImage = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1];

    const productSet = new Set();
    const lifestyleSet = new Set();

    // 1. og/twitter meta tags
    if (ogImage) { const s = resolve(ogImage); if (s) addImg(s, productSet, lifestyleSet); }
    if (twitterImage) { const s = resolve(twitterImage); if (s) addImg(s, productSet, lifestyleSet); }

    // 2. <img> tags — all lazy-load attributes + alt text for product detection
    for (const m of mainHtml.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const altText = tag.match(/alt=["']([^"']+)["']/i)?.[1] || '';
      const titleText = tag.match(/title=["']([^"']+)["']/i)?.[1] || '';
      const contextText = altText || titleText;
      for (const attr of ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-lazy', 'data-bg', 'data-image', 'data-srcset']) {
        const val = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'))?.[1];
        if (!val) continue;
        if (attr.includes('srcset')) {
          for (const part of val.split(',')) { const s = resolve(part.trim().split(' ')[0]); if (s) addImg(s, productSet, lifestyleSet, contextText); }
        } else {
          const s = resolve(val); if (s) addImg(s, productSet, lifestyleSet, contextText);
        }
      }
    }

    // 3. srcset attributes
    for (const m of mainHtml.matchAll(/srcset=["']([^"']+)["']/gi)) {
      for (const part of m[1].split(',')) {
        const s = resolve(part.trim().split(' ')[0]); if (s) addImg(s, productSet, lifestyleSet);
      }
    }

    // 4. __NEXT_DATA__ (Next.js) — the goldmine: all page data as JSON
    const nextDataMatch = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (nextDataMatch) {
      try {
        const nextJson = nextDataMatch[1];
        for (const m of nextJson.matchAll(/"(https?:\/\/[^"]{10,500})"/g)) {
          const s = resolve(m[1]); if (s) addImg(s, productSet, lifestyleSet);
        }
      } catch { }
    }

    // 5. Nuxt / window.__NUXT__ / window.__INITIAL_STATE__ / window.__STATE__
    for (const m of html.matchAll(/window\.__(?:NUXT|INITIAL_STATE|STATE|DATA|APP_STATE)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi)) {
      for (const im of m[1].matchAll(/"(https?:\/\/[^"]{10,500})"/g)) {
        const s = resolve(im[1]); if (s) addImg(s, productSet, lifestyleSet);
      }
    }

    // 6. Any inline <script> blocks containing image CDN URLs (Shopify JSON, embedded data)
    for (const m of html.matchAll(/<script[^>]*type=["'](?:application\/json|application\/ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      for (const im of m[1].matchAll(/"(https?:\/\/[^"]{10,500})"/g)) {
        const s = resolve(im[1]); if (s) addImg(s, productSet, lifestyleSet);
      }
    }

    // 7. JSON-LD image fields
    for (const m of html.matchAll(/"(?:image|thumbnail|photo|picture|heroImage|contentUrl|url)"\s*:\s*"(https?:\/\/[^"]+)"/gi)) {
      const s = resolve(m[1]); if (s) addImg(s, productSet, lifestyleSet);
    }

    // 8. Background images in inline styles
    for (const m of html.matchAll(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi)) {
      const s = resolve(m[1]); if (s && !isNoise(s) && isRaster(s)) lifestyleSet.add(s);
    }

    // 9. Raw image CDN URLs anywhere in HTML (catches Shopify/Cloudinary embedded in JS)
    const cdnPattern = new RegExp(
      `"(https?://(?:${IMAGE_CDN_DOMAINS.map(d => d.replace('.', '\\.').replace('/', '\\/')).join('|')})[^"]{5,400})"`,
      'gi'
    );
    for (const m of html.matchAll(cdnPattern)) {
      const s = m[1];
      if (!isNoise(s)) { if (hasProductSignal(s)) productSet.add(s); else lifestyleSet.add(s); }
    }

    // ── 10a. Shopify /products.json API (most reliable for Shopify stores) ────
    const detectedProducts = []; // { name, imageUrl }
    const isShopify = html.includes('Shopify') || html.includes('cdn.shopify.com') || html.includes('myshopify.com');
    if (isShopify) {
      try {
        const productsUrl = new URL('/products.json?limit=20', base).href;
        console.log(`[brand-scraper] Shopify detected — fetching ${productsUrl}`);
        const shopifyRes = await fetch(productsUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        });
        if (shopifyRes.ok) {
          const shopifyData = await shopifyRes.json();
          for (const product of (shopifyData.products || [])) {
            const name = product.title || '';
            const img = product.images?.[0]?.src || product.image?.src || '';
            if (name && img) {
              detectedProducts.push({ name, imageUrl: img });
              productSet.add(img);
            }
          }
          console.log(`[brand-scraper] Shopify API: found ${detectedProducts.length} products`);
        }
      } catch (shopifyErr) {
        console.warn('[brand-scraper] Shopify /products.json failed:', shopifyErr.message);
      }
    }

    // ── 10b. JSON-LD Product schema extraction (non-Shopify or Shopify fallback) ─
    for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const ld = JSON.parse(m[1]);
        const items = Array.isArray(ld) ? ld : (ld['@graph'] || [ld]);
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') {
            const name = item.name || '';
            const img = Array.isArray(item.image) ? item.image[0] : (item.image || '');
            const imgUrl = resolve(typeof img === 'string' ? img : (img?.url || ''));
            if (name && imgUrl) {
              detectedProducts.push({ name, imageUrl: imgUrl });
              productSet.add(imgUrl);
            }
          }
        }
      } catch { }
    }

    // ── 11. Product card detection from HTML structure (skip if Shopify API found products) ──
    const cardPatterns = [
      // Pattern: <a href="/product/..."><img .../><h2>Name</h2></a>
      /<a[^>]+href=["'][^"']*(?:product|shop|item|collection)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi,
      // Pattern: <div class="*product*">...<img>...<h2/h3/span>Name</span></div>
      /<(?:div|li|article)[^>]+class=["'][^"']*(?:product|card|item|grid-item)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|li|article)>/gi,
    ];
    // Only use card detection if Shopify API didn't find products
    if (detectedProducts.length === 0) {
      for (const pattern of cardPatterns) {
        for (const cm of mainHtml.matchAll(pattern)) {
          const card = cm[1] || cm[0];
          const nameMatch = card.match(/<(?:h[1-4]|span[^>]+class=["'][^"']*(?:title|name|heading)[^"']*["'])[^>]*>([^<]{2,80})<\//i);
          if (!nameMatch) continue;
          const prodName = nameMatch[1].trim();
          if (prodName.length < 2 || prodName.length > 80) continue;
          if (/^(home|about|contact|blog|faq|menu|cart|login|sign)/i.test(prodName)) continue;
          const imgMatch = card.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
          if (!imgMatch) continue;
          const cardImg = resolve(imgMatch[1]);
          if (!cardImg || !isRaster(cardImg) || isNoise(cardImg)) continue;
          if (!detectedProducts.find(dp => dp.name === prodName)) {
            detectedProducts.push({ name: prodName, imageUrl: cardImg });
            productSet.add(cardImg);
          }
        }
      }
    }

    // ── 12. Multi-page crawl (skip if Shopify API already found products) ────
    const crawledPages = new Set([url]);
    const productPageLinks = [];
    const skipCrawl = detectedProducts.length >= 3; // Shopify API found enough
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)) {
      try {
        const link = new URL(m[1], base);
        if (link.hostname !== base.hostname) continue;
        const path = link.pathname.toLowerCase();
        if (/\/(products?|shop|store|collections?|catalog|our-products|all-products)\b/i.test(path)) {
          const fullUrl = link.href;
          if (!crawledPages.has(fullUrl)) {
            productPageLinks.push(fullUrl);
            crawledPages.add(fullUrl);
          }
        }
      } catch { }
    }

    // Fetch up to 3 product pages (skip if we already have enough products)
    for (const pageUrl of (skipCrawl ? [] : productPageLinks.slice(0, 3))) {
      try {
        console.log(`[brand-scraper] Crawling: ${pageUrl}`);
        const pageRes = await fetch(pageUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(10000),
          redirect: 'follow',
        });
        if (!pageRes.ok) continue;
        const pageHtml = await pageRes.text();
        const pageMain = pageHtml
          .replace(/<header[\s\S]*?<\/header>/gi, '')
          .replace(/<nav[\s\S]*?<\/nav>/gi, '')
          .replace(/<footer[\s\S]*?<\/footer>/gi, '');

        // Extract JSON-LD products from subpage
        for (const m of pageHtml.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
          try {
            const ld = JSON.parse(m[1]);
            const items = Array.isArray(ld) ? ld : (ld['@graph'] || [ld]);
            for (const item of items) {
              if (item['@type'] === 'Product' || item['@type'] === 'IndividualProduct') {
                const name = item.name || '';
                const img = Array.isArray(item.image) ? item.image[0] : (item.image || '');
                const imgUrl = resolve(typeof img === 'string' ? img : (img?.url || ''));
                if (name && imgUrl && !detectedProducts.find(dp => dp.name === name)) {
                  detectedProducts.push({ name, imageUrl: imgUrl });
                  productSet.add(imgUrl);
                }
              }
            }
          } catch { }
        }

        // Extract product cards from subpage
        for (const pattern of cardPatterns) {
          for (const cm of pageMain.matchAll(pattern)) {
            const card = cm[1] || cm[0];
            const nameMatch = card.match(/<(?:h[1-4]|span[^>]+class=["'][^"']*(?:title|name|heading)[^"']*["'])[^>]*>([^<]{2,80})<\//i);
            if (!nameMatch) continue;
            const prodName = nameMatch[1].trim();
            if (prodName.length < 2 || prodName.length > 80) continue;
            if (/^(home|about|contact|blog|faq|menu|cart|login|sign)/i.test(prodName)) continue;
            const imgMatch = card.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
            if (!imgMatch) continue;
            const cardImg = resolve(imgMatch[1]);
            if (!cardImg || !isRaster(cardImg) || isNoise(cardImg)) continue;
            if (!detectedProducts.find(dp => dp.name === prodName)) {
              detectedProducts.push({ name: prodName, imageUrl: cardImg });
              productSet.add(cardImg);
            }
          }
        }

        // Also extract images from subpage into the image pool
        for (const imgM of pageMain.matchAll(/<img[^>]+>/gi)) {
          const tag = imgM[0];
          const altText = tag.match(/alt=["']([^"']+)["']/i)?.[1] || '';
          const srcVal = tag.match(/(?:src|data-src)=["']([^"']+)["']/i)?.[1];
          if (srcVal) { const s = resolve(srcVal); if (s) addImg(s, productSet, lifestyleSet, altText); }
        }

        await new Promise(r => setTimeout(r, 1000)); // Polite delay between crawls
      } catch (crawlErr) {
        console.warn(`[brand-scraper] Crawl failed for ${pageUrl}:`, crawlErr.message);
      }
    }

    let productImages = Array.from(productSet).slice(0, 15);
    let lifestyleImages = Array.from(lifestyleSet).slice(0, 15);

    // Fallback: no product URL signals → promote top lifestyle images to product
    if (productImages.length === 0 && lifestyleImages.length > 0) {
      const hasEcomSignals = /add.to.cart|buy.now|shop.now|price|₹|\$|€|£|cart|checkout|quantity/i.test(html);
      if (hasEcomSignals) {
        productImages = lifestyleImages.splice(0, Math.min(8, lifestyleImages.length));
      } else {
        productImages = lifestyleImages.splice(0, Math.min(4, lifestyleImages.length));
      }
    }

    const images = [...productImages, ...lifestyleImages].slice(0, 30);

    console.log(`[brand-scraper] ${url} → logo:${!!logoUrl} colors:${cssColors.length} fonts:${cssFonts.length} product:${productImages.length} lifestyle:${lifestyleImages.length} named:${detectedProducts.length}`);
    res.json({ logoUrl, cssColors, cssFonts, productImages, lifestyleImages, images, detectedProducts });
  } catch (err) {
    console.error('[Scrape] Error:', err.message);
    res.json({ logoUrl: '', images: [] });
  }
});

// ── Image Proxy ──────────────────────────────────────────────────────────────
// Fetches any image URL server-side and returns it as a base64 data URL.
// Used by brandService to convert scraped HTTP image URLs → inlineData for Gemini.
// SVGs and non-image responses are rejected (Gemini can't process them).
app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });

    if (!response.ok) return res.status(response.status).json({ error: 'Fetch failed' });

    const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();

    // Only pass through raster images — Gemini inlineData needs JPEG/PNG/WebP/GIF
    if (!contentType.startsWith('image/') || contentType.includes('svg')) {
      return res.status(415).json({ error: `Unsupported type: ${contentType}` });
    }

    const buf = Buffer.from(await response.arrayBuffer());

    // Hard cap at 3MB raw — Gemini has token limits on image data
    if (buf.length > 3 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large (>3MB)' });
    }

    const base64 = buf.toString('base64');
    res.json({ dataUrl: `data:${contentType};base64,${base64}`, mimeType: contentType });
  } catch (err) {
    console.error('[ProxyImage] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Klint Sync API ──────────────────────────────────────────────────────────
// Shared state store so Chrome (browser) and Gods Eye (Electron) stay in sync.
// Both read/write to the same JSON files on disk via this API.
const SYNC_DIR = path.join(process.env.HOME || '', '.klint', 'sync');
if (!fs.existsSync(SYNC_DIR)) fs.mkdirSync(SYNC_DIR, { recursive: true });

function readSyncFile(name) {
  const fp = path.join(SYNC_DIR, `${name}.json`);
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return null; }
}
function writeSyncFile(name, data) {
  const fp = path.join(SYNC_DIR, `${name}.json`);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), 'utf-8');
}

// GET /api/sync/:store — read a single store
app.get('/api/sync/:store', (req, res) => {
  try {
    const data = readSyncFile(req.params.store);
    res.json({ ok: true, data: data?.data || data || [], updatedAt: data?._updatedAt || null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/sync/:store — write a single store (smart merge: never overwrite with empty)
app.post('/api/sync/:store', (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.data) return res.status(400).json({ ok: false, error: 'Missing data field' });

    const incomingData = Array.isArray(payload.data) ? payload.data : [];

    // Smart merge: don't let empty data overwrite existing data
    const existing = readSyncFile(req.params.store);
    const existingData = existing?.data || [];
    if (incomingData.length === 0 && Array.isArray(existingData) && existingData.length > 0) {
      console.log(`[Sync] Skipping empty write to ${req.params.store} — existing has ${existingData.length} items`);
      return res.json({ ok: true, skipped: true, reason: 'empty data would overwrite existing', updatedAt: existing._updatedAt });
    }

    // If incoming has data, merge with existing (deduplicate by id)
    let mergedData = incomingData;
    if (Array.isArray(existingData) && existingData.length > 0 && incomingData.length > 0) {
      const idMap = new Map();
      // Add existing first
      for (const item of existingData) {
        if (item.id) idMap.set(item.id, item);
      }
      // Incoming overwrites existing (newer data wins)
      for (const item of incomingData) {
        if (item.id) idMap.set(item.id, item);
      }
      mergedData = Array.from(idMap.values());
    }

    const storeData = { data: mergedData, _updatedAt: new Date().toISOString(), _source: payload._source || 'unknown' };
    writeSyncFile(req.params.store, storeData);
    console.log(`[Sync] Wrote ${req.params.store}: ${mergedData.length} items (from ${payload._source || 'unknown'})`);
    res.json({ ok: true, updatedAt: storeData._updatedAt, itemCount: mergedData.length });
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

// POST /api/sync/all — bulk sync all stores at once
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


// ══════════════════════════════════════════════════════════════════════════════
// ── Social Media Posting API ─────────────────────────────────────────────────
// Gods Eye uses these endpoints to post images/videos to social platforms.
// Credentials stored in ~/.klint/social-accounts.json (tokens per platform).
// ══════════════════════════════════════════════════════════════════════════════
const SOCIAL_ACCOUNTS_FILE = path.join(process.env.HOME || '', '.klint', 'social-accounts.json');

// ── Upload-Post API Proxy ────────────────────────────────────────────────────
const UPLOAD_POST_BASE = 'https://api.upload-post.com';

async function proxyUploadPost(req, res, method, apiPath, body) {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const url = `${UPLOAD_POST_BASE}${apiPath}`;
    const fetchOpts = {
      method,
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}`, 'Content-Type': 'application/json' },
    };
    if (body && method !== 'GET' && method !== 'HEAD') fetchOpts.body = JSON.stringify(body);
    const response = await fetch(url, fetchOpts);
    const data = await response.text();
    try { res.status(response.status).json(JSON.parse(data)); } catch { res.status(response.status).send(data); }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// Photo & video uploads use multipart/form-data — pipe raw request to Upload-Post API
async function proxyUploadPostMultipart(req, res, apiPath) {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const url = `${UPLOAD_POST_BASE}${apiPath}`;

    // Collect the raw body chunks (express.json() doesn't parse multipart)
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Apikey ${uploadPostApiKey}`,
            'Content-Type': req.headers['content-type'],  // Forward multipart boundary
            'Content-Length': String(rawBody.length),
          },
          body: rawBody,
        });
        const data = await response.text();
        try { res.status(response.status).json(JSON.parse(data)); } catch { res.status(response.status).send(data); }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.post('/api/upload-post/videos', (req, res) => proxyUploadPostMultipart(req, res, '/api/upload_videos'));
app.post('/api/upload-post/photos', (req, res) => proxyUploadPostMultipart(req, res, '/api/upload_photos'));
app.post('/api/upload-post/text', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload_text', req.body));
app.post('/api/upload-post/documents', (req, res) => proxyUploadPost(req, res, 'POST', '/api/upload-document', req.body));
app.get('/api/upload-post/status', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  proxyUploadPost(req, res, 'GET', `/api/uploadposts/status${qs}`);
});
// History — server-side filter by the caller's owned profiles
app.get('/api/upload-post/history', async (req, res) => {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const userId = callerUserId(req);
    const owned = new Set(await getOwnedUsernames(userId));
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const resp = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/history${qs}`, {
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}` },
    });
    const data = await resp.json().catch(() => ({}));
    if (Array.isArray(data?.history)) {
      data.history = data.history.filter(h => !h.profile || owned.has(h.profile));
    }
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[Upload-Post] history filter error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Schedule — server-side filter by the caller's owned profiles
app.get('/api/upload-post/schedule', async (req, res) => {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const userId = callerUserId(req);
    const owned = new Set(await getOwnedUsernames(userId));
    const resp = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/schedule`, {
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}` },
    });
    const data = await resp.json().catch(() => ({}));
    for (const key of ['scheduled_posts', 'schedule', 'posts']) {
      if (Array.isArray(data?.[key])) {
        data[key] = data[key].filter(p => !p.profile || owned.has(p.profile));
      }
    }
    res.status(resp.status).json(data);
  } catch (err) {
    console.error('[Upload-Post] schedule filter error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/upload-post/schedule/:jobId', (req, res) => proxyUploadPost(req, res, 'DELETE', `/api/uploadposts/schedule/${req.params.jobId}`));
app.patch('/api/upload-post/schedule/:jobId', (req, res) => proxyUploadPost(req, res, 'PATCH', `/api/uploadposts/schedule/${req.params.jobId}`, req.body));
app.get('/api/upload-post/queue/settings', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/queue/settings'));
app.post('/api/upload-post/queue/settings', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/queue/settings', req.body));
app.get('/api/upload-post/queue/preview', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/queue/preview'));
app.get('/api/upload-post/analytics/:username', (req, res) => proxyUploadPost(req, res, 'GET', `/api/analytics/${req.params.username}`));
app.get('/api/upload-post/post-analytics/:requestId', (req, res) => proxyUploadPost(req, res, 'GET', `/api/uploadposts/post-analytics/${req.params.requestId}`));
app.get('/api/upload-post/impressions/:username', (req, res) => proxyUploadPost(req, res, 'GET', `/api/uploadposts/total-impressions/${req.params.username}`));
app.get('/api/upload-post/facebook/pages', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; proxyUploadPost(req, res, 'GET', `/api/uploadposts/facebook/pages${qs}`); });
app.get('/api/upload-post/linkedin/pages', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; proxyUploadPost(req, res, 'GET', `/api/uploadposts/linkedin/pages${qs}`); });
app.get('/api/upload-post/pinterest/boards', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; proxyUploadPost(req, res, 'GET', `/api/uploadposts/pinterest/boards${qs}`); });
// ── User-scoped social profile management (Supabase-backed) ──────────────────
// Upload-Post hosts all profiles in a single shared workspace, so the server
// must filter responses down to the caller's owned profiles. Ownership lives
// in public.social_profile_owners (see supabase/social_profile_owners_migration.sql).
// We keep a local JSON fallback for offline-dev situations only.
const SOCIAL_PROFILE_OWNERS_FILE = path.join(SYNC_DIR, 'social-profile-owners.json');

async function getOwnedUsernames(userId) {
  if (!userId) return [];
  try {
    const rows = await supabaseRest(
      `social_profile_owners?user_id=eq.${encodeURIComponent(userId)}&select=upload_post_username`
    );
    if (Array.isArray(rows)) return rows.map(r => r.upload_post_username).filter(Boolean);
  } catch (err) {
    console.warn('[Upload-Post] Supabase owner lookup failed, falling back to local file:', err.message);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SOCIAL_PROFILE_OWNERS_FILE, 'utf-8'));
    return Array.isArray(raw?.[userId]) ? raw[userId] : [];
  } catch { return []; }
}

async function recordOwnership(userId, username) {
  if (!userId || !username) return;
  try {
    await supabaseRest('social_profile_owners', 'POST', {
      user_id: userId,
      upload_post_username: username,
    });
    return;
  } catch (err) {
    console.warn('[Upload-Post] Supabase owner insert failed, writing local fallback:', err.message);
  }
  try {
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(SOCIAL_PROFILE_OWNERS_FILE, 'utf-8')); } catch {}
    if (!Array.isArray(raw[userId])) raw[userId] = [];
    if (!raw[userId].includes(username)) raw[userId].push(username);
    fs.mkdirSync(path.dirname(SOCIAL_PROFILE_OWNERS_FILE), { recursive: true });
    fs.writeFileSync(SOCIAL_PROFILE_OWNERS_FILE, JSON.stringify(raw, null, 2));
  } catch (err) {
    console.error('[Upload-Post] Local owner write failed:', err.message);
  }
}

async function removeOwnership(userId, username) {
  if (!userId || !username) return;
  try {
    await supabaseRest(
      `social_profile_owners?user_id=eq.${encodeURIComponent(userId)}&upload_post_username=eq.${encodeURIComponent(username)}`,
      'DELETE'
    );
  } catch (err) {
    console.warn('[Upload-Post] Supabase owner delete failed:', err.message);
  }
  try {
    const raw = JSON.parse(fs.readFileSync(SOCIAL_PROFILE_OWNERS_FILE, 'utf-8'));
    if (Array.isArray(raw[userId])) {
      raw[userId] = raw[userId].filter(u => u !== username);
      fs.writeFileSync(SOCIAL_PROFILE_OWNERS_FILE, JSON.stringify(raw, null, 2));
    }
  } catch {}
}

function callerUserId(req) {
  return req.headers['x-user-id']
    || req.query?.user_id
    || req.body?.user_id
    || null;
}

// POST /api/upload-post/users — create profile and record ownership
app.post('/api/upload-post/users', async (req, res) => {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const userId = callerUserId(req);
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

    const { user_id: _omit, ...profileData } = req.body || {};
    const response = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
      method: 'POST',
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(profileData),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);

    const createdUsername = data?.profile?.username || data?.username || profileData?.username;
    if (createdUsername) {
      await recordOwnership(userId, createdUsername);
      console.log(`[Social] Mapped profile "${createdUsername}" → user ${userId}`);
    }
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Upload-Post] create profile error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/upload-post/users — returns ONLY the caller's owned profiles
app.get('/api/upload-post/users', async (req, res) => {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const userId = callerUserId(req);
    const owned = new Set(await getOwnedUsernames(userId));

    const response = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
      method: 'GET',
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}`, 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return res.status(response.status).json(data);

    if (Array.isArray(data?.profiles)) {
      data.profiles = data.profiles.filter(p => owned.has(p.username));
    } else if (Array.isArray(data?.data)) {
      data.data = data.data.filter(p => owned.has(p.username));
    } else if (Array.isArray(data?.users)) {
      data.users = data.users.filter(p => owned.has(p.username));
    } else if (Array.isArray(data)) {
      return res.status(response.status).json(data.filter(p => owned.has(p.username)));
    }
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Upload-Post] list profiles error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/upload-post/users — guard ownership, delete, drop mapping
app.delete('/api/upload-post/users', async (req, res) => {
  try {
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });
    const userId = callerUserId(req);
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });

    const { user_id: _omit, ...deleteData } = req.body || {};
    const username = deleteData?.username;
    if (!username) return res.status(400).json({ error: 'username required' });

    const owned = await getOwnedUsernames(userId);
    if (!owned.includes(username)) {
      return res.status(403).json({ error: 'You do not own this profile.' });
    }

    const response = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
      method: 'DELETE',
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(deleteData),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      await removeOwnership(userId, username);
      console.log(`[Social] Removed profile "${username}" from ownership mapping`);
    }
    res.status(response.status).json(data);
  } catch (error) {
    console.error('[Upload-Post] delete profile error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// One-time clean-slate wipe — see server.js for the full rationale. Same
// route is available in dev so local leaks can be nuked too.
app.post('/api/admin/upload-post/wipe', async (req, res) => {
  try {
    const expected = process.env.ADMIN_WIPE_SECRET;
    if (!expected) return res.status(503).json({ error: 'ADMIN_WIPE_SECRET not configured on server.' });
    if (req.headers['x-admin-secret'] !== expected) return res.status(403).json({ error: 'forbidden' });
    if (!uploadPostApiKey) return res.status(500).json({ error: 'UPLOAD_POST_API_KEY not configured' });

    const listResp = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
      headers: { 'Authorization': `Apikey ${uploadPostApiKey}` },
    });
    const listData = await listResp.json().catch(() => ({}));
    const profiles = Array.isArray(listData?.profiles) ? listData.profiles
                    : Array.isArray(listData) ? listData : [];
    const usernames = profiles.map(p => p.username).filter(Boolean);

    const results = { deleted: [], failed: [] };
    for (const username of usernames) {
      try {
        const delResp = await fetch(`${UPLOAD_POST_BASE}/api/uploadposts/users`, {
          method: 'DELETE',
          headers: { 'Authorization': `Apikey ${uploadPostApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ username }),
        });
        if (delResp.ok) results.deleted.push(username);
        else results.failed.push({ username, status: delResp.status });
      } catch (err) { results.failed.push({ username, error: err.message }); }
    }
    try { await supabaseRest('social_profile_owners?id=not.is.null', 'DELETE'); } catch {}
    try { fs.existsSync(SOCIAL_PROFILE_OWNERS_FILE) && fs.unlinkSync(SOCIAL_PROFILE_OWNERS_FILE); } catch {}

    res.json({ ok: true, ...results });
  } catch (error) {
    console.error('[Upload-Post] wipe error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/upload-post/users/generate-jwt', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/users/generate-jwt', req.body));
app.post('/api/upload-post/users/validate-jwt', (req, res) => proxyUploadPost(req, res, 'POST', '/api/uploadposts/users/validate-jwt', req.body));
app.get('/api/upload-post/me', (req, res) => proxyUploadPost(req, res, 'GET', '/api/uploadposts/me'));
app.get('/api/upload-post/media', (req, res) => { const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''; proxyUploadPost(req, res, 'GET', `/api/uploadposts/media${qs}`); });

function readSocialAccounts() {
  try { return JSON.parse(fs.readFileSync(SOCIAL_ACCOUNTS_FILE, 'utf-8')); } catch { return {}; }
}
function writeSocialAccounts(data) {
  const dir = path.dirname(SOCIAL_ACCOUNTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SOCIAL_ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Social accounts CRUD ─────────────────────────────────────────────────────
// GET /api/social/accounts — list all connected accounts
app.get('/api/social/accounts', (_req, res) => {
  const accounts = readSocialAccounts();
  // Strip tokens from response for safety
  const safe = {};
  for (const [platform, config] of Object.entries(accounts)) {
    safe[platform] = {
      connected: !!config.accessToken,
      username: config.username || null,
      pageId: config.pageId || null,
      pageName: config.pageName || null,
      connectedAt: config.connectedAt || null,
    };
  }
  res.json({ ok: true, accounts: safe });
});

// POST /api/social/accounts/:platform — store credentials for a platform
// Body: { accessToken, pageId?, username?, pageName?, ... }
app.post('/api/social/accounts/:platform', (req, res) => {
  try {
    const { platform } = req.params;
    const allowed = ['instagram', 'facebook', 'twitter', 'tiktok', 'linkedin'];
    if (!allowed.includes(platform)) return res.status(400).json({ ok: false, error: `Invalid platform: ${platform}` });

    const accounts = readSocialAccounts();
    accounts[platform] = { ...req.body, connectedAt: new Date().toISOString() };
    writeSocialAccounts(accounts);
    console.log(`[Social] Connected ${platform} account`);
    res.json({ ok: true, platform });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /api/social/accounts/:platform — disconnect a platform
app.delete('/api/social/accounts/:platform', (req, res) => {
  try {
    const accounts = readSocialAccounts();
    delete accounts[req.params.platform];
    writeSocialAccounts(accounts);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Post history log ─────────────────────────────────────────────────────────
const POST_LOG_FILE = path.join(process.env.HOME || '', '.klint', 'post-log.json');

function readPostLog() {
  try { return JSON.parse(fs.readFileSync(POST_LOG_FILE, 'utf-8')); } catch { return []; }
}
function appendPostLog(entry) {
  const log = readPostLog();
  log.unshift(entry); // newest first
  if (log.length > 500) log.length = 500; // cap at 500
  fs.writeFileSync(POST_LOG_FILE, JSON.stringify(log, null, 2), 'utf-8');
}

// GET /api/social/history — recent post history
app.get('/api/social/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const log = readPostLog().slice(0, limit);
  res.json({ ok: true, posts: log });
});

// ── Helper: download image from URL to buffer ────────────────────────────────
async function downloadImageBuffer(mediaUrl) {
  // Handle base64 data URLs
  if (mediaUrl.startsWith('data:')) {
    const match = mediaUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid data URL');
    return { buffer: Buffer.from(match[2], 'base64'), mimeType: match[1] };
  }
  // Handle HTTP URLs
  const resp = await fetch(mediaUrl, {
    headers: { 'User-Agent': 'KlintStudio/1.0' },
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  });
  if (!resp.ok) throw new Error(`Failed to download media: HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const mimeType = (resp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { buffer, mimeType };
}

// ══════════════════════════════════════════════════════════════════════════════
// ── POST /api/social/post — Universal social media posting endpoint ──────────
// Body: { platform, caption, mediaUrl, mediaType?, scheduledAt? }
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/social/post', async (req, res) => {
  const { platform, caption, mediaUrl, mediaType, scheduledAt } = req.body;

  if (!platform || !caption) {
    return res.status(400).json({ ok: false, error: 'platform and caption are required' });
  }

  const accounts = readSocialAccounts();
  const account = accounts[platform];

  if (!account || !account.accessToken) {
    return res.status(401).json({
      ok: false,
      error: `No ${platform} account connected. Add credentials via POST /api/social/accounts/${platform}`,
      needsAuth: true,
      platform,
    });
  }

  try {
    let result;

    switch (platform) {
      // ── Instagram (via Facebook Graph API) ──────────────────────────────
      case 'instagram': {
        const igUserId = account.igUserId || account.pageId;
        const token = account.accessToken;
        if (!igUserId) throw new Error('Instagram Business Account ID not configured. Set igUserId in account config.');

        let containerId;

        if (mediaUrl) {
          // Step 1: Create media container
          const containerResp = await fetch(
            `https://graph.facebook.com/v21.0/${igUserId}/media`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                image_url: mediaUrl,
                caption: caption,
                access_token: token,
              }),
            }
          );
          const containerData = await containerResp.json();
          if (containerData.error) throw new Error(`IG Container: ${containerData.error.message}`);
          containerId = containerData.id;

          // Step 2: Wait for container to be ready (poll)
          let ready = false;
          for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const statusResp = await fetch(
              `https://graph.facebook.com/v21.0/${containerId}?fields=status_code&access_token=${token}`
            );
            const statusData = await statusResp.json();
            if (statusData.status_code === 'FINISHED') { ready = true; break; }
            if (statusData.status_code === 'ERROR') throw new Error('IG media processing failed');
          }
          if (!ready) throw new Error('IG media processing timed out');

          // Step 3: Publish
          const publishResp = await fetch(
            `https://graph.facebook.com/v21.0/${igUserId}/media_publish`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                creation_id: containerId,
                access_token: token,
              }),
            }
          );
          const publishData = await publishResp.json();
          if (publishData.error) throw new Error(`IG Publish: ${publishData.error.message}`);
          result = { postId: publishData.id, url: `https://www.instagram.com/p/${publishData.id}/` };
        } else {
          throw new Error('Instagram requires a media URL');
        }
        break;
      }

      // ── Facebook Page Post ──────────────────────────────────────────────
      case 'facebook': {
        const pageId = account.pageId;
        const token = account.pageAccessToken || account.accessToken;
        if (!pageId) throw new Error('Facebook Page ID not configured. Set pageId in account config.');

        let endpoint, body;

        if (mediaUrl) {
          // Photo post
          endpoint = `https://graph.facebook.com/v21.0/${pageId}/photos`;
          body = { url: mediaUrl, caption: caption, access_token: token };
        } else {
          // Text-only post
          endpoint = `https://graph.facebook.com/v21.0/${pageId}/feed`;
          body = { message: caption, access_token: token };
        }

        if (scheduledAt) {
          body.published = false;
          body.scheduled_publish_time = Math.floor(new Date(scheduledAt).getTime() / 1000);
        }

        const fbResp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const fbData = await fbResp.json();
        if (fbData.error) throw new Error(`FB: ${fbData.error.message}`);
        result = { postId: fbData.id || fbData.post_id, url: `https://facebook.com/${fbData.id || fbData.post_id}` };
        break;
      }

      // ── Twitter / X (v2 API) ────────────────────────────────────────────
      case 'twitter': {
        const token = account.accessToken; // OAuth 2.0 Bearer or User token

        let mediaId = null;
        if (mediaUrl) {
          // Upload media via v1.1 media/upload (still required for v2 tweets)
          const { buffer, mimeType } = await downloadImageBuffer(mediaUrl);
          const base64 = buffer.toString('base64');

          // INIT
          const initResp = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              command: 'INIT',
              total_bytes: String(buffer.length),
              media_type: mimeType,
            }),
          });
          const initData = await initResp.json();
          if (initData.errors) throw new Error(`Twitter Upload INIT: ${JSON.stringify(initData.errors)}`);
          mediaId = initData.media_id_string;

          // APPEND
          const appendResp = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              command: 'APPEND',
              media_id: mediaId,
              segment_index: '0',
              media_data: base64,
            }),
          });
          if (!appendResp.ok) throw new Error(`Twitter Upload APPEND failed: ${appendResp.status}`);

          // FINALIZE
          const finalResp = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }),
          });
          const finalData = await finalResp.json();
          if (finalData.errors) throw new Error(`Twitter Upload FINALIZE: ${JSON.stringify(finalData.errors)}`);
        }

        // Post tweet via v2
        const tweetBody = { text: caption };
        if (mediaId) tweetBody.media = { media_ids: [mediaId] };

        const tweetResp = await fetch('https://api.twitter.com/2/tweets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(tweetBody),
        });
        const tweetData = await tweetResp.json();
        if (tweetData.errors) throw new Error(`Twitter: ${JSON.stringify(tweetData.errors)}`);
        result = { postId: tweetData.data?.id, url: `https://x.com/i/status/${tweetData.data?.id}` };
        break;
      }

      // ── LinkedIn ────────────────────────────────────────────────────────
      case 'linkedin': {
        const token = account.accessToken;
        const personUrn = account.personUrn || account.urn; // "urn:li:person:XXXXX"
        if (!personUrn) throw new Error('LinkedIn Person URN not configured. Set personUrn in account config.');

        let asset = null;
        if (mediaUrl) {
          // Step 1: Register upload
          const registerResp = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              registerUploadRequest: {
                recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
                owner: personUrn,
                serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
              },
            }),
          });
          const registerData = await registerResp.json();
          const uploadUrl = registerData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
          asset = registerData.value?.asset;
          if (!uploadUrl) throw new Error('LinkedIn upload registration failed');

          // Step 2: Upload image binary
          const { buffer } = await downloadImageBuffer(mediaUrl);
          const uploadResp = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}` },
            body: buffer,
          });
          if (!uploadResp.ok) throw new Error(`LinkedIn upload failed: ${uploadResp.status}`);
        }

        // Step 3: Create post
        const postBody = {
          author: personUrn,
          lifecycleState: 'PUBLISHED',
          specificContent: {
            'com.linkedin.ugc.ShareContent': {
              shareCommentary: { text: caption },
              shareMediaCategory: asset ? 'IMAGE' : 'NONE',
              ...(asset ? {
                media: [{
                  status: 'READY',
                  media: asset,
                }],
              } : {}),
            },
          },
          visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
        };

        const postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-Restli-Protocol-Version': '2.0.0',
          },
          body: JSON.stringify(postBody),
        });
        const postData = await postResp.json();
        if (postResp.status >= 400) throw new Error(`LinkedIn: ${JSON.stringify(postData)}`);
        result = { postId: postData.id || postResp.headers.get('x-restli-id'), url: 'https://www.linkedin.com/feed/' };
        break;
      }

      // ── TikTok (Content Posting API) ────────────────────────────────────
      case 'tiktok': {
        const token = account.accessToken;

        if (!mediaUrl) throw new Error('TikTok requires a media URL (video)');

        // Step 1: Initialize video upload
        const initResp = await fetch('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            post_info: { title: caption.slice(0, 150), privacy_level: 'SELF_ONLY' },
            source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
          }),
        });
        const initData = await initResp.json();
        if (initData.error?.code) throw new Error(`TikTok: ${initData.error.message}`);
        result = { publishId: initData.data?.publish_id, status: 'processing', note: 'TikTok processes videos asynchronously. Check status later.' };
        break;
      }

      default:
        return res.status(400).json({ ok: false, error: `Unsupported platform: ${platform}` });
    }

    // Log the post
    const logEntry = {
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      platform,
      caption: caption.slice(0, 200),
      mediaUrl: mediaUrl ? '(attached)' : null,
      result,
      timestamp: new Date().toISOString(),
      success: true,
    };
    appendPostLog(logEntry);

    console.log(`[Social] ✅ Posted to ${platform}: ${result.postId || result.publishId}`);
    res.json({ ok: true, platform, ...result });

  } catch (err) {
    console.error(`[Social] ❌ ${platform} post failed:`, err.message);

    // Log failure too
    appendPostLog({
      id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      platform,
      caption: caption?.slice(0, 200),
      error: err.message,
      timestamp: new Date().toISOString(),
      success: false,
    });

    res.status(500).json({ ok: false, error: err.message, platform });
  }
});

// ── POST /api/social/post-multi — Post to multiple platforms at once ─────────
app.post('/api/social/post-multi', async (req, res) => {
  const { platforms, caption, mediaUrl, mediaType, scheduledAt } = req.body;

  if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
    return res.status(400).json({ ok: false, error: 'platforms array is required' });
  }

  const results = {};
  const errors = {};

  await Promise.allSettled(
    platforms.map(async (platform) => {
      try {
        const resp = await fetch(`http://localhost:${PORT}/api/social/post`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ platform, caption, mediaUrl, mediaType, scheduledAt }),
        });
        const data = await resp.json();
        if (data.ok) results[platform] = data;
        else errors[platform] = data.error;
      } catch (err) {
        errors[platform] = err.message;
      }
    })
  );

  res.json({
    ok: Object.keys(errors).length === 0,
    results,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
  });
});

// ── OAuth helpers for social platforms ────────────────────────────────────────
// GET /api/social/auth/:platform/url — get OAuth authorization URL
app.get('/api/social/auth/:platform/url', (req, res) => {
  const { platform } = req.params;
  const accounts = readSocialAccounts();
  const config = accounts._oauth || {};

  switch (platform) {
    case 'instagram':
    case 'facebook': {
      const appId = config.facebookAppId || process.env.FACEBOOK_APP_ID;
      if (!appId) return res.status(400).json({ ok: false, error: 'FACEBOOK_APP_ID not configured' });
      const redirectUri = `http://localhost:${PORT}/api/social/auth/facebook/callback`;
      const scopes = platform === 'instagram'
        ? 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement'
        : 'pages_manage_posts,pages_read_engagement,pages_show_list';
      const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;
      res.json({ ok: true, url });
      break;
    }
    case 'twitter': {
      const clientId = config.twitterClientId || process.env.TWITTER_CLIENT_ID;
      if (!clientId) return res.status(400).json({ ok: false, error: 'TWITTER_CLIENT_ID not configured' });
      const redirectUri = `http://localhost:${PORT}/api/social/auth/twitter/callback`;
      const state = Math.random().toString(36).slice(2);
      const codeChallenge = state; // simplified — use PKCE in production
      const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=tweet.read%20tweet.write%20users.read%20offline.access&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=plain`;
      res.json({ ok: true, url });
      break;
    }
    case 'linkedin': {
      const clientId = config.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
      if (!clientId) return res.status(400).json({ ok: false, error: 'LINKEDIN_CLIENT_ID not configured' });
      const redirectUri = `http://localhost:${PORT}/api/social/auth/linkedin/callback`;
      const state = Math.random().toString(36).slice(2);
      const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=w_member_social%20r_liteprofile&state=${state}`;
      res.json({ ok: true, url });
      break;
    }
    default:
      res.status(400).json({ ok: false, error: `OAuth not supported for ${platform}` });
  }
});

// Facebook/Instagram OAuth callback
app.get('/api/social/auth/facebook/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const accounts = readSocialAccounts();
    const config = accounts._oauth || {};
    const appId = config.facebookAppId || process.env.FACEBOOK_APP_ID;
    const appSecret = config.facebookAppSecret || process.env.FACEBOOK_APP_SECRET;
    const redirectUri = `http://localhost:${PORT}/api/social/auth/facebook/callback`;

    // Exchange code for token
    const tokenResp = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`
    );
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(tokenData.error.message);

    // Get long-lived token
    const longResp = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longResp.json();
    const longToken = longData.access_token || tokenData.access_token;

    // Get user's pages
    const pagesResp = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${longToken}`);
    const pagesData = await pagesResp.json();
    const page = pagesData.data?.[0]; // First page

    if (page) {
      // Save Facebook page
      accounts.facebook = {
        accessToken: page.access_token,
        pageAccessToken: page.access_token,
        pageId: page.id,
        pageName: page.name,
        connectedAt: new Date().toISOString(),
      };

      // Check for Instagram Business Account
      const igResp = await fetch(
        `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      );
      const igData = await igResp.json();
      if (igData.instagram_business_account) {
        accounts.instagram = {
          accessToken: page.access_token,
          igUserId: igData.instagram_business_account.id,
          pageId: igData.instagram_business_account.id,
          pageName: page.name,
          connectedAt: new Date().toISOString(),
        };
      }
    }

    writeSocialAccounts(accounts);
    res.send(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px;">
        <h1>✅ Connected!</h1>
        <p>Facebook${accounts.instagram ? ' & Instagram' : ''} connected successfully.</p>
        <p>You can close this window.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  } catch (err) {
    console.error('[Social OAuth] Facebook callback error:', err);
    res.status(500).send(`<html><body><h1>❌ Error</h1><p>${err.message}</p></body></html>`);
  }
});

// Twitter OAuth callback
app.get('/api/social/auth/twitter/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const accounts = readSocialAccounts();
    const config = accounts._oauth || {};
    const clientId = config.twitterClientId || process.env.TWITTER_CLIENT_ID;
    const clientSecret = config.twitterClientSecret || process.env.TWITTER_CLIENT_SECRET;
    const redirectUri = `http://localhost:${PORT}/api/social/auth/twitter/callback`;

    const tokenResp = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code_verifier: req.query.state || '', // simplified PKCE
      }),
    });
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    // Get user info
    const meResp = await fetch('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const meData = await meResp.json();

    accounts.twitter = {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      username: meData.data?.username,
      connectedAt: new Date().toISOString(),
    };
    writeSocialAccounts(accounts);

    res.send(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px;">
        <h1>✅ Connected!</h1>
        <p>Twitter/X (@${meData.data?.username}) connected successfully.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  } catch (err) {
    console.error('[Social OAuth] Twitter callback error:', err);
    res.status(500).send(`<html><body><h1>❌ Error</h1><p>${err.message}</p></body></html>`);
  }
});

// LinkedIn OAuth callback
app.get('/api/social/auth/linkedin/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code parameter');

  try {
    const accounts = readSocialAccounts();
    const config = accounts._oauth || {};
    const clientId = config.linkedinClientId || process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = config.linkedinClientSecret || process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = `http://localhost:${PORT}/api/social/auth/linkedin/callback`;

    const tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    const tokenData = await tokenResp.json();
    if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

    // Get profile
    const meResp = await fetch('https://api.linkedin.com/v2/me', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` },
    });
    const meData = await meResp.json();

    accounts.linkedin = {
      accessToken: tokenData.access_token,
      personUrn: `urn:li:person:${meData.id}`,
      username: `${meData.localizedFirstName} ${meData.localizedLastName}`,
      connectedAt: new Date().toISOString(),
    };
    writeSocialAccounts(accounts);

    res.send(`
      <html><body style="font-family:system-ui;text-align:center;padding:60px;">
        <h1>✅ Connected!</h1>
        <p>LinkedIn (${meData.localizedFirstName}) connected successfully.</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  } catch (err) {
    console.error('[Social OAuth] LinkedIn callback error:', err);
    res.status(500).send(`<html><body><h1>❌ Error</h1><p>${err.message}</p></body></html>`);
  }
});


// ═══════════════════════════════════════════════════════════════════════
// SKILLS MARKETPLACE PROXY (skills.sh has CORS restrictions)
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/skills/search', async (req, res) => {
  const q = req.query.q || 'claude';
  const limit = req.query.limit || 20;
  try {
    const r = await fetch(`https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=${limit}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/skills/readme', async (req, res) => {
  const source = req.query.source; // "owner/repo"
  if (!source) return res.status(400).json({ error: 'source required' });
  try {
    const [owner, repo] = source.split('/');
    let r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/SKILL.md`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`, { signal: AbortSignal.timeout(10000) });
    const text = r.ok ? await r.text() : '';
    res.json({ content: text });
  } catch (err) {
    res.json({ content: '' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// CRON JOBS — Native in-process scheduler (node-cron)
// Scoped per-user and per-brand. Does NOT handle posting (upload-post.com has its own scheduler).
// This cron handles: research, creative generation, analytics, strategy.
// ═══════════════════════════════════════════════════════════════════════
import cron from 'node-cron';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// In-memory cron tasks keyed by job ID
const activeCronTasks = new Map();

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

// Execute a cron job — calls Gemini with the job's prompt
async function executeCronJob(job) {
  console.log(`[Cron] ▶ Executing job "${job.name}" (${job.id}) for user ${job.user_id}`);
  const startedAt = new Date().toISOString();

  try {
    // Build system context with brand info if brand_id is set
    let brandContext = '';
    if (job.brand_id) {
      try {
        const brands = await supabaseRest(`brand_profiles?id=eq.${job.brand_id}&select=*`);
        if (brands && brands[0]) {
          const b = brands[0];
          brandContext = `\nBrand Context: ${b.name || ''}, Industry: ${b.industry || ''}, Tone: ${b.tone || ''}, Audience: ${b.audience || ''}, Colors: ${JSON.stringify(b.colors || [])}, Tagline: ${b.tagline || ''}`;
        }
      } catch (e) { console.warn('[Cron] Brand fetch failed:', e.message); }
    }

    // Call Gemini
    const model = 'gemini-2.5-flash';
    const systemPrompt = `You are Gods Eye, an AI creative studio agent running an automated scheduled task.
This task belongs to user ${job.user_id}${job.brand_id ? ` for brand ${job.brand_id}` : ''}.${brandContext}

IMPORTANT: You are running autonomously. Be thorough and produce actionable results.
Do NOT mention you are an AI. Produce the output directly.
Task type: ${job.task_type || 'research'}
Current time: ${new Date().toISOString()}`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\nTask: ${job.config?.prompt || job.name}` }] },
        ],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
      }),
    });

    if (!geminiRes.ok) throw new Error(`Gemini API: ${geminiRes.status}`);
    const geminiData = await geminiRes.json();
    const resultText = geminiData.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || 'No output';

    // Extract search sources if available
    const chunks = geminiData.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks.filter(c => c.web).map(c => ({ title: c.web.title, url: c.web.uri }));

    // Log execution
    await supabaseRest('cron_executions', 'POST', {
      job_id: job.id,
      user_id: job.user_id,
      status: 'success',
      result: { text: resultText, sources },
    }).catch(e => console.warn('[Cron] Execution log failed:', e.message));

    // Save as content brief if it's a research job
    if (job.task_type === 'research' || job.task_type === 'strategy') {
      await supabaseRest('content_briefs', 'POST', {
        user_id: job.user_id,
        brand_id: job.brand_id,
        type: job.task_type,
        title: job.name,
        content: { text: resultText, sources },
        status: 'pending',
      }).catch(e => console.warn('[Cron] Brief save failed:', e.message));
    }

    // Update last_run
    await supabaseRest(`cron_jobs?id=eq.${job.id}`, 'PATCH', {
      last_run_at: new Date().toISOString(),
    });

    // Push result to chat if job has a conversation_id
    const conversationId = job.config?.conversation_id;
    if (conversationId) {
      try {
        const pendingFile = path.join(SYNC_DIR, 'cron_chat_pending.json');
        let pending = [];
        try { pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8')); } catch { pending = []; }
        pending.push({
          id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          conversationId,
          role: 'model',
          content: `**Scheduled Task: ${job.name}** completed\n\n${resultText}`,
          timestamp: Date.now(),
          isCronResult: true,
          userId: job.user_id,
        });
        fs.writeFileSync(pendingFile, JSON.stringify(pending, null, 2), 'utf-8');
        console.log(`[Cron] Pushed result to chat for conversation ${conversationId.slice(0, 8)}...`);
      } catch (e) { console.warn('[Cron] Chat push failed:', e.message); }
    }

    console.log(`[Cron] ✅ Job "${job.name}" completed successfully`);
  } catch (err) {
    console.error(`[Cron] ❌ Job "${job.name}" failed:`, err.message);
    await supabaseRest('cron_executions', 'POST', {
      job_id: job.id,
      user_id: job.user_id,
      status: 'failed',
      error_message: err.message,
    }).catch(() => {});
    await supabaseRest(`cron_jobs?id=eq.${job.id}`, 'PATCH', {
      last_run_at: new Date().toISOString(),
    }).catch(() => {});
  }
}

// Schedule a single cron job in memory
function scheduleJob(job) {
  if (activeCronTasks.has(job.id)) {
    activeCronTasks.get(job.id).stop();
    activeCronTasks.delete(job.id);
  }
  if (!job.enabled || !cron.validate(job.cron_expression)) return;

  const task = cron.schedule(job.cron_expression, () => executeCronJob(job), { timezone: job.timezone || 'Asia/Kolkata' });
  activeCronTasks.set(job.id, task);
  console.log(`[Cron] 📅 Scheduled "${job.name}" — ${job.cron_expression}`);
}

// Load all active jobs from DB on startup
async function loadCronJobs() {
  try {
    const jobs = await supabaseRest('cron_jobs?enabled=eq.true&select=*');
    if (!jobs) { console.log('[Cron] ⚠ No Supabase — skipping job load'); return; }
    console.log(`[Cron] Loading ${jobs.length} active jobs`);
    jobs.forEach(scheduleJob);
  } catch (err) {
    console.error('[Cron] Failed to load jobs:', err.message);
  }
}

// ── Cron API Routes ──────────────────────────────────────────────────────────

// List all jobs for a user
app.get('/api/cron/jobs', async (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: 'user_id required' });
  try {
    const jobs = await supabaseRest(`cron_jobs?user_id=eq.${userId}&order=created_at.desc&select=*`);
    res.json(jobs || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new cron job
app.post('/api/cron/jobs', async (req, res) => {
  const { user_id, brand_id, name, prompt, cron_expression, agent_type, timezone, conversation_id } = req.body;
  if (!user_id || !name || !cron_expression) {
    return res.status(400).json({ error: 'user_id, name, cron_expression required' });
  }
  if (!cron.validate(cron_expression)) {
    return res.status(400).json({ error: `Invalid cron: "${cron_expression}"` });
  }
  try {
    const jobConfig = { prompt: prompt || name };
    // Store conversation_id so cron results can be pushed back to chat
    if (conversation_id) jobConfig.conversation_id = conversation_id;

    const [job] = await supabaseRest('cron_jobs', 'POST', {
      user_id,
      brand_id: brand_id || null,
      name,
      cron_expression,
      task_type: agent_type || 'research',
      timezone: timezone || 'Asia/Kolkata',
      enabled: true,
      config: jobConfig,
    }, { 'Prefer': 'return=representation' });
    scheduleJob(job);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a cron job
app.patch('/api/cron/jobs/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  try {
    await supabaseRest(`cron_jobs?id=eq.${id}`, 'PATCH', updates);
    // Reload the job
    const [updated] = await supabaseRest(`cron_jobs?id=eq.${id}&select=*`);
    if (updated) scheduleJob(updated);
    res.json(updated || { success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a cron job
app.delete('/api/cron/jobs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (activeCronTasks.has(id)) {
      activeCronTasks.get(id).stop();
      activeCronTasks.delete(id);
    }
    await supabaseRest(`cron_jobs?id=eq.${id}`, 'DELETE');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle active/inactive
app.post('/api/cron/jobs/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const [job] = await supabaseRest(`cron_jobs?id=eq.${id}&select=*`);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const newActive = !job.enabled;
    await supabaseRest(`cron_jobs?id=eq.${id}`, 'PATCH', { enabled: newActive });
    job.enabled = newActive;
    scheduleJob(job);
    res.json({ ...job, enabled: newActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Execute a job manually (run now)
app.post('/api/cron/jobs/:id/run', async (req, res) => {
  const { id } = req.params;
  try {
    const [job] = await supabaseRest(`cron_jobs?id=eq.${id}&select=*`);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    // Run async — don't wait for completion
    executeCronJob(job);
    res.json({ success: true, message: `Job "${job.name}" started` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get execution history for a job
app.get('/api/cron/executions', async (req, res) => {
  const { job_id, user_id, limit = 20 } = req.query;
  try {
    let query = 'cron_executions?order=executed_at.desc';
    if (job_id) query += `&job_id=eq.${job_id}`;
    if (user_id) query += `&user_id=eq.${user_id}`;
    query += `&limit=${limit}&select=*`;
    const execs = await supabaseRest(query);
    res.json(execs || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending cron chat results for a user — returns messages and clears them
app.get('/api/cron/chat-pending', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });
  try {
    const pendingFile = path.join(SYNC_DIR, 'cron_chat_pending.json');
    let pending = [];
    try { pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8')); } catch { pending = []; }

    // Filter to only this user's results
    const userResults = pending.filter(m => m.userId === user_id);
    const remaining = pending.filter(m => m.userId !== user_id);

    // Clear consumed results
    if (userResults.length > 0) {
      fs.writeFileSync(pendingFile, JSON.stringify(remaining, null, 2), 'utf-8');
    }

    res.json({ ok: true, messages: userResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get content briefs
app.get('/api/cron/briefs', async (req, res) => {
  const { user_id, brand_id, limit = 20 } = req.query;
  try {
    let query = 'content_briefs?order=created_at.desc';
    if (user_id) query += `&user_id=eq.${user_id}`;
    if (brand_id) query += `&brand_id=eq.${brand_id}`;
    query += `&limit=${limit}&select=*`;
    const briefs = await supabaseRest(query);
    res.json(briefs || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// ═══════════════════════════════════════════════════════════════════════

// ── Agent Pipeline Routes ──────────────────────────────────────────
import { executeScout } from './services/scoutAgent.js';
import { executePriya } from './services/priyaAgent.js';
import { executeReview, handleSlackAction, handleSlackViewSubmission, getReviewStatus, updateReviewDecision, finalizeApproval, syncDashboardDecisionToSlack, runRegeneration } from './services/reviewAgent.js';
import { kickOffReelVideoInBackground } from './services/klingReelService.js';
import {
  isSlackOAuthConfigured,
  buildInstallUrl as buildSlackInstallUrl,
  decodeState as decodeSlackState,
  exchangeCodeForToken as exchangeSlackCode,
  saveBrandSlackIntegration,
  getBrandSlackIntegration,
  deleteBrandSlackIntegration,
} from './services/slackIntegrationService.js';
import { executeDispatch } from './services/dispatchAgent.js';
import { executeKarma } from './services/karmaAgent.js';

// Run individual agent
app.post('/api/pipeline/run-agent', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.body.user_id;
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const { agent_id, brand_id, brand, config } = req.body;
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });
    if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

    console.log(`[Pipeline] Running agent: ${agent_id} for brand ${brand_id} (brand payload: ${brand ? 'yes' : 'no'})`);

    // If frontend sent the brand directly, persist it to the sync file NOW so downstream agents can find it
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
        const existingLocal = idx >= 0 ? syncData.data[idx] : {};
        // CRITICAL: Server-only fields written by agents (scout_report,
        // scout_report_history, priya_campaign) are NOT round-tripped to the
        // client's IndexedDB. So when the client posts its brand on the next
        // run-agent call, these fields would be `undefined` in `brand` and a
        // naive `{...existing, ...brand}` would erase them — which is exactly
        // why Priya was failing with "No Scout research found" right after
        // an Approve & Continue. We explicitly preserve the existing local
        // values for these fields when the client doesn't carry them.
        const merged = {
          ...existingLocal,
          ...brand,
          scout_report: brand.scout_report || existingLocal.scout_report,
          scout_report_history: brand.scout_report_history || existingLocal.scout_report_history,
          priya_campaign: brand.priya_campaign || existingLocal.priya_campaign,
          user_id: brand.user_id || userId,
          updated_at: new Date().toISOString(),
        };
        if (idx >= 0) syncData.data[idx] = merged;
        else syncData.data.push(merged);
        syncData._updatedAt = new Date().toISOString();
        fs.writeFileSync(brandsFile, JSON.stringify(syncData, null, 2), 'utf-8');
        console.log(`[Pipeline] Synced brand "${brand.name}" (${brand.id}) to local file (scout_report ${merged.scout_report ? 'preserved' : 'absent'})`);
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
      res.json({ ok: true, text: `Review: ${result.decision} (${result.approved_count} approved, ${result.rejected_count} rejected)`, result });
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

// Download scout report
app.get('/api/pipeline/scout-report/:filename', (req, res) => {
  try {
    const docsDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.klint', 'scout-reports');
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

// Reject Scout report with written feedback → re-runs Step 2 + Step 3 only,
// reusing the existing scrape data (no Apify credits spent). Returns a new
// report that once again sits in awaiting_approval so the user can review.
app.post('/api/pipeline/scout/reject', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!userId) return res.status(401).json({ error: 'x-user-id header required' });
    const { brand_id, feedback } = req.body || {};
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });
    if (!feedback || !feedback.trim()) return res.status(400).json({ error: 'feedback required' });

    const { regenerateScoutReport } = await import('./services/scoutAgent.js');
    const result = await regenerateScoutReport(userId, brand_id, feedback.trim());
    res.json({ ok: true, result });
  } catch (err) {
    console.error('[Scout reject] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get Priya's progress (per-brand)
app.get('/api/pipeline/priya-progress/:brandId', (req, res) => {
  const data = readSyncFile(`priya_progress_${req.params.brandId}`);
  if (!data) return res.json({ ok: true, progress: null });
  res.json({ ok: true, progress: data?.data || data });
});

// Get pipeline runs (placeholder — reads from content_briefs for now)
app.get('/api/pipeline/runs', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.user_id;
    if (!userId) return res.status(401).json({ error: 'x-user-id required' });
    const brandId = req.query.brand_id;
    let query = `content_briefs?user_id=eq.${userId}&created_by=eq.scout_agent&order=created_at.desc&limit=10`;
    if (brandId) query += `&brand_id=eq.${brandId}`;
    const briefs = await supabaseRest(query);
    const runs = (briefs || []).map(b => {
      let summary = {};
      try { summary = JSON.parse(b.trend_summary || '{}'); } catch {}
      return {
        id: b.id, user_id: b.user_id, brand_id: b.brand_id,
        status: b.status === 'completed' ? 'completed' : 'running',
        current_stage: 'scout', started_at: b.created_at, completed_at: b.created_at,
        stage_summary: { scout: { briefs: summary.content_pillars || 0, filename: summary.filename } },
        created_at: b.created_at,
      };
    });
    res.json({ ok: true, runs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/pipeline/runs/:runId/stages', (req, res) => {
  res.json({ ok: true, stages: [] });
});

// ── Review status polling (frontend polls this after starting review) ──────
app.get('/api/pipeline/review-status/:reviewId', (req, res) => {
  const status = getReviewStatus(req.params.reviewId);
  res.json({ ok: true, ...status });
});

// ── Slack Interactions Webhook (receives button clicks via ngrok) ──────────
// Slack sends application/x-www-form-urlencoded with a `payload` field containing JSON
import { urlencoded } from 'express';
// ── Slack OAuth ──────────────────────────────────────────────────────────
app.get('/api/slack/install', (req, res) => {
  if (!isSlackOAuthConfigured()) {
    return res.status(503).send('Slack OAuth not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in Cloud Run env.');
  }
  const brandId = String(req.query.brand_id || '');
  const userId = String(req.query.user_id || req.headers['x-user-id'] || '');
  if (!brandId || !userId) return res.status(400).send('brand_id and user_id required');
  res.redirect(buildSlackInstallUrl(brandId, userId));
});

app.get('/api/slack/oauth/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const stateB64 = String(req.query.state || '');
    if (!code) return res.status(400).send('Missing code');
    const state = decodeSlackState(stateB64);
    if (!state?.brandId || !state?.userId) return res.status(400).send('Invalid state');
    const oauth = await exchangeSlackCode(code);
    await saveBrandSlackIntegration(state.userId, state.brandId, oauth);
    const base = process.env.APP_BASE_URL || 'http://localhost:3002';
    res.redirect(`${base}/?slack_connected=1&brand=${encodeURIComponent(state.brandId)}`);
  } catch (err) {
    console.error('[Slack OAuth] callback error:', err.message);
    res.status(500).send(`Slack OAuth failed: ${err.message}`);
  }
});

app.get('/api/slack/integration', async (req, res) => {
  try {
    const brandId = String(req.query.brand_id || '');
    if (!brandId) return res.status(400).json({ error: 'brand_id required' });
    const row = await getBrandSlackIntegration(brandId);
    if (!row) return res.json({ ok: true, connected: false });
    res.json({
      ok: true,
      connected: true,
      team_name: row.slack_team_name,
      channel_name: row.slack_channel_name,
      installed_at: row.installed_at,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/slack/integration', async (req, res) => {
  try {
    const brandId = String(req.query.brand_id || '');
    if (!brandId) return res.status(400).json({ error: 'brand_id required' });
    await deleteBrandSlackIntegration(brandId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/slack/interactions', urlencoded({ extended: false }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body.payload || '{}');
    console.log(`[Slack] ${payload.type} from @${payload.user?.username || '?'}: ${payload.actions?.[0]?.action_id || payload.view?.callback_id || '?'}`);

    if (payload.type === 'view_submission') {
      const result = await handleSlackViewSubmission(payload);
      return res.status(200).json(result || { response_action: 'clear' });
    }

    handleSlackAction(payload).catch(err =>
      console.error('[Slack] handleSlackAction failed:', err.message)
    );
    res.status(200).send(''); // Slack expects 200 within 3 seconds
  } catch (err) {
    console.error('[Slack] Interaction error:', err.message);
    res.status(200).send('');
  }
});

// ── Approval Queue (local sync file based) ─────────────────────────────
app.get('/api/approval-queue', (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || req.query.user_id;
    const brandId = req.query.brand_id;
    const status = req.query.status || 'pending';
    const limit = Math.min(1000, Math.max(1, parseInt(String(req.query.limit || '200'), 10) || 200));

    const queueFile = readSyncFile('approval_queue');
    let items = queueFile?.data || [];

    if (brandId) items = items.filter(i => i.brand_id === brandId);
    if (status && status !== 'all') items = items.filter(i => i.status === status);

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json({ ok: true, items: items.slice(0, limit), total: items.length });
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

    // Also update the content slot status
    const slotsFile = readSyncFile('content_slots');
    const slots = slotsFile?.data || [];
    const slotIdx = slots.findIndex(s => s.id === items[idx].slot_id);
    if (slotIdx >= 0) {
      slots[slotIdx].status = 'approved';
      slots[slotIdx].approved = true;
      slots[slotIdx].generated_image = items[idx].generated_image || slots[slotIdx].generated_image;
      slots[slotIdx].updated_at = new Date().toISOString();
      // Auto-schedule on approve: 9 AM UTC on the calendar slot_date,
      // or +24h if that date is in the past. Dispatch reads scheduled_at.
      if (!slots[slotIdx].scheduled_at) {
        try {
          const [y, m, d] = String(slots[slotIdx].slot_date || '').split('-').map(Number);
          let when = (y && m && d) ? new Date(Date.UTC(y, m - 1, d, 9, 0, 0)) : null;
          if (!when || isNaN(when.getTime()) || when.getTime() < Date.now()) {
            when = new Date(Date.now() + 24 * 60 * 60 * 1000);
            when.setUTCHours(9, 0, 0, 0);
          }
          slots[slotIdx].scheduled_at = when.toISOString();
        } catch { /* dispatch will fall back to immediate publish */ }
      }
      writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });

      // Mirror final scheduled_at + slot_date back to the queue item so
      // calendar tooltips, queue UI, and Slack messages all agree.
      items[idx].scheduled_at = slots[slotIdx].scheduled_at;
      items[idx].slot_date = slots[slotIdx].slot_date;

      // Reels need motion. Kick off Kling 3.0 image-to-video in background.
      const approvedSlot = slots[slotIdx];
      if (approvedSlot.format === 'reel' && approvedSlot.generated_image && !approvedSlot.generated_video) {
        const motionPrompt = [
          approvedSlot.brief?.image_prompt,
          approvedSlot.brief?.visual_direction,
        ].filter(Boolean).join('. ') || approvedSlot.idea || 'cinematic motion';
        kickOffReelVideoInBackground({
          slotId: approvedSlot.id,
          imageUrl: approvedSlot.generated_image,
          prompt: motionPrompt,
          aspectRatio: '9:16',
          readSyncFile,
          writeSyncFile,
        });
      }
    }

    // Persist the queue file once now that scheduled_at + slot_date are mirrored.
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });

    // If this queue item is part of an active review batch, feed the decision
    // into the reviewAgent so per-platform threshold logic can fire.
    const batchId = items[idx].review_batch_id || items[idx].review_id;
    if (batchId) {
      try { updateReviewDecision(batchId, items[idx].id, 'approve', null); }
      catch (e) { console.warn('[ApprovalQueue] updateReviewDecision (approve) failed:', e.message); }
    }

    // Two-way sync: mirror dashboard approval onto the Slack message.
    if (items[idx].slack_message_ts) {
      syncDashboardDecisionToSlack(items[idx], 'approve', {
        scheduledAt: items[idx].scheduled_at,
      }).catch(() => {});
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

    const reason = req.body?.reason || '';
    items[idx].status = 'rejected';
    items[idx].reviewer_notes = reason;
    items[idx].resolved_at = new Date().toISOString();
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });

    const batchId = items[idx].review_batch_id || items[idx].review_id;
    if (batchId) {
      try { updateReviewDecision(batchId, items[idx].id, 'reject', reason); }
      catch (e) { console.warn('[ApprovalQueue] updateReviewDecision (reject) failed:', e.message); }
    }

    if (items[idx].slack_message_ts) {
      syncDashboardDecisionToSlack(items[idx], 'reject', { feedback: reason }).catch(() => {});
    }

    res.json({ ok: true, rejected: items[idx].slot_id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Per-platform review status for live progress in dashboard
app.get('/api/pipeline/review-platform-status/:reviewId', (req, res) => {
  try {
    const status = getReviewStatus(req.params.reviewId);
    res.json({ ok: true, ...status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/approval-queue/:id/schedule — set scheduled_at on the linked slot
app.put('/api/approval-queue/:id/schedule', (req, res) => {
  try {
    const { scheduled_at } = req.body || {};
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at required' });
    const iso = new Date(scheduled_at).toISOString();
    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Item not found' });
    items[idx].scheduled_at = iso;
    items[idx].slot_date = iso.slice(0, 10);
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });
    if (items[idx].slot_id) {
      const slotsFile = readSyncFile('content_slots');
      const slots = slotsFile?.data || [];
      const sIdx = slots.findIndex(s => s.id === items[idx].slot_id);
      if (sIdx >= 0) {
        slots[sIdx].scheduled_at = iso;
        slots[sIdx].slot_date = iso.slice(0, 10);
        slots[sIdx].updated_at = new Date().toISOString();
        writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
      }
    }
    res.json({ ok: true, scheduled_at: iso });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/approval-queue/auto-schedule — bulk auto-fill optimal times
app.post('/api/approval-queue/auto-schedule', (req, res) => {
  try {
    const { brand_id } = req.body || {};
    if (!brand_id) return res.status(400).json({ error: 'brand_id required' });
    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const slotsFile = readSyncFile('content_slots');
    const slots = slotsFile?.data || [];
    const TIME_SLOTS = [9, 12, 18];
    let updated = 0;
    items.forEach((item, i) => {
      if (item.brand_id !== brand_id || item.status !== 'pending') return;
      const [y, m, d] = String(item.slot_date || '').split('-').map(Number);
      if (!y || !m || !d) return;
      const hour = TIME_SLOTS[i % TIME_SLOTS.length];
      const iso = new Date(Date.UTC(y, m - 1, d, hour, 0, 0)).toISOString();
      item.scheduled_at = iso;
      const sIdx = slots.findIndex(s => s.id === item.slot_id);
      if (sIdx >= 0) {
        slots[sIdx].scheduled_at = iso;
        slots[sIdx].updated_at = new Date().toISOString();
      }
      updated++;
    });
    writeSyncFile('approval_queue', { _updatedAt: new Date().toISOString(), data: items });
    writeSyncFile('content_slots', { _updatedAt: new Date().toISOString(), data: slots });
    res.json({ ok: true, scheduled: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/approval-queue/:id/update — edit a card's caption/hashtags/image.
// If the item is `rejected` when edited, auto-flip back to `pending`
// (rejected→edit→resubmit cycle). reviewer_notes preserved as context.
app.put('/api/approval-queue/:id/update', async (req, res) => {
  try {
    const { caption, hashtags, image, hook, call_to_action } = req.body || {};
    const queueFile = readSyncFile('approval_queue');
    const items = queueFile?.data || [];
    const idx = items.findIndex(i => i.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Item not found' });
    const item = items[idx];
    const oldBrief = item.brief || {};
    const newBrief = { ...oldBrief };
    if (typeof caption === 'string') newBrief.caption = caption;
    if (Array.isArray(hashtags)) newBrief.hashtags = hashtags.map(t => String(t).replace(/^#+/, ''));
    if (typeof hook === 'string') newBrief.hook = hook;
    if (typeof call_to_action === 'string') newBrief.call_to_action = call_to_action;

    const wasRejected = item.status === 'rejected';
    const nowIso = new Date().toISOString();
    items[idx] = {
      ...item,
      brief: newBrief,
      caption_preview: (newBrief.caption || '').slice(0, 200),
      ...(typeof image === 'string' && image ? { generated_image: image } : {}),
      ...(wasRejected ? {
        status: 'pending',
        resolved_at: null,
        resubmitted_at: nowIso,
        resubmitted_count: (item.resubmitted_count || 0) + 1,
      } : {}),
    };
    writeSyncFile('approval_queue', { _updatedAt: nowIso, data: items });

    // Mirror into content_slots so the calendar reflects the edit
    if (item.slot_id) {
      const slotsFile = readSyncFile('content_slots');
      const slots = slotsFile?.data || [];
      const sIdx = slots.findIndex(s => s.id === item.slot_id);
      if (sIdx >= 0) {
        slots[sIdx] = {
          ...slots[sIdx],
          brief: newBrief,
          ...(typeof image === 'string' && image ? { generated_image: image } : {}),
          ...(wasRejected ? { status: 'briefed' } : {}),
          updated_at: nowIso,
        };
        writeSyncFile('content_slots', { _updatedAt: nowIso, data: slots });
      }
    }

    if (wasRejected && items[idx].slack_message_ts && items[idx].slack_channel_id) {
      try { await syncDashboardDecisionToSlack(items[idx], 'resubmitted', null); }
      catch (err) { console.warn('[ApprovalQueue] Slack resubmit sync failed:', err.message); }
    }

    res.json({ ok: true, item: items[idx] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/approval-queue/:id/regenerate — see server.js for details
app.put('/api/approval-queue/:id/regenerate', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const { prompt, reference_image_base64 } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    if (reference_image_base64 && typeof reference_image_base64 === 'string') {
      const approxBytes = Math.floor(reference_image_base64.length * 0.75);
      if (approxBytes > 5 * 1024 * 1024) {
        return res.status(413).json({ error: 'Reference image exceeds 5 MB limit' });
      }
    }
    const triggeredBy = req.headers['x-user-id'] || 'dashboard';
    const updated = await runRegeneration({
      queueId: req.params.id,
      prompt: prompt.trim(),
      referenceImageDataUrl: reference_image_base64 || null,
      triggeredBy,
    });
    res.json({ ok: true, item: updated });
  } catch (err) {
    console.error('[ApprovalQueue] regenerate failed:', err.message);
    res.status(500).json({ error: err.message });
  }
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

// ── MCP SSE Server ──
mountMcpEndpoints(app, { port: PORT });

const server = app.listen(PORT, () => {
  console.log(`✅ Dev API server running on http://localhost:${PORT}`);
  console.log(`✅ Gemini API key loaded:`, !!apiKey);
  console.log(`✅ fal.ai API key loaded:`, !!falKey);
  console.log(`✅ Sync API: /api/sync/*`);
  console.log(`✅ Social API: /api/social/*`);
  console.log(`✅ Cron API: /api/cron/*`);
  console.log(`✅ Connectors API: /api/connectors/*`);
  console.log(`✅ Pipeline API: /api/pipeline/*`);
  // Load cron jobs after server starts
  setTimeout(loadCronJobs, 2000);
});

// Extend HTTP timeouts so long-running agent calls (Priya 3-min Gemini) don't get killed
server.headersTimeout = 600000;      // 10 min
server.requestTimeout = 600000;       // 10 min
server.keepAliveTimeout = 120000;     // 2 min
server.timeout = 600000;              // 10 min socket timeout (not 0 — that can hang on some Node versions)

// Global error handler to prevent server crash on unhandled promises
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
});

