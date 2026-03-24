import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import type { ConnectorPlatform, UserConnector } from '../types/connector.types';
import * as connectorService from '../services/connectorService';
import { localBridge, type BridgeStatus, type LocalModel } from '../services/localBridge';

const PLATFORM_ICONS: Record<string, string> = {
  gmail: '📧', google_drive: '📂', slack: '💬', github: '🐙',
  notion: '📝', brave_search: '🔍', google_maps: '🗺️',
};

interface SearchResult {
  id: string;
  package: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads: number;
  url: string;
}

export const ConnectorsPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'connected' | 'browse'>('connected');
  const [platforms, setPlatforms] = useState<ConnectorPlatform[]>([]);
  const [connectors, setConnectors] = useState<UserConnector[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);

  // Local bridge state
  const [bridgeStatus, setBridgeStatus] = useState<'checking' | 'connected' | 'disconnected' | 'error'>('checking');
  const [bridgeModels, setBridgeModels] = useState<LocalModel[]>([]);
  const [bridgeAutoConnect, setBridgeAutoConnect] = useState<boolean>(() =>
    localStorage.getItem('godseye_bridge_autoconnect') === 'true'
  );
  const bridgeCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check bridge on mount and optionally poll
  const checkBridge = useCallback(async () => {
    const { running, models } = await localBridge.checkAvailability();
    setBridgeStatus(running ? 'connected' : 'disconnected');
    setBridgeModels(models);
    return running;
  }, []);

  useEffect(() => {
    checkBridge();
    // Poll every 10s if auto-connect is on
    if (bridgeAutoConnect) {
      bridgeCheckRef.current = setInterval(checkBridge, 10000);
    }
    return () => { if (bridgeCheckRef.current) clearInterval(bridgeCheckRef.current); };
  }, [checkBridge, bridgeAutoConnect]);

  const toggleAutoConnect = (enabled: boolean) => {
    setBridgeAutoConnect(enabled);
    localStorage.setItem('godseye_bridge_autoconnect', String(enabled));
    if (enabled) {
      checkBridge();
      bridgeCheckRef.current = setInterval(checkBridge, 10000);
    } else {
      if (bridgeCheckRef.current) clearInterval(bridgeCheckRef.current);
    }
  };

  // Browse tab
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const [plats, conns] = await Promise.all([
      connectorService.getPlatforms(),
      connectorService.getUserConnectors(user.id),
    ]);
    setPlatforms(plats);
    setConnectors(conns);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  // Detect OAuth callback redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callback = params.get('connectorCallback');
    if (callback) {
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('connectorCallback');
      url.searchParams.delete('status');
      url.searchParams.delete('message');
      window.history.replaceState({}, '', url.toString());
      // Refresh data
      loadData();
    }
  }, [loadData]);

  const connectedMap = new Map(connectors.map(c => [c.platform, c]));

  const handleOAuthConnect = async (platform: string) => {
    if (!user?.id) return;
    setConnecting(platform);
    const url = await connectorService.getOAuthUrl(platform, user.id);
    if (url) {
      window.location.href = url;
    } else {
      setConnecting(null);
    }
  };

  const handleApiKeySave = async (platform: string) => {
    if (!user?.id) return;
    const key = apiKeyInputs[platform]?.trim();
    if (!key) return;
    setConnecting(platform);
    setApiKeyError(null);
    const result = await connectorService.saveApiKey(user.id, platform, key);
    if (result.success) {
      setApiKeyInputs(prev => ({ ...prev, [platform]: '' }));
      await loadData();
    } else {
      setApiKeyError(result.error || 'Invalid API key');
    }
    setConnecting(null);
  };

  const handleDisconnect = async (platform: string) => {
    if (!user?.id || !confirm(`Disconnect ${platform}?`)) return;
    await connectorService.disconnect(user.id, platform);
    await loadData();
  };

  const handleToggle = async (platform: string, enabled: boolean) => {
    if (!user?.id) return;
    await connectorService.toggleConnector(user.id, platform, enabled);
    await loadData();
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/connectors/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(await res.json());
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const getAccountLabel = (connector: UserConnector): string => {
    const info = connector.account_info || {};
    if (info.email) return info.email;
    if (info.login) return info.login;
    if (info.user) return `${info.user} (${info.team || ''})`;
    if (info.workspace_name) return info.workspace_name;
    if (info.name) return info.name;
    if (info.type === 'api_key') return 'API Key configured';
    return 'Connected';
  };

  return (
    <div className="h-full overflow-y-auto bg-bg pt-16">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-3.07a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.35 8.97" />
            </svg>
            Connectors
          </h1>
          <p className="text-sm text-text-secondary mt-1">Connect your apps so the AI can use them in chat</p>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-6 border-b border-white/5 pb-2">
          {(['connected', 'browse'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t ? 'bg-white/10 text-text-primary' : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
              }`}
            >
              {t === 'connected' ? `Apps (${connectors.length})` : 'Browse MCP Packages'}
            </button>
          ))}
        </div>

        {/* Connected Tab — Platform Cards */}
        {tab === 'connected' && (
          <div className="space-y-3">
            {/* Local Bridge Card */}
            <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-4">
                  <span className="text-2xl">🌉</span>
                  <div>
                    <p className="text-sm font-semibold text-text-primary">Local Bridge</p>
                    <p className="text-[11px] text-text-secondary/60">
                      Connect to Claude Code running on your machine
                    </p>
                    {bridgeStatus === 'connected' && bridgeModels.length > 0 && (
                      <p className="text-[11px] text-green-400 mt-0.5">
                        {bridgeModels.filter(m => m.installed).map(m => m.name).join(', ') || 'Bridge running'}
                      </p>
                    )}
                    {bridgeStatus === 'disconnected' && (
                      <p className="text-[11px] text-text-secondary/40 mt-0.5">
                        Run <code className="px-1 py-0.5 rounded bg-white/5 font-mono text-[10px]">node local-bridge-server.cjs</code> in your terminal
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Status badge */}
                  <span className={`px-2.5 py-1 rounded-md text-[10px] font-medium ${
                    bridgeStatus === 'connected'
                      ? 'bg-green-500/10 text-green-400'
                      : bridgeStatus === 'checking'
                      ? 'bg-yellow-500/10 text-yellow-400'
                      : 'bg-white/5 text-text-secondary/50'
                  }`}>
                    {bridgeStatus === 'connected' ? 'Connected' : bridgeStatus === 'checking' ? 'Checking...' : 'Offline'}
                  </span>

                  {/* Retry / Check button */}
                  <button
                    onClick={async () => {
                      setBridgeStatus('checking');
                      await checkBridge();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-secondary text-[10px] font-medium hover:bg-white/10 transition-colors"
                  >
                    {bridgeStatus === 'connected' ? 'Refresh' : 'Check'}
                  </button>
                </div>
              </div>

              {/* Auto-connect toggle */}
              <div className="px-5 pb-4 pt-0 flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-text-secondary">Auto-connect</p>
                  <p className="text-[10px] text-text-secondary/40">
                    Automatically detect bridge when you open the app
                  </p>
                </div>
                <button
                  onClick={() => toggleAutoConnect(!bridgeAutoConnect)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    bridgeAutoConnect ? 'bg-brand' : 'bg-white/10'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                      bridgeAutoConnect ? 'translate-x-5' : ''
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 py-2">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] text-text-secondary/40 uppercase tracking-widest">Cloud Connectors</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>

            {loading ? (
              <p className="text-text-secondary text-sm py-8 text-center">Loading...</p>
            ) : (
              platforms.map(platform => {
                const connector = connectedMap.get(platform.key);
                const isConnected = !!connector;
                const icon = PLATFORM_ICONS[platform.key] || '🔗';

                return (
                  <div key={platform.key} className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-4">
                        <span className="text-2xl">{icon}</span>
                        <div>
                          <p className="text-sm font-semibold text-text-primary">{platform.name}</p>
                          <p className="text-[11px] text-text-secondary/60">{platform.description}</p>
                          {isConnected && (
                            <p className="text-[11px] text-green-400 mt-0.5">{getAccountLabel(connector)}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {isConnected ? (
                          <>
                            <button
                              onClick={() => handleToggle(platform.key, !connector.enabled)}
                              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                                connector.enabled
                                  ? 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                                  : 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                              }`}
                            >
                              {connector.enabled ? 'Active' : 'Paused'}
                            </button>
                            <button
                              onClick={() => handleDisconnect(platform.key)}
                              className="px-2.5 py-1 rounded-md text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              Disconnect
                            </button>
                          </>
                        ) : platform.auth_type === 'oauth' ? (
                          <button
                            onClick={() => handleOAuthConnect(platform.key)}
                            disabled={connecting === platform.key || !platform.configured}
                            className="px-4 py-2 rounded-lg bg-brand text-bg text-xs font-bold hover:brightness-110 disabled:opacity-40 transition-all"
                          >
                            {!platform.configured
                              ? 'Not Configured'
                              : connecting === platform.key
                              ? 'Connecting...'
                              : 'Connect'}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {/* API Key input for api_key platforms that aren't connected */}
                    {!isConnected && platform.auth_type === 'api_key' && (
                      <div className="px-5 pb-4 pt-0">
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={apiKeyInputs[platform.key] || ''}
                            onChange={e => {
                              setApiKeyInputs(prev => ({ ...prev, [platform.key]: e.target.value }));
                              setApiKeyError(null);
                            }}
                            placeholder={`Enter ${platform.name} API key`}
                            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-xs font-mono"
                          />
                          <button
                            onClick={() => handleApiKeySave(platform.key)}
                            disabled={!apiKeyInputs[platform.key]?.trim() || connecting === platform.key}
                            className="px-4 py-2 rounded-lg bg-brand text-bg text-xs font-bold hover:brightness-110 disabled:opacity-40"
                          >
                            {connecting === platform.key ? '...' : 'Save'}
                          </button>
                        </div>
                        {apiKeyError && (
                          <p className="text-[10px] text-red-400 mt-1">{apiKeyError}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Browse Tab — npm MCP search */}
        {tab === 'browse' && (
          <div className="space-y-6">
            <div className="flex gap-2">
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search npm for MCP servers... (e.g. notion, slack, github)"
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 text-sm"
              />
              <button
                onClick={handleSearch}
                disabled={searching}
                className="px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 disabled:opacity-50"
              >
                {searching ? '...' : 'Search'}
              </button>
            </div>

            {searchResults.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary uppercase tracking-widest">Results</p>
                {searchResults.map(r => (
                  <div key={r.package} className="flex items-center justify-between px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02]">
                    <div className="flex-1 min-w-0 mr-4">
                      <p className="text-sm font-medium text-text-primary">{r.name}</p>
                      <p className="text-[11px] text-text-secondary/60 truncate">{r.description}</p>
                      <p className="text-[10px] text-text-secondary/30 font-mono mt-0.5">{r.package} v{r.version}</p>
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-text-secondary text-xs font-medium hover:bg-white/10"
                    >
                      View
                    </a>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <p className="text-sm text-text-secondary">
                The connectors on the "Apps" tab have native OAuth integration and work on any platform.
                MCP packages from npm require a local bridge server and are for advanced users.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
