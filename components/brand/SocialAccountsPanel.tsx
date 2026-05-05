import React, { useState, useEffect } from 'react';
import {
  Loader2, Plus, Trash2, CheckCircle2, XCircle, RefreshCw,
  BarChart3, Clock, History, TrendingUp, Eye, Heart, MessageCircle,
  Share2, Calendar, Link2, X, ExternalLink, AlertTriangle
} from 'lucide-react';
import { SOCIAL_PLATFORMS, type SocialProfile, type SocialPlatform } from '../../types/brand.types';
import {
  getProfiles, createProfile, deleteProfile, verifyAccount,
  getHistory, getScheduledPosts, cancelScheduledPost,
  getProfileAnalytics, generateConnectUrl,
  listAllProfiles, claimProfile,
} from '../../services/uploadPostService';
import { useAuth } from '../../context/AuthContext';

interface Props {
  brandName: string;
}

type DashboardTab = 'accounts' | 'history' | 'scheduled' | 'analytics';

// Platform icons as colored circles with initials
const PlatformBadge: React.FC<{ platform: SocialPlatform | string; size?: 'sm' | 'md' }> = ({ platform, size = 'sm' }) => {
  const info = SOCIAL_PLATFORMS.find(p => p.key === platform) || { label: platform, color: '#888' };
  const sz = size === 'md' ? 'w-8 h-8 text-xs' : 'w-5 h-5 text-[8px]';
  return (
    <span
      className={`${sz} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ backgroundColor: info.color }}
      title={info.label}
    >
      {info.label.charAt(0)}
    </span>
  );
};

export const SocialAccountsPanel: React.FC<Props> = ({ brandName }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountInfo, setAccountInfo] = useState<{ email: string; plan: string } | null>(null);
  const [dashTab, setDashTab] = useState<DashboardTab>('accounts');

  // Add profile form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [adding, setAdding] = useState(false);

  // Orphan recovery — used when the user hits the plan ceiling because
  // earlier failed Connect attempts left zombie profiles on the API key
  const [showRecover, setShowRecover] = useState(false);
  const [orphans, setOrphans] = useState<Array<SocialProfile & { owned: boolean; orphan: boolean }>>([]);
  const [loadingOrphans, setLoadingOrphans] = useState(false);
  const [actioningOrphan, setActioningOrphan] = useState<string | null>(null);

  // History
  const [postHistory, setPostHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Scheduled
  const [scheduled, setScheduled] = useState<any[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);

  // Analytics
  const [analytics, setAnalytics] = useState<Record<string, any>>({});
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [analyticsProfile, setAnalyticsProfile] = useState('');

  // Connect flow (opens in new tab)
  const [showConnect, setShowConnect] = useState(false);
  const [connectProfile, setConnectProfile] = useState('');
  const [loadingConnect, setLoadingConnect] = useState(false);

  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profs, info] = await Promise.all([
        getProfiles(userId).catch(() => []),
        verifyAccount().catch(() => null),
      ]);
      setProfiles(profs);
      setAccountInfo(info);
      if (profs.length > 0 && !analyticsProfile) {
        setAnalyticsProfile(profs[0].username);
      }

      // ── Auto-claim orphan profiles ─────────────────────────────────────
      // If we got 0 owned profiles back, check whether there are any
      // unclaimed profiles on the API key (created via earlier failed
      // attempts, or directly on upload-post.com). Auto-claim them so
      // the user doesn't have to click "Recover existing" manually.
      if (profs.length === 0 && userId) {
        try {
          const allData = await listAllProfiles(userId);
          const unclaimed = (allData.profiles || []).filter(p => p.orphan);
          if (unclaimed.length > 0) {
            console.log(`[SocialAccounts] Auto-claiming ${unclaimed.length} orphan profile(s):`, unclaimed.map(p => p.username));
            for (const p of unclaimed) {
              try { await claimProfile(p.username, userId); }
              catch (err) { console.warn('[SocialAccounts] auto-claim failed for', p.username, err); }
            }
            // Re-fetch the now-claimed profiles
            const refreshed = await getProfiles(userId).catch(() => []);
            setProfiles(refreshed);
            if (refreshed.length > 0 && !analyticsProfile) {
              setAnalyticsProfile(refreshed[0].username);
            }
          }
        } catch (err) {
          console.warn('[SocialAccounts] auto-claim flow failed:', err);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Get usernames owned by this user (for filtering history/scheduled)
  const ownedUsernames = profiles.map(p => p.username);

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const data = await getHistory(1, 50, userId);
      const allPosts = data.data || data.history || data || [];
      // Filter to only show posts from this user's profiles
      const filtered = ownedUsernames.length > 0
        ? allPosts.filter((post: any) => ownedUsernames.includes(post.username || post.user || post.profile))
        : [];
      setPostHistory(filtered);
    } catch { setPostHistory([]); }
    finally { setLoadingHistory(false); }
  };

  const loadScheduled = async () => {
    setLoadingScheduled(true);
    try {
      const data = await getScheduledPosts(userId);
      const allScheduled = Array.isArray(data) ? data : [];
      // Filter to only show scheduled posts from this user's profiles
      const filtered = ownedUsernames.length > 0
        ? allScheduled.filter((post: any) => ownedUsernames.includes(post.username || post.user || post.profile))
        : [];
      setScheduled(filtered);
    } catch { setScheduled([]); }
    finally { setLoadingScheduled(false); }
  };

  const loadAnalytics = async (username: string) => {
    if (!username) return;
    setLoadingAnalytics(true);
    try {
      const data = await getProfileAnalytics(username);
      setAnalytics(data);
    } catch { setAnalytics({}); }
    finally { setLoadingAnalytics(false); }
  };

  useEffect(() => { loadProfiles(); }, []);

  useEffect(() => {
    if (dashTab === 'history') loadHistory();
    if (dashTab === 'scheduled') loadScheduled();
    if (dashTab === 'analytics' && analyticsProfile) loadAnalytics(analyticsProfile);
  }, [dashTab]);

  const handleAddProfile = async () => {
    const sanitized = newUsername.trim().replace(/[^a-zA-Z0-9_@-]/g, '_');
    if (!sanitized) { setError('Enter a valid username'); return; }
    setAdding(true);
    setError(null);
    try {
      const result = await createProfile({ username: sanitized, user_id: userId });
      setNewUsername('');
      setShowAddForm(false);
      await loadProfiles();
    } catch (e: any) {
      const msg = String(e?.message || '');
      // Detect the plan-limit error and auto-open the recovery panel so the
      // user can claim/delete orphan profiles instead of just seeing the
      // dead-end "limit reached" toast.
      if (/limit|maximum|5 profiles|reach/i.test(msg)) {
        setError(`${msg}. Opening "Recover existing profiles" — claim or delete profiles created by earlier failed attempts to free up slots.`);
        setShowAddForm(false);
        await loadOrphans();
      } else {
        setError(msg);
      }
    } finally {
      setAdding(false);
    }
  };

  // Load every profile on the API key so the user can claim or delete the
  // ones we've lost track of (orphans created before the ownership-write fix)
  const loadOrphans = async () => {
    if (!userId) return;
    setLoadingOrphans(true);
    setShowRecover(true);
    try {
      const data = await listAllProfiles(userId);
      setOrphans(data.profiles || []);
    } catch (e: any) {
      setError(`Failed to load existing profiles: ${e?.message || 'unknown'}`);
    } finally {
      setLoadingOrphans(false);
    }
  };

  const handleClaimOrphan = async (username: string) => {
    if (!userId) return;
    setActioningOrphan(username);
    try {
      await claimProfile(username, userId);
      await loadProfiles();          // refresh the main list — should now include this profile
      await loadOrphans();           // refresh orphan list — claimed flag flips
    } catch (e: any) {
      setError(`Failed to claim "${username}": ${e?.message}`);
    } finally {
      setActioningOrphan(null);
    }
  };

  const handleDeleteOrphan = async (username: string) => {
    if (!confirm(`Delete profile "${username}" from Upload Post? This frees up a plan slot but disconnects any platforms linked to it. Cannot be undone.`)) return;
    if (!userId) return;
    setActioningOrphan(username);
    try {
      await deleteProfile(username, userId);
      await loadOrphans();
    } catch (e: any) {
      setError(`Failed to delete "${username}": ${e?.message}`);
    } finally {
      setActioningOrphan(null);
    }
  };

  const handleDeleteProfile = async (username: string) => {
    if (!confirm(`Remove profile "${username}"? This will disconnect all social accounts linked to it.`)) return;
    try {
      await deleteProfile(username, userId);
      await loadProfiles();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleCancelScheduled = async (jobId: string) => {
    if (!confirm('Cancel this scheduled post?')) return;
    try {
      await cancelScheduledPost(jobId);
      await loadScheduled();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Connect a single platform to a profile (clickable platform pill).
  // Same flow as openConnect but filtered to one platform so the user
  // lands directly on that platform's OAuth screen.
  const openConnectForPlatform = async (username: string, platformKey: string) => {
    setConnectProfile(username);
    setLoadingConnect(true);
    setError(null);
    try {
      const result = await generateConnectUrl(username, {
        userId,
        platforms: [platformKey],
        connectTitle: `Connect ${platformKey} to ${username}`,
      });
      console.log(`[SocialAccounts] Per-platform connect URL for ${platformKey}:`, result.access_url);
      const win = window.open(result.access_url, '_blank', 'noopener');
      if (!win || win.closed) {
        const ok = window.confirm('Popup blocked. Click OK to open the connect page in this tab.');
        if (ok) { window.location.href = result.access_url; return; }
        setError('Popup blocked. Allow popups and try again.');
        return;
      }
      setShowConnect(true);
    } catch (e: any) {
      console.error('[SocialAccounts] Per-platform connect failed:', e);
      setError(`Connect ${platformKey} failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setLoadingConnect(false);
    }
  };

  const openConnect = async (username: string) => {
    setConnectProfile(username);
    setLoadingConnect(true);
    setError(null);
    try {
      // Pass userId so Upload-Post can isolate the JWT to this account
      const result = await generateConnectUrl(username, { userId });
      console.log('[SocialAccounts] Got connect URL, opening:', result.access_url);

      // Open in new tab. If a popup blocker stops it, fall back to same-tab
      // navigation so the user isn't stuck. We pass `noopener` for safety
      // but accept that means we can't communicate back — the auto-poll
      // below detects connection completion instead.
      const win = window.open(result.access_url, '_blank', 'noopener');
      if (!win || win.closed || typeof win.closed === 'undefined') {
        // Popup blocked — open in same tab as fallback. This loses our
        // session but better than the user being stuck. (Alternatively
        // we could show a toast asking them to allow popups.)
        const userChoice = window.confirm(
          'Your browser blocked the connect popup. Click OK to open the connect page in this tab (you\'ll be brought back automatically), or Cancel to allow popups in your browser settings.'
        );
        if (userChoice) {
          window.location.href = result.access_url;
          return;
        }
        setError('Popup blocked. Please allow popups for this site and try again.');
        return;
      }

      // Show the "connecting…" banner with auto-poll messaging
      setShowConnect(true);
    } catch (e: any) {
      console.error('[SocialAccounts] Connect URL generation failed:', e);
      setError(`Connect failed: ${e?.message || 'Unknown error'}. Check that UPLOAD_POST_API_KEY is set on the server.`);
    } finally {
      setLoadingConnect(false);
    }
  };

  // Auto-poll while the connect tab is open. Once we detect that the profile
  // has at least one connected platform, dismiss the banner and refresh.
  // Polls every 5 seconds — Upload Post returns the connection status fast.
  useEffect(() => {
    if (!showConnect || !connectProfile || !userId) return;
    let cancelled = false;
    const pollInterval = setInterval(async () => {
      if (cancelled) return;
      try {
        const profiles = await getProfiles(userId);
        const me = profiles.find((p: any) => p.username === connectProfile);
        const hasConnection = me && me.social_accounts && Object.values(me.social_accounts).some((v: any) => v && String(v).length > 0);
        if (hasConnection) {
          console.log(`[SocialAccounts] Detected connection for ${connectProfile} — closing banner`);
          if (!cancelled) {
            setShowConnect(false);
            setProfiles(profiles);
            // Notify any listening components (e.g. global popup) that connection landed
            window.dispatchEvent(new CustomEvent('upload-post:connected', { detail: { profile: connectProfile } }));
          }
        }
      } catch { /* ignore transient errors */ }
    }, 5000);
    return () => { cancelled = true; clearInterval(pollInterval); };
  }, [showConnect, connectProfile, userId]);

  const getPlatformInfo = (key: string) => SOCIAL_PLATFORMS.find(p => p.key === key) || { key, label: key, color: '#888' };

  // Extract connected platforms from a profile's social_accounts object
  const getConnectedPlatforms = (profile: SocialProfile): string[] => {
    const accts = profile.social_accounts || {};
    return Object.entries(accts)
      .filter(([, val]) => val && val !== '')
      .map(([key]) => key);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-brand" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">Social Dashboard</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Manage social media for {brandName}
            {accountInfo && <span className="ml-2 text-brand">({accountInfo.plan} plan)</span>}
          </p>
        </div>
        <button
          onClick={loadProfiles}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-text-secondary text-xs hover:text-text-primary hover:border-text-secondary transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-red-400 text-xs">
          <XCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="flex-shrink-0"><X size={12} /></button>
        </div>
      )}

      {/* Dashboard Tabs */}
      <div className="flex items-center gap-1 bg-surface/40 border border-white/5 rounded-full p-0.5 w-fit">
        {([
          { key: 'accounts' as DashboardTab, icon: Link2, label: 'Accounts' },
          { key: 'history' as DashboardTab, icon: History, label: 'Post History' },
          { key: 'scheduled' as DashboardTab, icon: Calendar, label: 'Scheduled' },
          { key: 'analytics' as DashboardTab, icon: BarChart3, label: 'Analytics' },
        ]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setDashTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              dashTab === tab.key
                ? 'bg-brand text-bg shadow-lg shadow-brand/20'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/5'
            }`}
          >
            <tab.icon size={12} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Accounts Tab ═══ */}
      {dashTab === 'accounts' && (
        <div className="space-y-4">

          {/* Profile Cards */}
          {profiles.length > 0 && (
            <div className="space-y-3">
              {profiles.map((profile, i) => {
                const connected = getConnectedPlatforms(profile);
                const allPlatforms = SOCIAL_PLATFORMS;
                return (
                  <div key={profile.username || i} className="bg-surface border border-border rounded-xl overflow-hidden">
                    {/* Profile header */}
                    <div className="flex items-center gap-3 p-4">
                      <div className="w-10 h-10 rounded-full bg-brand/10 border border-brand/20 flex items-center justify-center text-brand font-bold text-sm">
                        {profile.username?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary">{profile.username}</p>
                        <p className="text-[10px] text-text-secondary">
                          {connected.length > 0
                            ? `${connected.length} platform${connected.length > 1 ? 's' : ''} connected`
                            : 'No platforms connected yet'}
                        </p>
                      </div>
                      <button
                        onClick={() => openConnect(profile.username)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-bg text-xs font-bold hover:opacity-90 transition-all"
                      >
                        <Plus size={12} /> Connect
                      </button>
                      <button
                        onClick={() => { setAnalyticsProfile(profile.username); setDashTab('analytics'); }}
                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-text-secondary text-[10px] hover:text-brand hover:border-brand/30 transition-colors"
                      >
                        <BarChart3 size={10} />
                      </button>
                      <button
                        onClick={() => handleDeleteProfile(profile.username)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-text-secondary hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Platform connection grid — each pill is a clickable
                        button that opens the OAuth flow for THAT platform.
                        Connected platforms show a green check + still let
                        you re-auth (useful when a token expires). */}
                    <div className="px-4 pb-4">
                      <p className="text-[10px] text-text-secondary mb-2">Click a platform to connect it to <span className="text-text-primary font-semibold">{profile.username}</span>:</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                        {allPlatforms.map(p => {
                          const isConnected = connected.includes(p.key);
                          const isLoading = loadingConnect && connectProfile === profile.username;
                          return (
                            <button
                              key={p.key}
                              onClick={() => openConnectForPlatform(profile.username, p.key)}
                              disabled={isLoading}
                              title={isConnected
                                ? `${p.label} connected — click to re-auth or switch account`
                                : `Connect ${p.label} to ${profile.username}`}
                              className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-wait ${
                                isConnected
                                  ? 'border-emerald-800/40 bg-emerald-950/30 hover:border-emerald-500/60 hover:bg-emerald-950/50'
                                  : 'border-white/10 bg-white/[0.02] hover:border-brand/40 hover:bg-brand/5'
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                              <span className={`text-[11px] font-medium truncate ${isConnected ? 'text-emerald-400' : 'text-text-secondary group-hover:text-text-primary'}`}>
                                {p.label}
                              </span>
                              {isConnected
                                ? <CheckCircle2 size={11} className="text-emerald-500 ml-auto flex-shrink-0" />
                                : <Plus size={11} className="text-text-secondary/40 group-hover:text-brand ml-auto flex-shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-text-secondary/60 mt-2 italic">
                        Or use <button onClick={() => openConnect(profile.username)} className="text-brand hover:underline font-medium">"Connect all platforms"</button> to open Upload Post's combined connect page.
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state / Add profile */}
          {profiles.length === 0 && !showAddForm && !showRecover && (
            <div className="text-center py-12 bg-surface border border-border rounded-xl">
              <Share2 size={32} className="text-text-secondary mx-auto mb-4 opacity-40" />
              <h3 className="text-text-primary font-semibold mb-1">Connect your social accounts</h3>
              <p className="text-text-secondary text-xs mb-4 max-w-sm mx-auto">
                Create a profile to start publishing to Instagram, TikTok, X, LinkedIn, and 7 more platforms.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:opacity-90 transition-all"
                >
                  <Plus size={14} /> Create Profile
                </button>
                <button
                  onClick={loadOrphans}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-border text-text-secondary text-xs hover:text-text-primary hover:border-text-secondary transition-colors"
                  title="View profiles that exist on Upload Post but aren't linked to this account"
                >
                  Recover existing
                </button>
              </div>
            </div>
          )}

          {/* Orphan recovery panel — lists every profile on the Upload Post API
              key. User can Claim (link to current account) or Delete (free a
              plan slot). Shown when user hits limit or explicitly clicks
              "Recover existing". */}
          {showRecover && (
            <div className="bg-surface border border-amber-500/30 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
                    <AlertTriangle size={14} /> Recover existing profiles
                  </h3>
                  <p className="text-[11px] text-text-secondary mt-1 leading-relaxed">
                    These profiles exist on Upload Post but aren't linked to your account yet.
                    Claim ones you want to use, or delete unused ones to free up plan slots
                    (basic plan = max 5 profiles).
                  </p>
                </div>
                <button onClick={() => setShowRecover(false)} className="text-text-secondary hover:text-text-primary"><X size={14} /></button>
              </div>
              {loadingOrphans ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="animate-spin text-text-secondary" />
                </div>
              ) : orphans.length === 0 ? (
                <p className="text-xs text-text-secondary text-center py-4">No profiles found on the API key.</p>
              ) : (
                <div className="space-y-2">
                  {orphans.map(p => {
                    const connectedPlatforms = p.social_accounts ? Object.entries(p.social_accounts).filter(([, v]) => v && v !== '').map(([k]) => k) : [];
                    return (
                      <div key={p.username} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-bg/40 border border-white/[0.04]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-text-primary truncate">{p.username}</span>
                            {p.owned && <span className="text-[9px] uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">Yours</span>}
                            {p.orphan && <span className="text-[9px] uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">Orphan</span>}
                          </div>
                          {connectedPlatforms.length > 0 && (
                            <p className="text-[10px] text-text-secondary mt-0.5">Connected: {connectedPlatforms.join(', ')}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {p.orphan && (
                            <button
                              onClick={() => handleClaimOrphan(p.username)}
                              disabled={actioningOrphan === p.username}
                              className="px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/20 transition disabled:opacity-50"
                            >
                              {actioningOrphan === p.username ? <Loader2 size={10} className="animate-spin" /> : 'Claim'}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteOrphan(p.username)}
                            disabled={actioningOrphan === p.username}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
                            title="Delete profile from Upload Post (frees a plan slot)"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <p className="text-[10px] text-text-secondary/60">
                  {orphans.filter(o => o.owned).length} owned · {orphans.filter(o => o.orphan).length} orphaned · {orphans.length} of 5 plan slots used
                </p>
                <button onClick={loadOrphans} className="text-[11px] text-text-secondary hover:text-text-primary flex items-center gap-1">
                  <RefreshCw size={10} /> Refresh
                </button>
              </div>
            </div>
          )}

          {/* Add Profile button (when profiles exist) */}
          {profiles.length > 0 && !showAddForm && (
            <button
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border text-text-secondary text-xs font-medium hover:border-brand hover:text-brand transition-colors"
            >
              <Plus size={14} /> Add Another Profile
            </button>
          )}

          {/* Add Profile Form */}
          {showAddForm && (
            <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest">Create Profile</h3>
                <button onClick={() => setShowAddForm(false)} className="text-text-secondary hover:text-text-primary"><X size={14} /></button>
              </div>
              <p className="text-[10px] text-text-secondary leading-relaxed">
                A profile is your publishing identity. Give it a name (e.g. your brand name or handle).
                After creating, click <strong>Connect</strong> to link your social accounts to it.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value.replace(/[^a-zA-Z0-9_@-]/g, '_'))}
                  placeholder="e.g. my_brand or @handle"
                  className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-text-primary text-sm placeholder-text-secondary focus:outline-none focus:border-brand transition-colors"
                  onKeyDown={e => e.key === 'Enter' && handleAddProfile()}
                  autoFocus
                />
                <button
                  onClick={handleAddProfile}
                  disabled={adding || !newUsername.trim()}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-brand text-bg text-xs font-bold disabled:opacity-50 hover:opacity-90 transition-all"
                >
                  {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Create
                </button>
              </div>
              <p className="text-[9px] text-text-secondary">Only letters, numbers, underscores, hyphens, and @ allowed.</p>
            </div>
          )}

          {/* How it works */}
          <div className="bg-surface/50 border border-white/5 rounded-xl p-4">
            <h4 className="text-[10px] font-bold text-text-secondary uppercase tracking-widest mb-2">How it works</h4>
            <div className="grid grid-cols-3 gap-3">
              {[
                { step: '1', title: 'Create Profile', desc: 'Give your publishing identity a name' },
                { step: '2', title: 'Connect Platforms', desc: 'Link Instagram, TikTok, X, etc.' },
                { step: '3', title: 'Publish', desc: 'Post from Calendar or Chat to all platforms' },
              ].map(s => (
                <div key={s.step} className="text-center">
                  <div className="w-6 h-6 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-bold flex items-center justify-center mx-auto mb-1.5">{s.step}</div>
                  <p className="text-xs font-medium text-text-primary">{s.title}</p>
                  <p className="text-[9px] text-text-secondary mt-0.5">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Post History Tab ═══ */}
      {dashTab === 'history' && (
        <div className="space-y-3">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>
          ) : postHistory.length === 0 ? (
            <div className="text-center py-16 bg-surface border border-border rounded-xl">
              <History size={24} className="text-text-secondary mx-auto mb-3 opacity-50" />
              <p className="text-text-secondary text-sm">No posts yet.</p>
              <p className="text-text-secondary text-xs mt-1">Published posts will appear here.</p>
            </div>
          ) : (
            postHistory.map((post, i) => {
              const platform = getPlatformInfo(post.platform);
              return (
                <div key={post.id || i} className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <span className="w-3 h-3 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: platform.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-text-primary">{platform.label}</span>
                        <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded ${post.success !== false ? 'bg-emerald-950/50 text-emerald-400' : 'bg-red-950/50 text-red-400'}`}>
                          {post.success !== false ? 'SUCCESS' : 'FAILED'}
                        </span>
                        {post.profile_username && (
                          <span className="text-[10px] text-text-secondary">@{post.profile_username}</span>
                        )}
                      </div>
                      {(post.caption || post.text) && (
                        <p className="text-xs text-text-secondary line-clamp-2">{post.caption || post.text}</p>
                      )}
                      <p className="text-[10px] text-text-secondary mt-1.5">
                        {post.timestamp ? new Date(post.timestamp).toLocaleString() : post.created_at ? new Date(post.created_at).toLocaleString() : ''}
                      </p>
                    </div>
                    {post.media_url && (
                      <img src={post.media_url} alt="" className="w-12 h-12 rounded-lg object-cover border border-border flex-shrink-0" />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ═══ Scheduled Tab ═══ */}
      {dashTab === 'scheduled' && (
        (() => {
          // Group scheduled posts by date for a calendar-style view
          const grouped: Record<string, any[]> = {};
          for (const post of scheduled) {
            const dateKey = post.scheduled_date
              ? new Date(post.scheduled_date).toISOString().slice(0, 10)
              : 'unscheduled';
            if (!grouped[dateKey]) grouped[dateKey] = [];
            grouped[dateKey].push(post);
          }
          // Sort dates ascending, sort posts within each date by time
          const sortedDates = Object.keys(grouped).sort();
          for (const d of sortedDates) {
            grouped[d].sort((a, b) =>
              new Date(a.scheduled_date || 0).getTime() - new Date(b.scheduled_date || 0).getTime()
            );
          }
          // Friendly date label (Today, Tomorrow, weekday + date)
          const dateLabel = (iso: string) => {
            if (iso === 'unscheduled') return 'Unscheduled';
            const d = new Date(iso + 'T00:00:00');
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const tom = new Date(today); tom.setDate(today.getDate() + 1);
            if (d.toDateString() === today.toDateString()) return `Today · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
            if (d.toDateString() === tom.toDateString()) return `Tomorrow · ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
            return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
          };
          return (
            <div className="space-y-4">
              {loadingScheduled ? (
                <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>
              ) : scheduled.length === 0 ? (
                <div className="text-center py-16 bg-surface border border-border rounded-xl">
                  <Calendar size={24} className="text-text-secondary mx-auto mb-3 opacity-50" />
                  <p className="text-text-secondary text-sm">No scheduled posts.</p>
                  <p className="text-text-secondary text-xs mt-1">Approved posts on the calendar publish automatically — they'll appear here.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-text-secondary">
                      <span className="text-text-primary font-bold">{scheduled.length}</span> scheduled post{scheduled.length !== 1 ? 's' : ''} across <span className="text-text-primary font-bold">{sortedDates.length}</span> day{sortedDates.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  {sortedDates.map(d => (
                    <div key={d} className="space-y-2">
                      <div className="flex items-center gap-2 sticky top-0 bg-bg/95 backdrop-blur-sm py-1 z-10">
                        <span className="text-[11px] uppercase tracking-wider text-brand font-bold">{dateLabel(d)}</span>
                        <span className="text-[10px] text-text-secondary/50">· {grouped[d].length} post{grouped[d].length !== 1 ? 's' : ''}</span>
                        <span className="flex-1 h-px bg-white/[0.05]" />
                      </div>
                      {grouped[d].map((post, i) => {
                        const time = post.scheduled_date ? new Date(post.scheduled_date).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '—';
                        return (
                          <div key={post.job_id || i} className="bg-surface border border-border rounded-xl p-3 hover:border-white/10 transition-colors">
                            <div className="flex items-start gap-3">
                              <div className="flex-shrink-0 text-center w-14">
                                <div className="text-xs font-bold text-brand">{time}</div>
                                <div className="text-[9px] uppercase tracking-wider text-text-secondary/50 mt-0.5">scheduled</div>
                              </div>
                              <div className="w-px self-stretch bg-white/[0.06]" />
                              <div className="flex-1 min-w-0">
                                {post.platforms && (
                                  <div className="flex flex-wrap gap-1 mb-1.5">
                                    {(Array.isArray(post.platforms) ? post.platforms : [post.platforms]).map((p: string) => {
                                      const info = getPlatformInfo(p);
                                      return (
                                        <span key={p} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] text-text-secondary">
                                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.color }} />
                                          {info.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                                {(post.caption || post.text || post.title) && (
                                  <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed">
                                    {post.caption || post.text || post.title}
                                  </p>
                                )}
                                {post.profile_username && (
                                  <p className="text-[10px] text-text-secondary/40 mt-1">@{post.profile_username}</p>
                                )}
                              </div>
                              <button
                                onClick={() => handleCancelScheduled(post.job_id)}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-red-400 text-[10px] hover:bg-red-500/10 transition-colors flex-shrink-0"
                                title="Cancel scheduled post"
                              >
                                <X size={10} /> Cancel
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })()
      )}

      {/* ═══ Analytics Tab ═══ */}
      {dashTab === 'analytics' && (() => {
        // Upload Post's /api/analytics/{username} returns per-platform stats.
        // Shape varies — try several common locations and aggregate.
        const platformsData: Record<string, any> = (() => {
          if (!analytics) return {};
          // Common shape: { instagram: {...}, tiktok: {...} }
          if (analytics.instagram || analytics.tiktok || analytics.facebook || analytics.linkedin || analytics.youtube || analytics.x || analytics.threads || analytics.pinterest) {
            return analytics;
          }
          // Nested: { platforms: { ... } }
          if (analytics.platforms && typeof analytics.platforms === 'object') return analytics.platforms;
          // Single-platform flat shape
          if (analytics.followers != null || analytics.reach != null || analytics.impressions != null) {
            return { all: analytics };
          }
          return {};
        })();
        const platformKeys = Object.keys(platformsData);
        // Sum across platforms for the headline cards
        const sum = (key: string) => platformKeys.reduce((acc, k) => acc + (Number(platformsData[k]?.[key]) || 0), 0);
        const followers = sum('followers');
        const reach = sum('reach');
        const impressions = sum('impressions') || sum('views');
        const likes = sum('likes');
        const comments = sum('comments');
        const shares = sum('shares');

        // Pull a reach timeseries from any platform that has one
        const timeseries: Array<{ date: string; value: number }> = (() => {
          for (const k of platformKeys) {
            const ts = platformsData[k]?.reach_timeseries || platformsData[k]?.timeseries;
            if (Array.isArray(ts) && ts.length) {
              return ts.map((t: any) => ({
                date: t.date || t.day || t.timestamp || '',
                value: Number(t.value || t.reach || t.impressions || 0),
              })).filter(p => p.date);
            }
          }
          return [];
        })();
        const tsMax = Math.max(1, ...timeseries.map(t => t.value));

        const hasData = followers > 0 || reach > 0 || impressions > 0 || platformKeys.length > 0;

        return (
          <div className="space-y-4">
            {profiles.length > 1 && (
              <select
                value={analyticsProfile}
                onChange={e => { setAnalyticsProfile(e.target.value); loadAnalytics(e.target.value); }}
                className="bg-surface border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-brand"
              >
                {profiles.map(p => (
                  <option key={p.username} value={p.username}>{p.username}</option>
                ))}
              </select>
            )}

            {loadingAnalytics ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>
            ) : !hasData ? (
              <div className="text-center py-16 bg-surface border border-border rounded-xl">
                <BarChart3 size={24} className="text-text-secondary mx-auto mb-3 opacity-50" />
                <p className="text-text-secondary text-sm">No analytics data yet.</p>
                <p className="text-text-secondary text-xs mt-1">Connect platforms + publish a few posts. Analytics populate within ~24 hours.</p>
              </div>
            ) : (
              <>
                {/* Sources row — which platforms contributed to this aggregate */}
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface border border-border">
                  <span className="text-[10px] uppercase tracking-wider text-text-secondary/60 font-bold">Sources:</span>
                  <div className="flex items-center gap-1.5">
                    {platformKeys.filter(k => k !== 'all').map(k => {
                      const info = getPlatformInfo(k);
                      return (
                        <span key={k} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.02] border border-white/10 rounded text-[10px] text-text-secondary">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: info.color }} />
                          {info.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Headline metric cards — Followers / Reach / Impressions */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Followers', value: followers, icon: TrendingUp, color: 'text-brand' },
                    { label: 'Reach', value: reach, icon: Eye, color: 'text-violet-400' },
                    { label: 'Impressions', value: impressions, icon: Eye, color: 'text-blue-400' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-surface border border-border rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">{stat.label}</span>
                        <stat.icon size={14} className={stat.color} />
                      </div>
                      <p className="text-2xl font-bold text-text-primary">{Number(stat.value).toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {/* 30-day chart from reach_timeseries */}
                {timeseries.length > 0 && (
                  <div className="bg-surface border border-border rounded-xl p-4">
                    <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">Reach — Last {timeseries.length} Days</p>
                    <div className="flex items-end gap-1 h-32">
                      {timeseries.map((t, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-gradient-to-t from-brand/30 to-brand/60 rounded-sm hover:from-brand/40 hover:to-brand/80 transition-colors relative group"
                          style={{ height: `${Math.max(2, (t.value / tsMax) * 100)}%` }}
                          title={`${t.date}: ${t.value.toLocaleString()}`}
                        >
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-bg border border-border rounded text-[10px] text-text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                            {t.date}: {t.value.toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between mt-2 text-[10px] text-text-secondary/50">
                      <span>{timeseries[0]?.date}</span>
                      <span>{timeseries[timeseries.length - 1]?.date}</span>
                    </div>
                  </div>
                )}

                {/* Engagement summary */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Likes', value: likes, icon: Heart, color: 'text-red-400' },
                    { label: 'Comments', value: comments, icon: MessageCircle, color: 'text-amber-400' },
                    { label: 'Shares', value: shares, icon: Share2, color: 'text-emerald-400' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-surface border border-border rounded-xl p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <stat.icon size={12} className={stat.color} />
                        <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">{stat.label}</span>
                      </div>
                      <p className="text-lg font-bold text-text-primary">{Number(stat.value).toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {/* Per-platform breakdown */}
                {platformKeys.filter(k => k !== 'all').length > 1 && (
                  <div className="bg-surface border border-border rounded-xl p-4">
                    <p className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">By Platform</p>
                    <div className="space-y-2">
                      {platformKeys.filter(k => k !== 'all').map(k => {
                        const info = getPlatformInfo(k);
                        const p = platformsData[k] || {};
                        return (
                          <div key={k} className="flex items-center justify-between gap-3 p-2 rounded-lg bg-bg/40 border border-white/[0.04]">
                            <div className="flex items-center gap-2 flex-shrink-0 w-32">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: info.color }} />
                              <span className="text-xs font-semibold text-text-primary capitalize">{info.label}</span>
                            </div>
                            <div className="flex items-center gap-4 text-xs flex-1 justify-end">
                              <span className="text-text-secondary"><span className="text-text-primary font-bold">{Number(p.followers || 0).toLocaleString()}</span> followers</span>
                              <span className="text-text-secondary"><span className="text-text-primary font-bold">{Number(p.reach || 0).toLocaleString()}</span> reach</span>
                              <span className="text-text-secondary"><span className="text-text-primary font-bold">{Number(p.impressions || p.views || 0).toLocaleString()}</span> impressions</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {/* ═══ Connect Banner (shown after opening OAuth tab) ═══ */}
      {showConnect && (
        <div className="bg-brand/10 border border-brand/30 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0">
            <ExternalLink size={18} className="text-brand" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-text-primary">Connecting {connectProfile}...</p>
            <p className="text-xs text-text-secondary mt-0.5">
              A new tab opened with the connection page. Log into each platform (Instagram, TikTok, X, etc.) to connect them. Come back here when done.
            </p>
          </div>
          <button
            onClick={() => { setShowConnect(false); loadProfiles(); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-bg text-xs font-bold hover:opacity-90 transition-all flex-shrink-0"
          >
            <RefreshCw size={12} /> I'm Done — Refresh
          </button>
        </div>
      )}
    </div>
  );
};
