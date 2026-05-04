import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import QualityScoreBadge from './QualityScoreBadge';
import type { ApprovalQueueItem, ApprovalStatus, ContentFormat, SocialPlatform } from '../../types/brand.types';
import { SOCIAL_PLATFORMS } from '../../types/brand.types';

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: '📸', tiktok: '🎵', facebook: '📘', youtube: '📺',
  linkedin: '💼', x: '𝕏', pinterest: '📌', threads: '🧵',
};

interface ApprovalQueueProps {
  brandId: string;
  onRefresh?: () => void;
}

const FORMAT_LABELS: Record<ContentFormat, string> = { post: 'Post', story: 'Story', reel: 'Reel' };
const FORMAT_COLORS: Record<ContentFormat, string> = { post: 'bg-blue-500/20 text-blue-400', story: 'bg-purple-500/20 text-purple-400', reel: 'bg-pink-500/20 text-pink-400' };
const PILLAR_COLORS = ['bg-violet-500/20 text-violet-400', 'bg-cyan-500/20 text-cyan-400', 'bg-amber-500/20 text-amber-400', 'bg-rose-500/20 text-rose-400', 'bg-lime-500/20 text-lime-400'];
const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  auto_approved: 'bg-teal-500/20 text-teal-400',
  expired: 'bg-zinc-500/20 text-zinc-400',
};
const STATUS_ICONS: Record<ApprovalStatus, string> = {
  pending: '',
  approved: '',
  rejected: '',
  auto_approved: '',
  expired: '',
};

// localStorage cache key — per brand, so multi-brand users don't conflict
const CACHE_KEY = (brandId: string) => `approval_queue_cache_${brandId}`;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function loadCachedItems(brandId: string): ApprovalQueueItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY(brandId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items: ApprovalQueueItem[]; cachedAt: number };
    if (!parsed?.items || !Array.isArray(parsed.items)) return [];
    if (Date.now() - (parsed.cachedAt || 0) > CACHE_TTL_MS) return [];
    return parsed.items;
  } catch { return []; }
}
function saveCachedItems(brandId: string, items: ApprovalQueueItem[]) {
  try {
    localStorage.setItem(CACHE_KEY(brandId), JSON.stringify({ items, cachedAt: Date.now() }));
  } catch { /* quota exceeded — ignore */ }
}
// Merge server response with cache: server is source of truth for items
// it returns, but if the server is empty (e.g. ephemeral filesystem wiped
// after a deploy) we keep the cache so the user still sees their work.
function mergeServerWithCache(server: ApprovalQueueItem[], cache: ApprovalQueueItem[]): ApprovalQueueItem[] {
  if (server.length > 0) {
    // Server has data: use server's items, but enrich with any cache-only
    // items the server doesn't know about (recovers from server file wipe).
    const serverIds = new Set(server.map(i => i.id));
    const orphaned = cache.filter(i => !serverIds.has(i.id));
    return [...server, ...orphaned];
  }
  // Server returned empty — fall back to cache entirely
  return cache;
}

export default function ApprovalQueue({ brandId, onRefresh }: ApprovalQueueProps) {
  const { user } = useAuth();
  // Hydrate from cache on first render so the UI never shows empty if
  // there's prior data to display, even before the server responds.
  const [items, setItems] = useState<ApprovalQueueItem[]>(() => loadCachedItems(brandId));
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [platformFilter, setPlatformFilter] = useState<SocialPlatform | 'all'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Re-hydrate cache when brandId changes (user switches brand)
  useEffect(() => {
    setItems(loadCachedItems(brandId));
  }, [brandId]);

  // Compare two queue lists for meaningful changes — used to skip setItems
  // when the server response matches what we're already rendering. Without
  // this, every poll replaces the array reference and React re-renders
  // every card, which makes open edit forms reset, focused inputs lose
  // focus, and images briefly disappear. We only compare the fields that
  // visibly drive the card so transient server-side timestamps don't force
  // a full re-render.
  const itemsChanged = (a: ApprovalQueueItem[], b: ApprovalQueueItem[]) => {
    if (a.length !== b.length) return true;
    const fingerprint = (it: ApprovalQueueItem) => {
      const i: any = it;
      return [
        i.id, i.status, i.scheduled_at, i.slot_date,
        i.generated_image ? i.generated_image.slice(0, 64) : '',
        i.generated_video || '',
        i.upload_post_job_id || '', i.upload_post_request_id || '',
        i.brief?.caption || '', i.brief?.hook || '',
        (i.brief?.hashtags || []).join(','), i.brief?.call_to_action || '',
        i.reviewer_notes || '', i.resubmitted_at || '',
      ].join('|');
    };
    const aMap = new Map(a.map(it => [it.id, fingerprint(it)]));
    for (const it of b) {
      if (aMap.get(it.id) !== fingerprint(it)) return true;
    }
    return false;
  };

  // Always fetch ALL statuses from the server, then filter client-side.
  // `silent=true` means a background poll: skip the loading spinner and
  // skip the state update entirely if nothing meaningful changed. This is
  // what stops the queue from flickering / unmounting cards while Priya
  // is generating, or while the 30s auto-poll fires.
  const fetchQueue = useCallback(async (silent: boolean = false) => {
    if (!user?.id) return;
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/approval-queue?brand_id=${brandId}&status=all&limit=200`, {
        headers: { 'x-user-id': user.id },
      });
      const data = await res.json();
      if (data.ok) {
        const serverItems: ApprovalQueueItem[] = data.items || [];
        const cached = loadCachedItems(brandId);
        const merged = mergeServerWithCache(serverItems, cached);
        setItems(prev => {
          // Only swap the array if the visible state actually changed.
          // Otherwise React keeps the same references and no card re-renders.
          if (!itemsChanged(prev, merged)) return prev;
          saveCachedItems(brandId, merged);
          return merged;
        });
      } else if (!silent) {
        setItems(loadCachedItems(brandId));
      }
    } catch (err) {
      if (!silent) {
        console.error('Failed to fetch approval queue:', err);
        setItems(loadCachedItems(brandId));
      }
    }
    if (!silent) setLoading(false);
  }, [user?.id, brandId]);

  // Initial fetch — uses the spinner so the user knows the queue is loading.
  useEffect(() => { fetchQueue(false); }, [fetchQueue]);

  // Persist any local mutation (approve / reject / inline edits) back to
  // the cache so it survives a tab close before the server refresh confirms it.
  useEffect(() => {
    if (!brandId) return;
    saveCachedItems(brandId, items);
  }, [items, brandId]);

  // Auto-refresh every 30s as long as any item is still pending. Pass
  // silent=true so the spinner doesn't flash and unchanged polls don't
  // replace the array (the equality check inside fetchQueue takes care
  // of the array swap).
  useEffect(() => {
    const hasPending = items.some(i => i.status === 'pending');
    if (!hasPending) return;
    const interval = setInterval(() => fetchQueue(true), 30000);
    return () => clearInterval(interval);
  }, [items, fetchQueue]);

  const handleApprove = async (id: string) => {
    if (!user?.id) return;
    setActionLoading(id);
    try {
      const res = await fetch(`/api/approval-queue/${id}/approve`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ platforms: [] }),
      });
      if ((await res.json()).ok) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'approved' as ApprovalStatus, resolved_at: new Date().toISOString() } : i));
        onRefresh?.();
      }
    } catch (err) {
      console.error('Approve failed:', err);
    }
    setActionLoading(null);
  };

  const handleReject = async (id: string, reason = '') => {
    if (!user?.id) return;
    setActionLoading(id);
    try {
      const res = await fetch(`/api/approval-queue/${id}/reject`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ reason }),
      });
      if ((await res.json()).ok) {
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'rejected' as ApprovalStatus, reviewer_notes: reason, resolved_at: new Date().toISOString() } : i));
        onRefresh?.();
      }
    } catch (err) {
      console.error('Reject failed:', err);
    }
    setActionLoading(null);
  };

  const handleBulkApprove = async () => {
    if (!user?.id || !selectedIds.size) return;
    setActionLoading('bulk');
    try {
      const res = await fetch('/api/approval-queue/bulk-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({ ids: Array.from(selectedIds), platforms: [] }),
      });
      if ((await res.json()).ok) {
        setItems(prev => prev.map(i => selectedIds.has(i.id) ? { ...i, status: 'approved' as ApprovalStatus, resolved_at: new Date().toISOString() } : i));
        setSelectedIds(new Set());
        onRefresh?.();
      }
    } catch (err) {
      console.error('Bulk approve failed:', err);
    }
    setActionLoading(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Platform counts (before platform filter, so pills show full universe)
  const platformCounts: Record<string, { total: number; auto: number }> = {};
  for (const it of items) {
    const p = ((it as any).platform || 'instagram') as string;
    if (!platformCounts[p]) platformCounts[p] = { total: 0, auto: 0 };
    platformCounts[p].total++;
    if ((it as any).auto_approve_on_sample_pass && it.status === 'pending') platformCounts[p].auto++;
  }
  const activePlatforms = Object.keys(platformCounts).sort();

  // Apply platform filter first
  const platformFiltered = platformFilter === 'all'
    ? items
    : items.filter(it => ((it as any).platform || 'instagram') === platformFilter);

  // Group A/B variants
  const groupedItems = platformFiltered.reduce<{ standalone: ApprovalQueueItem[]; abGroups: Map<string, ApprovalQueueItem[]> }>((acc, item) => {
    if (item.variant_group) {
      if (!acc.abGroups.has(item.variant_group)) acc.abGroups.set(item.variant_group, []);
      acc.abGroups.get(item.variant_group)!.push(item);
    } else {
      acc.standalone.push(item);
    }
    return acc;
  }, { standalone: [], abGroups: new Map() });

  // Filter displayed items based on status. Treat `auto_approved` as
  // `approved` from the user's perspective — both mean "accepted, scheduled".
  const filteredStandalone = filter === 'all'
    ? groupedItems.standalone
    : groupedItems.standalone.filter(i => {
        if (filter === 'approved') return i.status === 'approved' || i.status === 'auto_approved';
        return i.status === filter;
      });

  const getTimeRemaining = (autoApproveAt?: string) => {
    if (!autoApproveAt) return null;
    const diff = new Date(autoApproveAt).getTime() - Date.now();
    if (diff <= 0) return 'Auto-approving...';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  // Stats summary
  const pendingCount = items.filter(i => i.status === 'pending').length;
  const approvedCount = items.filter(i => i.status === 'approved').length;
  const rejectedCount = items.filter(i => i.status === 'rejected').length;

  return (
    <div className="space-y-5">
      {/* Header + Stats + Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-text-primary">Approval Queue</h3>
          {pendingCount > 0 && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 tabular-nums">
              {pendingCount} pending
            </span>
          )}
          {approvedCount > 0 && filter === 'all' && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 tabular-nums">
              {approvedCount} approved
            </span>
          )}
          {rejectedCount > 0 && filter === 'all' && (
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-red-500/20 text-red-400 tabular-nums">
              {rejectedCount} rejected
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-schedule: fills scheduled_at on every pending slot using a
              9 AM / 12 PM / 6 PM rotation. One click instead of clicking
              "Set" on every card. */}
          {items.some(i => i.status === 'pending') && (
            <button
              onClick={async () => {
                if (!brandId) return;
                if (!confirm('Auto-fill posting times for all pending posts (9 AM / 12 PM / 6 PM rotation)?')) return;
                const res = await fetch('/api/approval-queue/auto-schedule', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ brand_id: brandId }),
                });
                const data = await res.json();
                if (data.ok) { alert(`Scheduled ${data.scheduled} posts.`); fetchQueue(false); }
                else alert(data.error || 'Auto-schedule failed');
              }}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition flex items-center gap-1.5"
              title="Fill optimal posting times for all pending posts"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              Auto-fill times
            </button>
          )}
          {selectedIds.size > 0 && filter === 'pending' && (
            <button
              onClick={handleBulkApprove}
              disabled={actionLoading === 'bulk'}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {actionLoading === 'bulk' ? (
                <><div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> Approving...</>
              ) : (
                <>Approve {selectedIds.size} Selected</>
              )}
            </button>
          )}

          <div className="flex rounded-xl overflow-hidden border border-white/[0.06]">
            {(['pending', 'approved', 'rejected', 'all'] as const).map(f => {
              const count = f === 'all'
                ? items.length
                : items.filter(i => i.status === f || (f === 'approved' && i.status === 'auto_approved')).length;
              return (
                <button
                  key={f}
                  onClick={() => { setFilter(f); setSelectedIds(new Set()); }}
                  className={`px-3.5 py-1.5 text-xs capitalize font-medium transition flex items-center gap-1.5 ${filter === f ? 'bg-white/[0.08] text-text-primary' : 'bg-white/[0.02] text-text-secondary/50 hover:text-text-secondary'}`}
                >
                  <span>{f}</span>
                  <span className={`text-[10px] tabular-nums ${filter === f ? 'text-text-secondary' : 'text-text-secondary/40'}`}>({count})</span>
                </button>
              );
            })}
          </div>

          <button onClick={() => fetchQueue(false)} className="p-2 rounded-xl hover:bg-white/[0.04] text-text-secondary/50 hover:text-text-secondary transition" title="Refresh">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>

      {/* Platform filter pills */}
      {activePlatforms.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => { setPlatformFilter('all'); setSelectedIds(new Set()); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              platformFilter === 'all'
                ? 'bg-white/[0.08] text-text-primary border border-white/[0.12]'
                : 'bg-white/[0.03] text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.05] border border-white/[0.04]'
            }`}
          >
            <span>All</span>
            <span className="text-[10px] text-text-secondary/60 tabular-nums">({items.length})</span>
          </button>
          {activePlatforms.map(p => {
            const info = SOCIAL_PLATFORMS.find(sp => sp.key === p);
            const isActive = platformFilter === p;
            const count = platformCounts[p];
            return (
              <button
                key={p}
                onClick={() => { setPlatformFilter(p as SocialPlatform); setSelectedIds(new Set()); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'text-white shadow-sm'
                    : 'bg-white/[0.03] text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.05] border border-white/[0.04]'
                }`}
                style={isActive ? { backgroundColor: info?.color || '#666', borderColor: info?.color || '#666' } : undefined}
              >
                <span>{PLATFORM_EMOJI[p] || '📱'}</span>
                <span className="capitalize">{info?.label || p}</span>
                <span className={`text-[10px] tabular-nums ${isActive ? 'text-white/80' : 'text-text-secondary/60'}`}>
                  ({count.total}{count.auto ? ` · ${count.auto} auto` : ''})
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      )}

      {/* Empty state — truly empty (no items at all for this brand) */}
      {!loading && items.length === 0 && (
        <div className="text-center py-16 border border-dashed border-white/[0.06] rounded-2xl">
          <p className="text-base text-text-secondary mb-1">No items yet</p>
          <p className="text-sm text-text-secondary/50">Run the Review agent to populate the approval queue</p>
        </div>
      )}

      {/* Redirect state — items exist, but the current filter is empty.
          Usually means batch-level auto-approval flipped pending → approved
          in the background. Guide the user to the right pill instead of
          showing a scary "no items" message. */}
      {!loading && items.length > 0 && filteredStandalone.length === 0 && (
        <div className="text-center py-12 border border-dashed border-white/[0.06] rounded-2xl">
          <p className="text-base text-text-secondary mb-1">No {filter} items</p>
          <p className="text-sm text-text-secondary/60 mb-4">
            {filter === 'pending' && items.some(i => i.status === 'approved' || i.status === 'auto_approved')
              ? 'Looks like this batch was auto-approved. Your content is scheduled for publishing.'
              : `${items.length} item${items.length === 1 ? '' : 's'} exist under a different filter.`}
          </p>
          <div className="flex items-center justify-center gap-2">
            {filter !== 'approved' && items.filter(i => i.status === 'approved' || i.status === 'auto_approved').length > 0 && (
              <button
                onClick={() => setFilter('approved')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition"
              >
                View {items.filter(i => i.status === 'approved' || i.status === 'auto_approved').length} approved
              </button>
            )}
            {filter !== 'rejected' && items.filter(i => i.status === 'rejected').length > 0 && (
              <button
                onClick={() => setFilter('rejected')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition"
              >
                View {items.filter(i => i.status === 'rejected').length} rejected
              </button>
            )}
            {filter !== 'all' && (
              <button
                onClick={() => setFilter('all')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/[0.04] text-text-secondary border border-white/[0.08] hover:bg-white/[0.08] transition"
              >
                View all {items.length}
              </button>
            )}
          </div>
        </div>
      )}

      {/* A/B Variant Groups */}
      {Array.from(groupedItems.abGroups.entries()).map(([groupId, variants]) => (
        <div key={groupId} className="border border-violet-500/30 rounded-2xl p-5 bg-violet-500/5">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-violet-500/20 text-violet-400">A/B Test</span>
            <span className="text-xs text-text-secondary/50">Pick the better variant</span>
          </div>
          <div className="grid grid-cols-2 gap-5">
            {variants.map(item => (
              <ApprovalCard
                key={item.id}
                item={item}
                isAB
                isSelected={selectedIds.has(item.id)}
                isLoading={actionLoading === item.id}
                onApprove={() => handleApprove(item.id)}
                onReject={(reason) => handleReject(item.id, reason)}
                onToggleSelect={() => toggleSelect(item.id)}
                timeRemaining={getTimeRemaining(item.auto_approve_at)}
                isPending={item.status === 'pending'}
                onRefresh={fetchQueue}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Standalone Items — grouped by social platform */}
      {filteredStandalone.length > 0 && (() => {
        // Group by platform
        const byPlatform = new Map<string, ApprovalQueueItem[]>();
        for (const item of filteredStandalone) {
          const p = ((item as any).platform || 'instagram') as string;
          if (!byPlatform.has(p)) byPlatform.set(p, []);
          byPlatform.get(p)!.push(item);
        }
        // Sort platforms: active filter first, then alphabetical
        const sortedPlatforms = Array.from(byPlatform.keys()).sort((a, b) => {
          if (a === platformFilter) return -1;
          if (b === platformFilter) return 1;
          return a.localeCompare(b);
        });

        return (
          <div className="space-y-6">
            {sortedPlatforms.map(platform => {
              const platformItems = byPlatform.get(platform)!;
              const info = SOCIAL_PLATFORMS.find(sp => sp.key === platform);
              const color = info?.color || '#666';
              const pending = platformItems.filter(i => i.status === 'pending');
              const samples = pending.filter(i => (i as any).review_sample);
              const autoPending = pending.filter(i => (i as any).auto_approve_on_sample_pass);
              const approved = platformItems.filter(i => i.status === 'approved');
              const rejected = platformItems.filter(i => i.status === 'rejected');

              return (
                <div
                  key={platform}
                  className="rounded-2xl border border-white/[0.06] bg-panel/40 overflow-hidden"
                  style={{ borderTopWidth: '3px', borderTopColor: color }}
                >
                  {/* Platform section header */}
                  <div
                    className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06]"
                    style={{ background: `linear-gradient(90deg, ${color}15 0%, transparent 60%)` }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-xl">{PLATFORM_EMOJI[platform] || '📱'}</span>
                      <h4 className="text-sm font-bold text-text-primary capitalize tracking-wide">
                        {info?.label || platform}
                      </h4>
                      <span className="text-[10px] font-medium text-text-secondary/60 tabular-nums">
                        {platformItems.length} post{platformItems.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-medium">
                      {samples.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          {samples.length} sample
                        </span>
                      )}
                      {autoPending.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                          {autoPending.length} auto-pending
                        </span>
                      )}
                      {approved.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          {approved.length} approved
                        </span>
                      )}
                      {rejected.length > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                          {rejected.length} rejected
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Platform posts grid */}
                  <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {platformItems.map(item => (
                      <ApprovalCard
                        key={item.id}
                        item={item}
                        isSelected={selectedIds.has(item.id)}
                        isLoading={actionLoading === item.id}
                        onApprove={() => handleApprove(item.id)}
                        onReject={(reason) => handleReject(item.id, reason)}
                        onToggleSelect={() => toggleSelect(item.id)}
                        timeRemaining={getTimeRemaining(item.auto_approve_at)}
                        isPending={item.status === 'pending'}
                        onRefresh={() => fetchQueue(true)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}

// ── Approval Card ──────────────────────────────────────────────────────────
interface ApprovalCardProps {
  item: ApprovalQueueItem;
  isAB?: boolean;
  isSelected: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onToggleSelect: () => void;
  timeRemaining: string | null;
  isPending: boolean;
  onRefresh?: () => void;
}

function ApprovalCard({ item, isAB, isSelected, isLoading, onApprove, onReject, onToggleSelect, timeRemaining, isPending, onRefresh }: ApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [imageZoomed, setImageZoomed] = useState(false);
  // Inline edit mode — lets the user tweak caption/hashtags/CTA/hook before approving
  const [editMode, setEditMode] = useState(false);
  const [editCaption, setEditCaption] = useState(item.brief?.caption || '');
  const [editHook, setEditHook] = useState(item.brief?.hook || '');
  const [editCTA, setEditCTA] = useState(item.brief?.call_to_action || '');
  const [editHashtags, setEditHashtags] = useState((item.brief?.hashtags || []).join(' '));
  const [editSaving, setEditSaving] = useState(false);
  // Regenerate-image controls inside the edit modal
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenRefDataUrl, setRegenRefDataUrl] = useState<string | null>(null);
  const [regenRefName, setRegenRefName] = useState<string | null>(null);
  const [regenRunning, setRegenRunning] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

  const handleRegenRefUpload = (file: File) => {
    setRegenError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setRegenError('Image is larger than 5 MB. Pick a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      setRegenRefDataUrl(String(e.target?.result || ''));
      setRegenRefName(file.name);
    };
    reader.onerror = () => setRegenError('Could not read the file.');
    reader.readAsDataURL(file);
  };

  const handleRegenerate = async () => {
    setRegenError(null);
    if (!regenPrompt.trim()) {
      setRegenError('Tell the AI how the new image should look.');
      return;
    }
    setRegenRunning(true);
    try {
      const res = await fetch(`/api/approval-queue/${item.id}/regenerate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: regenPrompt.trim(),
          reference_image_base64: regenRefDataUrl || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setRegenError(data.error || 'Regeneration failed.');
      } else if (data.item) {
        // Update visible image on the card so the change is immediate
        if (data.item.generated_image) item.generated_image = data.item.generated_image;
        if (data.item.generated_video !== undefined) (item as any).generated_video = data.item.generated_video;
        setRegenPrompt('');
        setRegenRefDataUrl(null);
        setRegenRefName(null);
      }
    } catch (err: any) {
      setRegenError(err?.message || 'Regeneration failed.');
    } finally {
      setRegenRunning(false);
    }
  };
  // Schedule-at — controls when Dispatch publishes this slot. Two-way bound
  // with the linked content_slots row's slot_date + scheduled_at.
  const itemScheduled = (item as any).scheduled_at as string | undefined;
  const initialDateTime = itemScheduled
    ? itemScheduled.slice(0, 16) // YYYY-MM-DDTHH:mm
    : `${item.slot_date}T09:00`;
  const [scheduledAt, setScheduledAt] = useState(initialDateTime);
  const [scheduleSaving, setScheduleSaving] = useState(false);

  const handleSaveSchedule = async () => {
    setScheduleSaving(true);
    try {
      const iso = new Date(scheduledAt).toISOString();
      const res = await fetch(`/api/approval-queue/${item.id}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_at: iso }),
      });
      const data = await res.json();
      if (!data.ok) alert(data.error || 'Failed to save schedule');
      else (item as any).scheduled_at = iso;
    } catch (err: any) {
      alert(err?.message || 'Failed to save schedule');
    } finally {
      setScheduleSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    setEditSaving(true);
    try {
      const hashtags = editHashtags.split(/[\s,]+/).map(t => t.replace(/^#+/, '')).filter(Boolean);
      const res = await fetch(`/api/approval-queue/${item.id}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption: editCaption, hook: editHook, call_to_action: editCTA, hashtags }),
      });
      const data = await res.json();
      if (data.ok) {
        // Best-effort: mutate the visible item so the UI updates without a full refetch
        if (item.brief) {
          item.brief.caption = editCaption;
          item.brief.hook = editHook;
          item.brief.call_to_action = editCTA;
          item.brief.hashtags = hashtags;
        }
        item.caption_preview = editCaption.slice(0, 200);
        // If the server bumped status (e.g. rejected → pending after resubmit),
        // a full refetch is the cleanest way to reflect it in the right tab.
        if (data.item?.status && data.item.status !== item.status) {
          item.status = data.item.status;
          if (onRefresh) onRefresh();
        }
        setEditMode(false);
      } else {
        alert(data.error || 'Failed to save edits');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to save edits');
    } finally {
      setEditSaving(false);
    }
  };

  const pillarHash = (item.brief as any)?.content_pillar ? Math.abs((item.brief as any).content_pillar.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0)) % PILLAR_COLORS.length : 0;
  const platform = ((item as any).platform || 'instagram') as string;
  const autoApproveOnPass = !!(item as any).auto_approve_on_sample_pass;
  const isSampleSlot = !!(item as any).review_sample;

  return (
    <div className={`rounded-2xl border transition-all duration-200 ${
      isSelected ? 'border-brand/40 bg-brand/[0.03] ring-1 ring-brand/20' :
      item.status === 'approved' ? 'border-emerald-500/20 bg-emerald-500/[0.02]' :
      item.status === 'rejected' ? 'border-red-500/20 bg-red-500/[0.02]' :
      'border-white/[0.06] bg-panel/60 hover:border-white/[0.10]'
    } overflow-hidden`}>
      {/* Media: <video> for Reels with a Kling-generated video URL, else <img> */}
      {(() => {
        const generatedVideo = (item as any).generated_video as string | undefined;
        const isReelWithVideo = item.format === 'reel' && generatedVideo;
        if (isReelWithVideo) {
          return (
            <div className="relative overflow-hidden bg-zinc-900 aspect-[9/16] max-h-[420px] mx-auto">
              <video
                src={generatedVideo}
                controls
                playsInline
                muted
                loop
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-black/70 text-pink-300 backdrop-blur-sm">
                  🎬 REEL · Kling 3.0
                </span>
              </div>
              {item.status !== 'pending' && (
                <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${STATUS_COLORS[item.status]}`}>
                  {STATUS_ICONS[item.status]} {item.status.replace('_', ' ')}
                </div>
              )}
            </div>
          );
        }
        if (item.generated_image) {
          return (
            <div
              className={`relative overflow-hidden bg-zinc-900 cursor-pointer transition-all ${imageZoomed ? 'max-h-[600px]' : 'aspect-[4/3] max-h-72'}`}
              onClick={() => setImageZoomed(!imageZoomed)}
            >
              <img
                src={item.generated_image}
                alt="Generated content"
                className={`w-full h-full transition-all duration-300 ${imageZoomed ? 'object-contain' : 'object-cover'}`}
                loading="lazy"
              />
              {/* Overlay badges */}
              <div className="absolute top-3 left-3 flex items-center gap-2">
                {item.variant_label && (
                  <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-black/70 text-white backdrop-blur-sm">
                    Variant {item.variant_label}
                  </span>
                )}
                <span className={`px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${FORMAT_COLORS[item.format]}`}>
                  {FORMAT_LABELS[item.format]}
                </span>
                {(item.brief as any)?.content_pillar && (
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${PILLAR_COLORS[pillarHash]}`}>
                    {(item.brief as any).content_pillar}
                  </span>
                )}
                {item.format === 'reel' && (
                  <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-violet-500/30 text-violet-200 backdrop-blur-sm border border-violet-300/20">
                    🎬 Video generating…
                  </span>
                )}
              </div>
              {/* Status overlay for resolved items */}
              {item.status !== 'pending' && (
                <div className={`absolute top-3 right-3 px-2.5 py-1 rounded-lg text-[10px] font-bold backdrop-blur-sm ${STATUS_COLORS[item.status]}`}>
                  {STATUS_ICONS[item.status]} {item.status.replace('_', ' ')}
                </div>
              )}
              {/* Zoom hint */}
              <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[9px] text-white/50 bg-black/40 backdrop-blur-sm">
                {imageZoomed ? 'Click to shrink' : 'Click to expand'}
              </div>
            </div>
          );
        }
        return (
          <div className="aspect-[4/3] max-h-72 bg-zinc-900/50 flex items-center justify-center border-b border-white/[0.04]">
            <div className="text-center text-text-secondary/30">
              <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              <p className="text-xs">No image generated</p>
            </div>
          </div>
        );
      })()}

      <div className="p-4 space-y-3">
        {/* Date + Platform + Format + Status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-secondary">{item.slot_date}</span>
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-white/[0.05] text-text-secondary capitalize">
              <span>{PLATFORM_EMOJI[platform] || '📱'}</span>
              {platform}
            </span>
            {!item.generated_image && (
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${FORMAT_COLORS[item.format]}`}>
                {FORMAT_LABELS[item.format]}
              </span>
            )}
          </div>
          <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${STATUS_COLORS[item.status]}`}>
            {STATUS_ICONS[item.status]} {item.status.replace('_', ' ')}
          </span>
        </div>

        {/* Auto-approve indicator for non-sample pending items */}
        {autoApproveOnPass && isPending && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg px-2.5 py-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <span>Auto-approves when {platform} sample passes (2 of 3 approved)</span>
          </div>
        )}
        {isSampleSlot && isPending && (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
            <span>Sample slot — your decision drives {platform}'s whole batch</span>
          </div>
        )}

        {/* Hook (bold, prominent) */}
        {item.brief?.hook && (
          <p className="text-sm font-bold text-text-primary leading-snug">{item.brief.hook}</p>
        )}

        {/* Caption preview */}
        {(item.caption_preview || item.brief?.caption) && (
          <p className="text-xs text-text-secondary leading-relaxed line-clamp-3">
            {item.caption_preview || (item.brief?.caption || '').slice(0, 200)}
          </p>
        )}

        {/* Quality scores (compact) */}
        {item.quality_scores && (
          <QualityScoreBadge
            scores={item.quality_scores}
            guardrails={item.guardrail_flags}
            dedupScore={item.dedup_score}
            compact
          />
        )}

        {/* Expandable details */}
        {expanded && (
          <div className="pt-3 border-t border-white/[0.04] space-y-3">
            {item.quality_scores && (
              <QualityScoreBadge
                scores={item.quality_scores}
                guardrails={item.guardrail_flags}
                dedupScore={item.dedup_score}
              />
            )}
            {item.brief?.hashtags?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {item.brief.hashtags.slice(0, 10).map((tag, i) => (
                  <span key={i} className="text-[10px] text-blue-400/70 bg-blue-500/10 px-1.5 py-0.5 rounded">#{String(tag).replace(/^#+/, '')}</span>
                ))}
              </div>
            ) : null}
            {item.brief?.call_to_action && (
              <p className="text-xs text-text-secondary"><span className="font-bold text-text-primary">CTA:</span> {item.brief.call_to_action}</p>
            )}
            {item.brief?.visual_direction && (
              <p className="text-xs text-text-secondary"><span className="font-bold text-text-primary">Visual:</span> {item.brief.visual_direction}</p>
            )}
            {(item.brief as any)?.target_emotion && (
              <p className="text-xs text-text-secondary"><span className="font-bold text-text-primary">Emotion:</span> {(item.brief as any).target_emotion}</p>
            )}
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[11px] font-medium text-text-secondary/50 hover:text-text-secondary transition flex items-center gap-1"
        >
          <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          {expanded ? 'Show less' : 'Show details'}
        </button>

        {/* Auto-approve timer */}
        {timeRemaining && isPending && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500/70">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Auto-approve in {timeRemaining}
          </div>
        )}

        {/* Rejection feedback input */}
        {showRejectInput && (
          <div className="space-y-2 pt-2 border-t border-white/[0.04]">
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Why are you rejecting? (optional feedback for the AI to improve)"
              className="w-full px-3 py-2 rounded-xl bg-red-500/5 border border-red-500/20 text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-red-500/40 resize-none transition"
              rows={2}
              autoFocus
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => { onReject(rejectReason); setShowRejectInput(false); setRejectReason(''); }}
                disabled={isLoading}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/20 transition disabled:opacity-50"
              >
                {isLoading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => { setShowRejectInput(false); setRejectReason(''); }}
                className="px-3 py-2 rounded-xl text-xs font-medium text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.04] transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Inline editor — caption / hook / CTA / hashtags + image regen.
            Available on PENDING items (tweak before approve) and on REJECTED
            items (edit + auto-resubmit cycle). */}
        {(isPending || item.status === 'rejected') && editMode && (
          <div className="space-y-2 pt-2 border-t border-white/[0.04]">
            {item.status === 'rejected' && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300">
                <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Saving any change here will resubmit this post for approval. The original rejection reason stays visible to the next reviewer.
              </div>
            )}
            <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider block">Hook</label>
            <input
              value={editHook}
              onChange={e => setEditHook(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-brand/50 transition"
              placeholder="Opening hook..."
              disabled={editSaving}
            />
            <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider block mt-2">Caption</label>
            <textarea
              value={editCaption}
              onChange={e => setEditCaption(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-brand/50 resize-none transition"
              disabled={editSaving}
            />
            <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider block mt-2">Hashtags <span className="text-text-secondary/40 normal-case font-normal">(space- or comma-separated, # is optional)</span></label>
            <input
              value={editHashtags}
              onChange={e => setEditHashtags(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-brand/50 transition"
              placeholder="brand marketing fitness"
              disabled={editSaving}
            />
            <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider block mt-2">Call to Action</label>
            <input
              value={editCTA}
              onChange={e => setEditCTA(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-brand/50 transition"
              placeholder="Shop now / Learn more / Tap link..."
              disabled={editSaving}
            />

            {/* ── Regenerate Image (text + optional reference image) ── */}
            <div className="mt-3 pt-3 border-t border-white/[0.04] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider block">🎨 Regenerate Image</label>
                {item.format === 'reel' && (
                  <span className="text-[10px] text-pink-300/80 font-medium">Reel video will auto-regenerate after</span>
                )}
              </div>
              <textarea
                value={regenPrompt}
                onChange={e => setRegenPrompt(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-purple-500/[0.04] border border-purple-500/20 text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-purple-500/40 resize-none transition"
                placeholder='How should the new image look? e.g. "warmer lighting, sunset palette, model facing camera"'
                disabled={regenRunning || editSaving}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <label className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition flex items-center gap-1.5 ${regenRefDataUrl ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-white/[0.03] border border-white/[0.08] text-text-secondary/70 hover:border-white/[0.15]'}`}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                  {regenRefDataUrl ? 'Reference attached' : 'Upload reference image (optional)'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleRegenRefUpload(f); }}
                    disabled={regenRunning || editSaving}
                  />
                </label>
                {regenRefDataUrl && (
                  <>
                    <span className="text-[10px] text-text-secondary/60 truncate max-w-[120px]">{regenRefName}</span>
                    <button
                      type="button"
                      onClick={() => { setRegenRefDataUrl(null); setRegenRefName(null); }}
                      className="text-[11px] text-text-secondary/50 hover:text-red-400 transition"
                      disabled={regenRunning || editSaving}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
              {regenError && (
                <p className="text-[11px] text-red-400">{regenError}</p>
              )}
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={regenRunning || editSaving || !regenPrompt.trim()}
                className="w-full py-2 rounded-xl text-xs font-bold bg-purple-500/15 hover:bg-purple-500/25 text-purple-200 border border-purple-500/30 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {regenRunning ? (
                  <><div className="w-3 h-3 rounded-full border-2 border-purple-200 border-t-transparent animate-spin" /> Regenerating image (~30s)...</>
                ) : (
                  <>🎨 Regenerate Image</>
                )}
              </button>
              <p className="text-[10px] text-text-secondary/50 leading-relaxed">
                The regenerated image replaces the current one and syncs to Slack instantly. Approval status is unchanged — you still need to approve / reject afterwards.
              </p>
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-white/[0.04]">
              <button
                onClick={handleSaveEdit}
                disabled={editSaving || regenRunning}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-brand text-bg hover:bg-brand-hover transition disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {editSaving ? (
                  <><div className="w-3 h-3 rounded-full border-2 border-bg border-t-transparent animate-spin" /> Saving...</>
                ) : item.status === 'rejected' ? (
                  <>💾 Save & Resubmit</>
                ) : (
                  <>Save changes</>
                )}
              </button>
              <button
                onClick={() => {
                  // reset back to original brief on cancel
                  setEditCaption(item.brief?.caption || '');
                  setEditHook(item.brief?.hook || '');
                  setEditCTA(item.brief?.call_to_action || '');
                  setEditHashtags((item.brief?.hashtags || []).join(' '));
                  setEditMode(false);
                }}
                disabled={editSaving}
                className="px-3 py-2 rounded-xl text-xs font-medium text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.04] transition disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
            <p className="text-[10px] text-text-secondary/60">
              Edits also update the linked calendar slot so everything stays in sync.
            </p>
          </div>
        )}

        {/* Per-slot scheduling — two-way bound with content_slots.scheduled_at.
            Editing the time here updates the calendar slot's scheduled_at;
            changing the calendar slot's date will reflect here on next refresh. */}
        {isPending && !editMode && !showRejectInput && (
          <div className="flex items-center gap-2 pt-2 border-t border-white/[0.04]">
            <span className="text-[10px] uppercase tracking-wider text-text-secondary/60 font-semibold whitespace-nowrap">Schedule</span>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              className="flex-1 px-2 py-1 rounded-lg bg-white/[0.03] border border-white/[0.08] text-text-primary text-xs focus:outline-none focus:border-brand/50 transition"
              disabled={scheduleSaving}
            />
            <button
              onClick={handleSaveSchedule}
              disabled={scheduleSaving}
              className="px-2 py-1 rounded-lg text-[10px] font-bold bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 transition disabled:opacity-40"
              title="Save scheduled time"
            >
              {scheduleSaving ? '…' : 'Set'}
            </button>
          </div>
        )}

        {/* Actions — big buttons */}
        {isPending && !showRejectInput && !editMode && (
          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500 w-4 h-4"
              />
              <span className="text-[10px] text-text-secondary/40">Select</span>
            </label>

            <div className="flex-1" />

            <button
              onClick={() => setEditMode(true)}
              disabled={isLoading}
              className="px-3 py-2.5 rounded-xl text-xs font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition disabled:opacity-50 flex items-center gap-1.5"
              title="Edit caption, hashtags, hook, CTA"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              Edit
            </button>
            <button
              onClick={() => setShowRejectInput(true)}
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Reject
            </button>
            <button
              onClick={onApprove}
              disabled={isLoading}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {isLoading ? (
                <><div className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" /> Processing...</>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  {isAB ? `Pick ${item.variant_label}` : 'Approve'}
                </>
              )}
            </button>
          </div>
        )}

        {/* Edit & Resubmit — shown only for rejected items, lets the user
            re-open the same edit modal (which now also has the regenerate
            section). On save the item flips back to pending and Slack is
            updated automatically. */}
        {item.status === 'rejected' && !editMode && (
          <div className="flex items-center justify-end pt-2 border-t border-white/[0.04]">
            <button
              onClick={() => setEditMode(true)}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 transition flex items-center gap-1.5"
              title="Edit caption / regenerate image and resubmit for approval"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
              Edit & Resubmit
            </button>
          </div>
        )}

        {/* "Previously rejected" badge — surfaces on items that were rejected,
            edited, and are now pending again (resubmitted_at is set). */}
        {isPending && (item as any).resubmitted_at && item.reviewer_notes && (
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 mt-1">
            <span className="text-base shrink-0">🔁</span>
            <div className="flex-1">
              <p className="font-bold uppercase text-[10px] tracking-wider mb-0.5">Previously rejected · resubmitted</p>
              <p className="opacity-90 italic">{item.reviewer_notes}</p>
            </div>
          </div>
        )}

        {/* Reviewer notes (for resolved items, hidden if already shown as the
            "Previously rejected" banner above) */}
        {item.reviewer_notes && !((item as any).resubmitted_at && isPending) && (
          <div className="text-xs text-text-secondary/60 italic border-t border-white/[0.04] pt-3 mt-1 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" /></svg>
            {item.reviewer_notes}
          </div>
        )}
      </div>
    </div>
  );
}
