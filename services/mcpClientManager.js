/**
 * Gods Eye Native MCP Client Manager
 * Starts MCP servers, discovers tools, routes tool calls
 * Works with ANY AI model (Gemini, Claude, etc.)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// SSE transport may not be available in all versions
let SSEClientTransport;
try {
  const sse = await import('@modelcontextprotocol/sdk/client/sse.js');
  SSEClientTransport = sse.SSEClientTransport;
} catch {}
import fs from 'fs';
import path from 'path';
import os from 'os';

const CLAUDE_SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');

class MCPClientManager {
  constructor() {
    this.clients = new Map();     // id → { client, transport, tools, status }
    this.allTools = [];            // Flattened array of all tools from all MCPs
    this.geminiDeclarations = [];  // Gemini-compatible function declarations
  }

  /**
   * Read installed MCPs from Claude's settings.json
   */
  getInstalledMCPs() {
    try {
      const settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, 'utf8'));
      const mcps = settings.mcpServers || {};
      return Object.entries(mcps)
        .filter(([, cfg]) => !cfg.disabled)
        .map(([id, cfg]) => ({ id, ...cfg }));
    } catch {
      return [];
    }
  }

  /**
   * Start all enabled MCP servers and discover their tools
   */
  async startAll() {
    const mcps = this.getInstalledMCPs();
    console.log(`[MCP Manager] Found ${mcps.length} enabled MCP servers`);

    for (const mcp of mcps) {
      try {
        await this.startOne(mcp);
      } catch (err) {
        console.error(`[MCP Manager] ❌ Failed to start ${mcp.id}:`, err.message);
      }
    }

    this._rebuildToolIndex();
    console.log(`[MCP Manager] ✅ Total tools available: ${this.allTools.length}`);
  }

  /**
   * Start a single MCP server
   */
  async startOne(mcp) {
    // Skip if already running
    if (this.clients.has(mcp.id) && this.clients.get(mcp.id).status === 'connected') {
      return;
    }

    console.log(`[MCP Manager] Starting ${mcp.id}...`);

    let transport;
    if (mcp.url && SSEClientTransport) {
      // Remote SSE-based MCP
      transport = new SSEClientTransport(new URL(mcp.url));
    } else if (mcp.url) {
      throw new Error(`SSE transport not available for URL-based MCP ${mcp.id}`);
    } else if (mcp.command) {
      // Local stdio-based MCP
      // Resolve command — use full system paths to avoid broken Klint node
      const CMD_MAP = { 'npx': '/usr/local/bin/npx', 'node': '/usr/local/bin/node', 'npm': '/usr/local/bin/npm' };
      const cmd = CMD_MAP[mcp.command] || mcp.command;
      const cleanPATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin';
      transport = new StdioClientTransport({
        command: cmd,
        args: mcp.args || [],
        env: { ...process.env, ...(mcp.env || {}), PATH: cleanPATH },
      });
    } else {
      throw new Error(`No command or url for MCP ${mcp.id}`);
    }

    const client = new Client({ name: `godseye-${mcp.id}`, version: '1.0.0' }, { capabilities: {} });

    try {
      await client.connect(transport);

      // Discover tools
      const toolsResult = await client.listTools();
      const tools = (toolsResult.tools || []).map(t => ({
        ...t,
        _mcpId: mcp.id,
        _fullName: `mcp_${mcp.id.replace(/-/g, '_')}_${t.name}`,
      }));

      this.clients.set(mcp.id, {
        client,
        transport,
        tools,
        status: 'connected',
        name: mcp.id,
      });

      console.log(`[MCP Manager] ✅ ${mcp.id}: ${tools.length} tools discovered`);
      tools.forEach(t => console.log(`[MCP Manager]    - ${t._fullName}: ${(t.description || '').substring(0, 60)}`));
    } catch (err) {
      this.clients.set(mcp.id, { client: null, transport: null, tools: [], status: 'error', error: err.message, name: mcp.id });
      throw err;
    }
  }

  /**
   * Stop a specific MCP client
   */
  async stopOne(mcpId) {
    const entry = this.clients.get(mcpId);
    if (!entry) return;
    try {
      if (entry.client) await entry.client.close();
      if (entry.transport) await entry.transport.close();
    } catch {}
    this.clients.delete(mcpId);
    this._rebuildToolIndex();
  }

  /**
   * Stop all MCP clients
   */
  async stopAll() {
    for (const [id] of this.clients) {
      await this.stopOne(id);
    }
  }

  /**
   * Rebuild the flattened tool index and Gemini declarations
   */
  _rebuildToolIndex() {
    this.allTools = [];
    this.geminiDeclarations = [];

    for (const [, entry] of this.clients) {
      if (entry.status !== 'connected') continue;
      for (const tool of entry.tools) {
        this.allTools.push(tool);

        // Convert MCP tool schema to Gemini function declaration
        const params = tool.inputSchema || { type: 'object', properties: {} };
        this.geminiDeclarations.push({
          name: tool._fullName,
          description: `[MCP: ${tool._mcpId}] ${tool.description || tool.name}`,
          parameters: {
            type: 'object',
            properties: params.properties || {},
            required: params.required || [],
          },
        });
      }
    }
  }

  /**
   * Call a tool by its full name (e.g. mcp_gmail_search_emails)
   */
  async callTool(fullName, args) {
    const tool = this.allTools.find(t => t._fullName === fullName);
    if (!tool) throw new Error(`MCP tool not found: ${fullName}`);

    const entry = this.clients.get(tool._mcpId);
    if (!entry || entry.status !== 'connected') throw new Error(`MCP ${tool._mcpId} not connected`);

    console.log(`[MCP Manager] Calling ${fullName} with`, JSON.stringify(args).substring(0, 200));

    const result = await entry.client.callTool({ name: tool.name, arguments: args });
    return result;
  }

  /**
   * Get Gemini function declarations for all available MCP tools
   */
  getGeminiDeclarations() {
    return this.geminiDeclarations;
  }

  /**
   * Get status of all MCP clients
   */
  getStatus() {
    const status = [];
    for (const [id, entry] of this.clients) {
      status.push({
        id,
        name: entry.name,
        status: entry.status,
        tools: entry.tools.map(t => t._fullName),
        error: entry.error,
      });
    }
    return status;
  }

  /**
   * Refresh: stop all, re-read settings, start all
   */
  async refresh() {
    await this.stopAll();
    await this.startAll();
  }
}

export { MCPClientManager };
