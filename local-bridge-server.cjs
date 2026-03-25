#!/usr/bin/env node
/**
 * Gods Eye Local Bridge Server
 * WebSocket server bridging browser chat UI to local AI CLIs (Claude Code, Codex)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

// ── MCP Settings Management ─────────────────────────────────────────────────

const CLAUDE_SETTINGS_PATH = path.join(require('os').homedir(), '.claude', 'settings.json');

function readClaudeSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  } catch { return { mcpServers: {} }; }
}

function writeClaudeSettings(settings) {
  // Backup first
  try {
    const backup = CLAUDE_SETTINGS_PATH + '.bak';
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      fs.copyFileSync(CLAUDE_SETTINGS_PATH, backup);
    }
  } catch {}
  fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function getInstalledMCPs() {
  const settings = readClaudeSettings();
  const mcps = settings.mcpServers || {};
  return Object.entries(mcps).map(([id, cfg]) => ({
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    command: cfg.command || '',
    args: cfg.args || [],
    url: cfg.url || '',
    env: cfg.env || {},
    disabled: cfg.disabled || false,
    source: 'installed',
  }));
}

// Parse request body helper
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const PORT = 3456;
const MODELS = {
  'claude': { cmd: 'claude', args: ['--print'], name: 'Claude Code' },
  'codex': { cmd: 'codex', args: [], name: 'Codex' },
};

// ── Session Manager ──────────────────────────────────────────────────────────

class LocalSession {
  constructor(ws, model, folder, context) {
    this.ws = ws;
    this.model = model;
    this.folder = folder;
    this.context = context;
    this.transcript = [];
    this.process = null;
    this.sessionId = null; // Claude session ID for --resume (faster than --continue)
  }

  send(obj) {
    try { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); } catch {}
  }

  start() {
    const mc = MODELS[this.model];
    if (!mc) { this.send({ type: 'status', status: 'error', message: `Unknown model: ${this.model}` }); return; }
    console.log(`[Bridge] Starting ${mc.name} in ${this.folder}`);
    this.send({ type: 'status', status: 'starting', model: mc.name });
    this.transcript.push({ role: 'system', text: this.context, time: Date.now() });
    // Don't run context as a prompt — just mark ready. Context will be prepended to first user message.
    this.send({ type: 'status', status: 'ready' });
  }

  _runPrompt(prompt) {
    const mc = MODELS[this.model];
    this.transcript.push({ role: 'user', text: prompt, time: Date.now() });
    this.send({ type: 'status', status: 'running' });
    const messageCount = this.transcript.filter(t => t.role === 'user').length;

    try {
      const fs = require('fs');
      const os = require('os');
      const path = require('path');

      // Write prompt to temp file (avoids shell escaping issues)
      const tmpFile = path.join(os.tmpdir(), `godseye-prompt-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, prompt);

      const isFirst = (this.model === 'claude' && messageCount <= 1);
      const shouldContinue = (this.model === 'claude' && messageCount > 1);

      let shellCmd;
      if (this.model === 'claude') {
        const flags = ['--print', '--output-format', 'text'];
        if (isFirst && this.context) {
          const ctxFile = path.join(os.tmpdir(), `godseye-ctx-${Date.now()}.txt`);
          fs.writeFileSync(ctxFile, this.context);
          flags.push('--append-system-prompt', `"$(cat ${ctxFile})"`);
          setTimeout(() => { try { fs.unlinkSync(ctxFile); } catch {} }, 30000);
        }
        if (shouldContinue) flags.push('--continue');
        shellCmd = `cat "${tmpFile}" | ${mc.cmd} ${flags.join(' ')}`;
      } else {
        shellCmd = `cat "${tmpFile}" | ${mc.cmd}`;
      }

      console.log(`[Bridge] Running ${this.model} (msg #${messageCount})${shouldContinue ? ` [resume ${this.sessionId}]` : ' [new session]'}`);

      const proc = spawn('sh', ['-c', shellCmd], {
        cwd: this.folder,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Clean up temp file
      proc.on('close', () => { try { fs.unlinkSync(tmpFile); } catch {} });

      this.process = proc;
      let output = '';

      proc.stdout.on('data', (d) => {
        const t = d.toString();
        output += t;
        this.send({ type: 'output', text: t, streaming: true });
      });

      proc.stderr.on('data', (d) => {
        const t = d.toString();
        // Capture session ID from Claude's verbose output for --resume
        const sessionMatch = t.match(/session[_\s]?id[:\s]+([a-f0-9-]+)/i) || t.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/);
        if (sessionMatch && !this.sessionId) {
          this.sessionId = sessionMatch[1];
          console.log(`[Bridge] Captured session ID: ${this.sessionId}`);
        }
        if (t.includes('Error') || t.includes('error')) {
          this.send({ type: 'output', text: `[stderr] ${t}`, streaming: true });
        }
      });

      proc.on('close', () => {
        this.process = null;
        this.transcript.push({ role: 'assistant', text: output.trim(), time: Date.now() });
        // Small delay to ensure streaming output is processed by the browser first
        setTimeout(() => {
          this.send({ type: 'output', text: output.trim(), streaming: false, done: true });
          this.send({ type: 'status', status: 'ready' });
        }, 100);
      });

      proc.on('error', (err) => {
        this.process = null;
        this.send({ type: 'status', status: 'error', message: `Failed to start ${mc.name}: ${err.message}` });
      });
    } catch (err) {
      this.send({ type: 'status', status: 'error', message: err.message });
    }
  }

  sendMessage(text) {
    if (this.process) { this.send({ type: 'status', status: 'busy', message: 'Previous command still running' }); return; }
    // Just send the user message directly — context goes via --append-system-prompt
    this._runPrompt(text);
  }

  getTranscript() {
    return this.transcript.map(t => `[${t.role}] ${t.text}`).join('\n\n---\n\n');
  }

  stop() {
    if (this.process) { this.process.kill('SIGTERM'); this.process = null; }
    this.send({ type: 'status', status: 'stopped' });
  }
}

// ── HTTP Server (health + models) ────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

  if (req.url === '/health') {
    return json({ status: 'ok', models: Object.keys(MODELS) });
  }

  if (req.url === '/available-models') {
    const { execSync } = require('child_process');
    const available = [];
    for (const [id, config] of Object.entries(MODELS)) {
      let installed = false;
      try { execSync(`which ${config.cmd}`, { stdio: 'ignore' }); installed = true; } catch {}
      available.push({ id, name: config.name, installed });
    }
    return json(available);
  }

  // ── MCP Endpoints ────────────────────────────────────────────────────────

  // List installed MCPs
  if (req.url === '/mcp/list' && req.method === 'GET') {
    return json(getInstalledMCPs());
  }

  // Install an MCP
  if (req.url === '/mcp/install' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.id) return json({ error: 'Missing id' }, 400);

      const settings = readClaudeSettings();
      if (!settings.mcpServers) settings.mcpServers = {};

      // Build MCP config
      const mcpConfig = {};
      if (body.url) {
        // Remote MCP server (URL-based)
        mcpConfig.url = body.url;
      } else {
        // Command-based MCP
        mcpConfig.command = body.command || 'npx';
        mcpConfig.args = body.args || ['-y', body.package || `@anthropic/mcp-${body.id}`];
      }
      if (body.env) mcpConfig.env = body.env;

      settings.mcpServers[body.id] = mcpConfig;
      writeClaudeSettings(settings);

      console.log(`[MCP] ✅ Installed: ${body.id}`);
      return json({ success: true, id: body.id, config: mcpConfig });
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  // Uninstall an MCP
  if (req.url === '/mcp/uninstall' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.id) return json({ error: 'Missing id' }, 400);

      const settings = readClaudeSettings();
      if (settings.mcpServers && settings.mcpServers[body.id]) {
        delete settings.mcpServers[body.id];
        writeClaudeSettings(settings);
        console.log(`[MCP] ❌ Uninstalled: ${body.id}`);
        return json({ success: true, id: body.id });
      }
      return json({ error: 'MCP not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  // Toggle enable/disable an MCP
  if (req.url === '/mcp/toggle' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      if (!body.id) return json({ error: 'Missing id' }, 400);

      const settings = readClaudeSettings();
      if (settings.mcpServers && settings.mcpServers[body.id]) {
        const current = settings.mcpServers[body.id].disabled || false;
        settings.mcpServers[body.id].disabled = !current;
        writeClaudeSettings(settings);
        console.log(`[MCP] ${!current ? '⏸️ Disabled' : '▶️ Enabled'}: ${body.id}`);
        return json({ success: true, id: body.id, disabled: !current });
      }
      return json({ error: 'MCP not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  // Search npm registry for MCP packages
  if (req.url?.startsWith('/mcp/search') && req.method === 'GET') {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const query = url.searchParams.get('q') || 'mcp';
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
      return json(results);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket Server (using ws package) ──────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('[Bridge] WebSocket connected');
  let session = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'start':
        if (session) session.stop();
        session = new LocalSession(ws, msg.model, msg.folder, msg.context || '');
        session.start();
        break;
      case 'message':
        if (!session) { ws.send(JSON.stringify({ type: 'status', status: 'error', message: 'No session' })); return; }
        session.sendMessage(msg.text);
        break;
      case 'transcript':
        if (session) ws.send(JSON.stringify({ type: 'transcript', text: session.getTranscript() }));
        break;
      case 'stop':
        if (session) { session.stop(); session = null; }
        break;
    }
  });

  ws.on('close', () => {
    if (session) { session.stop(); session = null; }
    console.log('[Bridge] WebSocket disconnected');
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Bridge] 🌉 Local bridge server on ws://localhost:${PORT}`);
  console.log(`[Bridge] Health: http://localhost:${PORT}/health`);
});
