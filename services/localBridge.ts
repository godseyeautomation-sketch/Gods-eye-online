/**
 * Local Bridge Client
 *
 * Browser-side WebSocket client that connects to local-bridge-server.js
 * Handles: connection, message routing, transcript capture, folder picker
 *
 * Connection strategy (tried in order):
 * 1. Same-origin /bridge proxy — works when server.js or Vite proxies to bridge
 * 2. Direct ws://localhost:3456 — works when user runs bridge on their own machine
 *    and accesses the app from a remote/cloud deployment
 */

// Direct local bridge (user's own machine)
const LOCAL_BRIDGE_WS = 'ws://localhost:3456';
const LOCAL_BRIDGE_HTTP = 'http://localhost:3456';

// Same-origin proxy (works in dev via Vite, in Docker via server.js proxy)
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const PROXY_BRIDGE_WS = `${wsProtocol}//${window.location.host}/bridge`;
const PROXY_BRIDGE_HTTP = '/bridge';

export type BridgeStatus = 'disconnected' | 'connecting' | 'ready' | 'running' | 'error' | 'starting' | 'stopped';

export interface BridgeCallbacks {
  onOutput: (text: string, done: boolean) => void;
  onStatus: (status: BridgeStatus, message?: string) => void;
  onTranscript: (text: string) => void;
}

export interface LocalModel {
  id: string;
  name: string;
  installed: boolean;
}

class LocalBridgeClient {
  private ws: WebSocket | null = null;
  private callbacks: BridgeCallbacks | null = null;
  private _status: BridgeStatus = 'disconnected';
  private outputBuffer = '';
  // Which bridge endpoint is reachable — detected by checkAvailability()
  private _bridgeWsUrl: string = PROXY_BRIDGE_WS;
  private _bridgeHttpUrl: string = PROXY_BRIDGE_HTTP;

  get status() { return this._status; }
  /** The resolved WebSocket URL after checkAvailability() */
  get bridgeWsUrl() { return this._bridgeWsUrl; }
  /** The resolved HTTP base URL after checkAvailability() */
  get bridgeHttpUrl() { return this._bridgeHttpUrl; }

  /**
   * Check if the bridge server is running and which models are available.
   * Tries same-origin proxy first, then falls back to direct localhost.
   */
  async checkAvailability(): Promise<{ running: boolean; models: LocalModel[] }> {
    // Strategy 1: same-origin proxy (/bridge → server proxies to bridge)
    try {
      const res = await fetch(`${PROXY_BRIDGE_HTTP}/available-models`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const models = await res.json();
        this._bridgeWsUrl = PROXY_BRIDGE_WS;
        this._bridgeHttpUrl = PROXY_BRIDGE_HTTP;
        return { running: true, models };
      }
    } catch { /* proxy not available, try direct */ }

    // Strategy 2: direct connection to user's local bridge server
    try {
      const res = await fetch(`${LOCAL_BRIDGE_HTTP}/available-models`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const models = await res.json();
        this._bridgeWsUrl = LOCAL_BRIDGE_WS;
        this._bridgeHttpUrl = LOCAL_BRIDGE_HTTP;
        return { running: true, models };
      }
    } catch { /* direct not available either */ }

    return { running: false, models: [] };
  }

  /**
   * Open folder picker — uses native Chrome dialog, then asks user to confirm/edit path
   */
  async pickFolder(): Promise<string | null> {
    try {
      // @ts-ignore — showDirectoryPicker is Chrome-only
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const folderName = handle.name;

      // Chrome can't give us the full path, so ask user to confirm
      const fullPath = window.prompt(
        `Selected folder: "${folderName}"\n\nPlease confirm or edit the full path:`,
        `${this._guessHomePath()}/${folderName}`
      );
      return fullPath?.trim() || null;
    } catch {
      // User cancelled the picker or API not available — fall back to text input
      return this.promptForFolder();
    }
  }

  /**
   * Text-only folder prompt (fallback)
   */
  promptForFolder(): string | null {
    const path = window.prompt(
      'Enter the folder path where the local AI should work:\n\n(This folder will have full read/write access)',
      `${this._guessHomePath()}/Desktop`
    );
    return path?.trim() || null;
  }

  private _guessHomePath(): string {
    // Best guess for macOS/Linux home directory
    return '/Users/' + (document.cookie.match(/user=([^;]+)/)?.[1] || 'user');
  }

  /**
   * Connect to the bridge server and start a session
   */
  connect(callbacks: BridgeCallbacks): Promise<boolean> {
    this.callbacks = callbacks;
    this.outputBuffer = '';

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this._bridgeWsUrl);
        this._setStatus('connecting');

        this.ws.onopen = () => {
          this._setStatus('ready');
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._handleMessage(msg);
          } catch { /* ignore non-JSON */ }
        };

        this.ws.onclose = () => {
          this._setStatus('disconnected');
          this.ws = null;
        };

        this.ws.onerror = () => {
          this._setStatus('error', 'Cannot connect to local bridge server. Run: node local-bridge-server.js');
          this.ws = null;
          resolve(false);
        };

        // Timeout
        setTimeout(() => {
          if (this._status === 'connecting') {
            this.ws?.close();
            this._setStatus('error', 'Connection timeout. Is local-bridge-server.js running?');
            resolve(false);
          }
        }, 5000);
      } catch {
        this._setStatus('error', 'WebSocket not available');
        resolve(false);
      }
    });
  }

  /**
   * Start a local AI session
   */
  startSession(model: string, folder: string, context: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks?.onStatus('error', 'Not connected to bridge server');
      return;
    }

    this.outputBuffer = '';
    this.ws.send(JSON.stringify({
      type: 'start',
      model,
      folder,
      context,
    }));
  }

  /**
   * Send a message to the local AI
   */
  sendMessage(text: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.callbacks?.onStatus('error', 'Not connected');
      return;
    }

    this.outputBuffer = '';
    this.ws.send(JSON.stringify({ type: 'message', text }));
  }

  /**
   * Request the full transcript (for bridge skill context sync)
   */
  requestTranscript() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'transcript' }));
  }

  /**
   * Stop the current session
   */
  stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
  }

  /**
   * Disconnect entirely
   */
  disconnect() {
    this.stop();
    this.ws?.close();
    this.ws = null;
    this._setStatus('disconnected');
  }

  // ── Private ──────────────────────────────────────────

  private _handleMessage(msg: any) {
    switch (msg.type) {
      case 'output':
        if (msg.text) this.outputBuffer += msg.text;
        this.callbacks?.onOutput(msg.text || '', !!msg.done);
        break;

      case 'status':
        this._setStatus(msg.status as BridgeStatus, msg.message);
        break;

      case 'transcript':
        this.callbacks?.onTranscript(msg.text || '');
        break;
    }
  }

  private _setStatus(status: BridgeStatus, message?: string) {
    this._status = status;
    this.callbacks?.onStatus(status, message);
  }
}

// Singleton instance
export const localBridge = new LocalBridgeClient();
