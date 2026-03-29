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
      const data = await getHistory(1, 50);
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
      const data = await getScheduledPosts();
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
      setError(e.message);
    } finally {
      setAdding(false);
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

  const openConnect = async (username: string) => {
    setConnectProfile(username);
    setLoadingConnect(true);
    setError(null);
    try {
      const result = await generateConnectUrl(username);
      // Open in new tab — Upload-Post blocks iframes
      window.open(result.access_url, '_blank', 'noopener');
      // Show the "refresh after connecting" banner
      setShowConnect(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingConnect(false);
    }
  };

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

                    {/* Platform connection grid */}
                    <div className="px-4 pb-4">
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                        {allPlatforms.map(p => {
                          const isConnected = connected.includes(p.key);
                          return (
                            <div
                              key={p.key}
                              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-all ${
                                isConnected
                                  ? 'border-emerald-800/40 bg-emerald-950/30'
                                  : 'border-white/5 bg-white/[0.02] opacity-50'
                              }`}
                            >
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                              <span className={`text-[10px] truncate ${isConnected ? 'text-emerald-400 font-medium' : 'text-text-secondary'}`}>
                                {p.label}
                              </span>
                              {isConnected && <CheckCircle2 size={10} className="text-emerald-500 ml-auto flex-shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty state / Add profile */}
          {profiles.length === 0 && !showAddForm && (
            <div className="text-center py-12 bg-surface border border-border rounded-xl">
              <Share2 size={32} className="text-text-secondary mx-auto mb-4 opacity-40" />
              <h3 className="text-text-primary font-semibold mb-1">Connect your social accounts</h3>
              <p className="text-text-secondary text-xs mb-4 max-w-sm mx-auto">
                Create a profile to start publishing to Instagram, TikTok, X, LinkedIn, and 7 more platforms.
              </p>
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold mx-auto hover:opacity-90 transition-all"
              >
                <Plus size={14} /> Create Profile
              </button>
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
        <div className="space-y-3">
          {loadingScheduled ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-brand" /></div>
          ) : scheduled.length === 0 ? (
            <div className="text-center py-16 bg-surface border border-border rounded-xl">
              <Calendar size={24} className="text-text-secondary mx-auto mb-3 opacity-50" />
              <p className="text-text-secondary text-sm">No scheduled posts.</p>
              <p className="text-text-secondary text-xs mt-1">Schedule posts from the calendar to see them here.</p>
            </div>
          ) : (
            scheduled.map((post, i) => (
              <div key={post.job_id || i} className="bg-surface border border-border rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Clock size={12} className="text-brand" />
                      <span className="text-xs font-medium text-text-primary">
                        {post.scheduled_date ? new Date(post.scheduled_date).toLocaleString() : 'Pending'}
                      </span>
                    </div>
                    {post.platforms && (
                      <div className="flex gap-1 mb-1.5">
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
                    {(post.caption || post.text) && <p className="text-xs text-text-secondary line-clamp-2">{post.caption || post.text}</p>}
                  </div>
                  <button
                    onClick={() => handleCancelScheduled(post.job_id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-red-400 text-[10px] hover:bg-red-500/10 transition-colors flex-shrink-0"
                  >
                    <X size={10} /> Cancel
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══ Analytics Tab ═══ */}
      {dashTab === 'analytics' && (
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
          ) : Object.keys(analytics).length === 0 || (!analytics.followers && !analytics.impressions) ? (
            <div className="text-center py-16 bg-surface border border-border rounded-xl">
              <BarChart3 size={24} className="text-text-secondary mx-auto mb-3 opacity-50" />
              <p className="text-text-secondary text-sm">No analytics data yet.</p>
              <p className="text-text-secondary text-xs mt-1">Analytics will appear after you connect platforms and start publishing.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Followers', value: analytics.followers, icon: TrendingUp, color: 'text-brand' },
                  { label: 'Impressions', value: analytics.impressions, icon: Eye, color: 'text-blue-400' },
                  { label: 'Likes', value: analytics.likes, icon: Heart, color: 'text-red-400' },
                  { label: 'Comments', value: analytics.comments, icon: MessageCircle, color: 'text-amber-400' },
                ].map(stat => (
                  <div key={stat.label} className="bg-surface border border-border rounded-xl p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <stat.icon size={12} className={stat.color} />
                      <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">{stat.label}</span>
                    </div>
                    <p className="text-lg font-bold text-text-primary">
                      {stat.value != null ? Number(stat.value).toLocaleString() : '—'}
                    </p>
                  </div>
                ))}
              </div>
              {analytics.engagement_rate != null && (
                <div className="bg-surface border border-border rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Engagement Rate</span>
                    <span className="text-xl font-bold text-brand">{(analytics.engagement_rate * 100).toFixed(2)}%</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

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
