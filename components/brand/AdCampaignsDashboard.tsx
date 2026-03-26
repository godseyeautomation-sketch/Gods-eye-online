import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import * as connectorService from '../../services/connectorService';
import * as campaignService from '../../services/adCampaignService';
import type { AdCampaign, AdCreative, AdPlatform } from '../../types/brand.types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLATFORM_META: Record<AdPlatform, { icon: string; label: string; color: string }> = {
  google_ads: { icon: '📢', label: 'Google Ads', color: '#4285F4' },
  meta_ads:   { icon: '📱', label: 'Meta Ads',   color: '#0668E1' },
};

const cents = (v: number) =>
  `$${(v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number) =>
  `${(v * 100).toFixed(2)}%`;
const num = (v: number) => v.toLocaleString();

const statusColor: Record<string, string> = {
  ENABLED: 'bg-green-500/10 text-green-400',
  ACTIVE:  'bg-green-500/10 text-green-400',
  PAUSED:  'bg-yellow-500/10 text-yellow-400',
  REMOVED: 'bg-red-500/10 text-red-400',
};

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  brandId?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export const AdCampaignsDashboard: React.FC<Props> = ({ brandId }) => {
  const { user } = useAuth();

  // Core state
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connection state
  const [connectedPlatforms, setConnectedPlatforms] = useState<{
    google_ads: boolean;
    meta_ads: boolean;
  }>({ google_ads: false, meta_ads: false });

  // Detail panel
  const [selectedCampaign, setSelectedCampaign] = useState<AdCampaign | null>(null);

  // Push creative modal
  const [showPushModal, setShowPushModal] = useState(false);
  const [pushImageUrl, setPushImageUrl] = useState('');
  const [pushAssetName, setPushAssetName] = useState('');
  const [pushPlatform, setPushPlatform] = useState<AdPlatform>('google_ads');
  const [pushing, setPushing] = useState(false);

  // Toggling campaign status
  const [toggling, setToggling] = useState(false);

  const userId = user?.id;

  // ── Load connections + campaigns on mount ────────────────────────────────

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [connectors, campaignList] = await Promise.all([
        connectorService.getUserConnectors(userId),
        campaignService.listCampaigns(userId, brandId),
      ]);

      const platforms = { google_ads: false, meta_ads: false };
      for (const c of connectors) {
        if (c.platform === 'google_ads' && c.enabled) platforms.google_ads = true;
        if (c.platform === 'meta_ads' && c.enabled) platforms.meta_ads = true;
      }
      setConnectedPlatforms(platforms);
      setCampaigns(campaignList);
    } catch (e: any) {
      setError(e.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [userId, brandId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleConnect = async (platform: AdPlatform) => {
    if (!userId) return;
    const url = await connectorService.getOAuthUrl(platform, userId);
    if (url) window.open(url, '_blank');
  };

  const handleSync = async () => {
    if (!userId) return;
    setSyncing(true);
    setError(null);
    try {
      const platforms: AdPlatform[] = [];
      if (connectedPlatforms.google_ads) platforms.push('google_ads');
      if (connectedPlatforms.meta_ads) platforms.push('meta_ads');
      await Promise.all(platforms.map((p) => campaignService.syncCampaigns(userId, p)));
      await loadData();
    } catch (e: any) {
      setError(e.message || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedCampaign || !userId) return;
    setToggling(true);
    try {
      const newStatus = selectedCampaign.status === 'PAUSED' ? 'ENABLED' : 'PAUSED';
      await campaignService.updateCampaignStatus(
        userId,
        selectedCampaign.id,
        newStatus,
      );
      setSelectedCampaign({ ...selectedCampaign, status: newStatus });
      setCampaigns((prev) =>
        prev.map((c) => (c.id === selectedCampaign.id ? { ...c, status: newStatus } : c)),
      );
    } catch (e: any) {
      setError(e.message || 'Failed to update campaign status');
    } finally {
      setToggling(false);
    }
  };

  const handlePushCreative = async () => {
    if (!userId || !pushImageUrl) return;
    setPushing(true);
    try {
      await campaignService.pushCreative(userId, {
        platform: pushPlatform,
        image_url: pushImageUrl,
        asset_name: pushAssetName || undefined,
        campaign_id: selectedCampaign?.id,
        brand_id: brandId,
      });
      setShowPushModal(false);
      setPushImageUrl('');
      setPushAssetName('');
    } catch (e: any) {
      setError(e.message || 'Failed to push creative');
    } finally {
      setPushing(false);
    }
  };

  // ── Computed ─────────────────────────────────────────────────────────────

  const anyConnected = connectedPlatforms.google_ads || connectedPlatforms.meta_ads;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-5 w-full max-w-6xl mx-auto py-6 px-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Ad Campaigns</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Manage Google Ads &amp; Meta Ads campaigns
          </p>
        </div>
        {anyConnected && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand text-bg text-xs font-bold disabled:opacity-50 transition-opacity"
          >
            {syncing ? (
              <span className="inline-block w-3 h-3 border-2 border-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              <span>↻</span>
            )}
            Sync Now
          </button>
        )}
      </div>

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400 flex items-center gap-2">
          <span>⚠</span>
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400/60 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Connection Status Bar ───────────────────────────────────────── */}
      <section>
        <h3 className="text-xs text-text-secondary uppercase tracking-widest mb-3">
          Platform Connections
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(['google_ads', 'meta_ads'] as AdPlatform[]).map((platform) => {
            const meta = PLATFORM_META[platform];
            const connected = connectedPlatforms[platform];
            return (
              <div
                key={platform}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-4 flex items-center gap-3"
              >
                <span className="text-xl">{meta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">{meta.label}</p>
                  {connected ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-xs text-green-400">Connected</span>
                    </div>
                  ) : (
                    <span className="text-xs text-text-secondary">Not connected</span>
                  )}
                </div>
                {connected ? (
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors disabled:opacity-50"
                  >
                    Sync
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnect(platform)}
                    className="px-3 py-1.5 rounded-lg bg-brand text-bg text-xs font-bold transition-opacity hover:opacity-90"
                  >
                    Connect {meta.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Main area: campaign list + detail panel ─────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="inline-block w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex gap-5">
          {/* ── Campaign List ──────────────────────────────────────────── */}
          <section className="flex-1 min-w-0">
            <h3 className="text-xs text-text-secondary uppercase tracking-widest mb-3">
              Campaigns
            </h3>

            {campaigns.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-12 text-center">
                <p className="text-3xl mb-3">📊</p>
                <p className="text-sm text-text-secondary">
                  {anyConnected
                    ? 'No campaigns found. Click "Sync Now" to pull from your ad platforms.'
                    : 'Connect an ad platform and sync your campaigns'}
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-white/5 bg-white/[0.02] overflow-hidden">
                {/* Table header */}
                <div className="grid grid-cols-[40px_1fr_90px_90px_80px_60px_70px_80px] gap-2 px-4 py-2.5 border-b border-white/5 text-[10px] text-text-secondary uppercase tracking-widest">
                  <span />
                  <span>Campaign</span>
                  <span>Status</span>
                  <span>Budget</span>
                  <span className="text-right">Impr.</span>
                  <span className="text-right">Clicks</span>
                  <span className="text-right">CTR</span>
                  <span className="text-right">Spend</span>
                </div>

                {/* Rows */}
                {campaigns.map((c) => {
                  const isSelected = selectedCampaign?.id === c.id;
                  const budget = c.daily_budget_cents
                    ? `${cents(c.daily_budget_cents)}/d`
                    : c.lifetime_budget_cents
                      ? cents(c.lifetime_budget_cents)
                      : '—';
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedCampaign(isSelected ? null : c)}
                      className={`w-full grid grid-cols-[40px_1fr_90px_90px_80px_60px_70px_80px] gap-2 px-4 py-3 text-left border-b border-white/5 last:border-0 transition-colors ${
                        isSelected
                          ? 'bg-brand/5'
                          : 'hover:bg-white/[0.03]'
                      }`}
                    >
                      <span className="text-lg leading-none self-center">
                        {PLATFORM_META[c.platform]?.icon ?? '📊'}
                      </span>
                      <span className="text-sm text-text-primary truncate self-center">
                        {c.name}
                      </span>
                      <span className="self-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            statusColor[c.status] ?? 'bg-white/5 text-text-secondary'
                          }`}
                        >
                          {c.status}
                        </span>
                      </span>
                      <span className="text-xs text-text-secondary self-center">{budget}</span>
                      <span className="text-xs text-text-primary text-right self-center">
                        {num(c.impressions)}
                      </span>
                      <span className="text-xs text-text-primary text-right self-center">
                        {num(c.clicks)}
                      </span>
                      <span className="text-xs text-text-primary text-right self-center">
                        {pct(c.ctr)}
                      </span>
                      <span className="text-xs text-text-primary text-right self-center">
                        {cents(c.spend_cents)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Campaign Detail Panel ──────────────────────────────────── */}
          {selectedCampaign && (
            <aside className="w-80 flex-shrink-0">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5 sticky top-4">
                {/* Close */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">
                      {PLATFORM_META[selectedCampaign.platform]?.icon}
                    </span>
                    <div>
                      <h4 className="text-sm font-semibold text-text-primary leading-tight">
                        {selectedCampaign.name}
                      </h4>
                      <span
                        className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          statusColor[selectedCampaign.status] ?? 'bg-white/5 text-text-secondary'
                        }`}
                      >
                        {selectedCampaign.status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedCampaign(null)}
                    className="text-text-secondary hover:text-text-primary transition-colors text-sm"
                  >
                    ✕
                  </button>
                </div>

                {/* Budget */}
                {(selectedCampaign.daily_budget_cents || selectedCampaign.lifetime_budget_cents) && (
                  <p className="text-xs text-text-secondary mb-4">
                    Budget:{' '}
                    <span className="text-text-primary font-medium">
                      {selectedCampaign.daily_budget_cents
                        ? `${cents(selectedCampaign.daily_budget_cents)}/day`
                        : cents(selectedCampaign.lifetime_budget_cents ?? 0)}
                    </span>
                  </p>
                )}

                {/* Metrics grid */}
                <h5 className="text-xs text-text-secondary uppercase tracking-widest mb-2">
                  Metrics
                </h5>
                <div className="grid grid-cols-2 gap-2 mb-5">
                  {[
                    { label: 'Impressions', value: num(selectedCampaign.impressions) },
                    { label: 'Clicks', value: num(selectedCampaign.clicks) },
                    { label: 'CTR', value: pct(selectedCampaign.ctr) },
                    { label: 'CPC', value: cents(selectedCampaign.cpc_cents) },
                    { label: 'Spend', value: cents(selectedCampaign.spend_cents) },
                    { label: 'Conversions', value: num(selectedCampaign.conversions) },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
                    >
                      <p className="text-[10px] text-text-secondary uppercase tracking-wider">
                        {m.label}
                      </p>
                      <p className="text-sm font-semibold text-text-primary mt-0.5">{m.value}</p>
                    </div>
                  ))}
                </div>

                {/* ROAS */}
                {selectedCampaign.roas > 0 && (
                  <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 mb-5">
                    <p className="text-[10px] text-text-secondary uppercase tracking-wider">
                      ROAS
                    </p>
                    <p className="text-sm font-semibold text-text-primary mt-0.5">
                      {selectedCampaign.roas.toFixed(2)}x
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowPushModal(true)}
                    className="w-full px-4 py-2 rounded-lg bg-brand text-bg text-xs font-bold transition-opacity hover:opacity-90"
                  >
                    Push Creative
                  </button>
                  <button
                    onClick={handleToggleStatus}
                    disabled={toggling || selectedCampaign.status === 'REMOVED'}
                    className="w-full px-4 py-2 rounded-lg border border-white/10 text-xs text-text-secondary hover:text-text-primary hover:border-white/20 transition-colors disabled:opacity-40"
                  >
                    {toggling ? (
                      <span className="inline-block w-3 h-3 border-2 border-text-secondary border-t-transparent rounded-full animate-spin" />
                    ) : selectedCampaign.status === 'PAUSED' ? (
                      '▶ Resume Campaign'
                    ) : selectedCampaign.status === 'REMOVED' ? (
                      'Campaign Removed'
                    ) : (
                      '⏸ Pause Campaign'
                    )}
                  </button>
                </div>

                {/* Last synced */}
                {selectedCampaign.metrics_updated_at && (
                  <p className="text-[10px] text-text-secondary mt-3 text-center">
                    Last synced{' '}
                    {new Date(selectedCampaign.metrics_updated_at).toLocaleString()}
                  </p>
                )}
              </div>
            </aside>
          )}
        </div>
      )}

      {/* ── Push Creative Modal ─────────────────────────────────────────── */}
      {showPushModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 bg-bg w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-semibold text-text-primary">Push Creative</h3>
              <button
                onClick={() => setShowPushModal(false)}
                className="text-text-secondary hover:text-text-primary transition-colors text-sm"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4">
              {/* Image URL */}
              <div>
                <label className="text-xs text-text-secondary block mb-1.5">Image URL</label>
                <input
                  type="url"
                  value={pushImageUrl}
                  onChange={(e) => setPushImageUrl(e.target.value)}
                  placeholder="https://... or paste from clipboard"
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-brand/50 transition-colors"
                />
              </div>

              {/* Asset name */}
              <div>
                <label className="text-xs text-text-secondary block mb-1.5">Asset Name</label>
                <input
                  type="text"
                  value={pushAssetName}
                  onChange={(e) => setPushAssetName(e.target.value)}
                  placeholder="e.g. Spring Sale Banner"
                  className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-sm text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-brand/50 transition-colors"
                />
              </div>

              {/* Platform */}
              <div>
                <label className="text-xs text-text-secondary block mb-1.5">Platform</label>
                <div className="flex gap-2">
                  {(['google_ads', 'meta_ads'] as AdPlatform[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPushPlatform(p)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        pushPlatform === p
                          ? 'border-brand/50 bg-brand/10 text-brand'
                          : 'border-white/10 bg-white/[0.02] text-text-secondary hover:text-text-primary'
                      }`}
                    >
                      {PLATFORM_META[p].icon} {PLATFORM_META[p].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Submit */}
              <button
                onClick={handlePushCreative}
                disabled={pushing || !pushImageUrl}
                className="w-full px-4 py-2.5 rounded-lg bg-brand text-bg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {pushing ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-bg border-t-transparent rounded-full animate-spin" />
                    Uploading...
                  </>
                ) : (
                  'Upload Creative'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdCampaignsDashboard;
