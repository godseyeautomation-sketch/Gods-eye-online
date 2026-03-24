import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ── fal.ai proxy plugin ────────────────────────────────────────────────────
// Handles two routes inside Vite (no separate server needed):
//   /api/fal/*         → https://queue.fal.run/{path}   (queue API — submit/status/result)
//   /api/fal-storage/* → https://rest.fal.ai/{path}     (storage upload initiate)
// FAL_KEY is added server-side; never exposed to the browser.
function falProxyPlugin(falKey: string): Plugin {
  const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const proxyTo = async (
    req: IncomingMessage,
    res: ServerResponse,
    targetUrl: string,
    isJsonResponse = true,
  ) => {
    if (!falKey) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'FAL_KEY not set in .env file.' }));
      return;
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const bodyBuf = hasBody ? await readBody(req) : null;
    console.log(`[fal proxy] ${req.method} ${targetUrl}`);

    try {
      const falRes = await fetch(targetUrl, {
        method: req.method,
        headers: {
          'Authorization': `Key ${falKey}`,
          'Content-Type': 'application/json',
        },
        ...(bodyBuf ? { body: bodyBuf.toString('utf8') } : {}),
      });

      const text = await falRes.text();
      res.writeHead(falRes.status, { 'Content-Type': isJsonResponse ? 'application/json' : 'application/octet-stream' });
      res.end(text);
    } catch (err: any) {
      console.error('[fal proxy] error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `fal.ai proxy error: ${err.message}` }));
    }
  };

  return {
    name: 'fal-ai-proxy',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url || '';

        if (url.startsWith('/api/fal-storage/')) {
          // Storage upload initiate → rest.fal.ai
          const storagePath = url.replace(/^\/api\/fal-storage\//, '');
          await proxyTo(req, res, `https://rest.fal.ai/${storagePath}`);
        } else if (url === '/api/fal-upload') {
          // Binary file upload — read JSON body, PUT raw bytes to signed URL
          try {
            const bodyBuf = await readBody(req);
            const { upload_url, base64, content_type } = JSON.parse(bodyBuf.toString('utf8'));
            if (!upload_url || !base64) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'upload_url and base64 required' }));
              return;
            }
            const buffer = Buffer.from(base64, 'base64');
            const putRes = await fetch(upload_url, {
              method: 'PUT',
              headers: { 'Content-Type': content_type || 'application/octet-stream' },
              body: buffer,
            });
            res.writeHead(putRes.ok ? 200 : putRes.status, { 'Content-Type': 'application/json' });
            res.end(putRes.ok ? JSON.stringify({ ok: true }) : JSON.stringify({ error: `PUT failed: ${putRes.status}` }));
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        } else if (url.startsWith('/api/fal/')) {
          // Queue API → queue.fal.run
          const falPath = url.replace(/^\/api\/fal\//, '');
          await proxyTo(req, res, `https://queue.fal.run/${falPath}`);
        } else {
          next();
        }
      });
    },
  };
}

// ── Brand support plugin ────────────────────────────────────────────────────
// Handles two routes:
//   GET /api/scrape-brand?url=  → scrape HTML, return logo + raster image URLs (no SVGs)
//   GET /api/proxy-image?url=   → fetch any image URL server-side, return base64 data URL
// Both run server-side so there are no CORS issues and no user action needed.
function brandScraperPlugin(): Plugin {
  const resolveUrl = (base: string, src: string): string => {
    try {
      if (!src) return '';
      if (src.startsWith('//')) return 'https:' + src;
      if (src.startsWith('http')) return src;
      return new URL(src, base).href;
    } catch { return src; }
  };

  // Only raster formats — SVGs are excluded because Gemini inlineData can't process them
  const isRasterImageUrl = (src: string): boolean => {
    if (!src || src.startsWith('data:')) return false;
    const path = src.split('?')[0].toLowerCase();
    if (path.endsWith('.svg') || path.includes('.svg?')) return false;
    return /\.(jpg|jpeg|png|webp|gif|avif)(\?|$)/.test(path) ||
      (src.includes('http') && (src.includes('/image') || src.includes('/media') || src.includes('/asset') || src.includes('/product')));
  };

  const jsonReply = (res: ServerResponse, status: number, data: object) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(data));
  };

  return {
    name: 'brand-support',
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const rawUrl = req.url || '';

        // ── /api/scrape-brand → proxy to dev-server.js (has Shopify API, multi-page crawl) ──
        if (rawUrl.startsWith('/api/scrape-brand')) {
          try {
            const proxyRes = await fetch(`http://localhost:3002${rawUrl}`, {
              signal: AbortSignal.timeout(30000),
            });
            const data = await proxyRes.json();
            jsonReply(res, 200, data);
          } catch (err: any) {
            console.error('[brand-scraper] proxy error:', err.message);
            jsonReply(res, 200, { logoUrl: '', images: [] });
          }
          return;
        }

        // ── /api/proxy-image ───────────────────────────────────────────────
        // Fetches an image URL server-side and returns it as a base64 data URL.
        // This is the key piece that makes scraped HTTP images usable as Gemini inlineData.
        if (rawUrl.startsWith('/api/proxy-image')) {
          const parsedUrl = new URL(rawUrl, 'http://localhost');
          const imageUrl = parsedUrl.searchParams.get('url');
          if (!imageUrl) { jsonReply(res, 400, { error: 'url param required' }); return; }

          try {
            const imgRes = await fetch(imageUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(10000),
              redirect: 'follow',
            });
            if (!imgRes.ok) { jsonReply(res, imgRes.status, { error: `Fetch failed: ${imgRes.status}` }); return; }

            const contentType = (imgRes.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            // Reject SVGs and non-images — Gemini inlineData only accepts raster formats
            if (!contentType.startsWith('image/') || contentType.includes('svg')) {
              jsonReply(res, 415, { error: `Unsupported image type: ${contentType}` }); return;
            }

            const buf = Buffer.from(await imgRes.arrayBuffer());
            // Cap at 4MB — Gemini has limits on inline image data
            if (buf.length > 4 * 1024 * 1024) { jsonReply(res, 413, { error: 'Image too large' }); return; }

            const base64 = buf.toString('base64');
            jsonReply(res, 200, { dataUrl: `data:${contentType};base64,${base64}`, mimeType: contentType });
          } catch (err: any) {
            console.error('[proxy-image] error:', err.message);
            jsonReply(res, 500, { error: err.message });
          }
          return;
        }

        next();
      });
    },
  };
}

// ── Vite config ────────────────────────────────────────────────────────────
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const apiKey = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY;
  const falKey = env.FAL_KEY;

  return {
    server: {
      port: 3001,
      host: '0.0.0.0',
      watch: {
        ignored: ['**/.claude/**', '**/.openclaw/**', '**/node_modules/**'],
      },
      proxy: {
        // Gemini still goes through dev-server.js on 3002
        '/api/gemini': {
          target: 'http://localhost:3002',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (_proxyReq, req) => {
              (req as any).setTimeout?.(120000);
            });
          },
        },
        // /api/fal is handled by the falProxyPlugin above — no entry here
        // Upload-Post API proxy
        '/api/upload-post': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Sync API proxy
        '/api/sync': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Embed API proxy
        '/api/embed': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Hostinger upload proxy
        '/api/hostinger-upload': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Social API proxy
        '/api/social': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Cron API proxy
        '/api/cron': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
        // Skills marketplace proxy
        '/api/skills': {
          target: 'http://localhost:3002',
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      falProxyPlugin(falKey),
      brandScraperPlugin(),
    ],
    define: {
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(apiKey || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    publicDir: 'public',
    build: {
      rollupOptions: {},
    },
  };
});
