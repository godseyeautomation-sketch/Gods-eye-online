import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import QualityScoreBadge from './QualityScoreBadge';
import type { ApprovalQueueItem, ApprovalStatus, ContentFormat, SocialPlatform } from '../../types/brand.types';

interface ApprovalQueueProps {
  brandId: string;
  onRefresh?: () => void;
}

const FORMAT_LABELS: Record<ContentFormat, string> = { post: 'Post', story: 'Story', reel: 'Reel' };
const FORMAT_COLORS: Record<ContentFormat, string> = { post: 'bg-blue-500/20 text-blue-400', story: 'bg-purple-500/20 text-purple-400', reel: 'bg-pink-500/20 text-pink-400' };
const STATUS_COLORS: Record<ApprovalStatus, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-red-500/20 text-red-400',
  auto_approved: 'bg-teal-500/20 text-teal-400',
  expired: 'bg-zinc-500/20 text-zinc-400',
};

export default function ApprovalQueue({ brandId, onRefresh }: ApprovalQueueProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<ApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all' | 'approved' | 'rejected'>('pending');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const fetchQueue = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/approval-queue?brand_id=${brandId}&status=${filter}&limit=50`, {
        headers: { 'x-user-id': user.id },
      });
      const data = await res.json();
      if (data.ok) setItems(data.items || []);
    } catch (err) {
      console.error('Failed to fetch approval queue:', err);
    }
    setLoading(false);
  }, [user?.id, brandId, filter]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Auto-refresh every 30s for pending items
  useEffect(() => {
    if (filter !== 'pending') return;
    const interval = setInterval(fetchQueue, 30000);
    return () => clearInterval(interval);
  }, [filter, fetchQueue]);

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
        setItems(prev => prev.filter(i => i.id !== id));
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
        setItems(prev => prev.filter(i => i.id !== id));
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
        setItems(prev => prev.filter(i => !selectedIds.has(i.id)));
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

  // Group A/B variants
  const groupedItems = items.reduce<{ standalone: ApprovalQueueItem[]; abGroups: Map<string, ApprovalQueueItem[]> }>((acc, item) => {
    if (item.variant_group) {
      if (!acc.abGroups.has(item.variant_group)) acc.abGroups.set(item.variant_group, []);
      acc.abGroups.get(item.variant_group)!.push(item);
    } else {
      acc.standalone.push(item);
    }
    return acc;
  }, { standalone: [], abGroups: new Map() });

  const getTimeRemaining = (autoApproveAt?: string) => {
    if (!autoApproveAt) return null;
    const diff = new Date(autoApproveAt).getTime() - Date.now();
    if (diff <= 0) return 'Auto-approving...';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  };

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">Approval Queue</h3>
          {items.length > 0 && filter === 'pending' && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
              {items.length} pending
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && filter === 'pending' && (
            <button
              onClick={handleBulkApprove}
              disabled={actionLoading === 'bulk'}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
            >
              {actionLoading === 'bulk' ? 'Approving...' : `Approve ${selectedIds.size} Selected`}
            </button>
          )}

          <div className="flex rounded-lg overflow-hidden border border-zinc-700">
            {(['pending', 'approved', 'rejected', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-xs capitalize ${filter === f ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'} transition`}
              >
                {f}
              </button>
            ))}
          </div>

          <button onClick={fetchQueue} className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400" title="Refresh">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500" />
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-lg mb-1">No {filter !== 'all' ? filter : ''} items</p>
          <p className="text-sm">Run an autopilot cycle to generate content for review</p>
        </div>
      )}

      {/* A/B Variant Groups */}
      {Array.from(groupedItems.abGroups.entries()).map(([groupId, variants]) => (
        <div key={groupId} className="border border-violet-500/30 rounded-xl p-4 bg-violet-500/5">
          <div className="flex items-center gap-2 mb-3">
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-violet-500/20 text-violet-400">A/B Test</span>
            <span className="text-xs text-zinc-500">Pick the better variant</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {variants.map(item => (
              <ApprovalCard
                key={item.id}
                item={item}
                isAB
                isSelected={selectedIds.has(item.id)}
                isLoading={actionLoading === item.id}
                onApprove={() => handleApprove(item.id)}
                onReject={() => handleReject(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
                timeRemaining={getTimeRemaining(item.auto_approve_at)}
                isPending={filter === 'pending'}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Standalone Items */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groupedItems.standalone.map(item => (
          <ApprovalCard
            key={item.id}
            item={item}
            isSelected={selectedIds.has(item.id)}
            isLoading={actionLoading === item.id}
            onApprove={() => handleApprove(item.id)}
            onReject={() => handleReject(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            timeRemaining={getTimeRemaining(item.auto_approve_at)}
            isPending={filter === 'pending'}
          />
        ))}
      </div>
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
  onReject: () => void;
  onToggleSelect: () => void;
  timeRemaining: string | null;
  isPending: boolean;
}

function ApprovalCard({ item, isAB, isSelected, isLoading, onApprove, onReject, onToggleSelect, timeRemaining, isPending }: ApprovalCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`rounded-xl border transition-all ${isSelected ? 'border-violet-500 bg-violet-500/5' : 'border-zinc-700/50 bg-zinc-900/50'} overflow-hidden`}>
      {/* Image thumbnail */}
      {item.generated_image && (
        <div className="relative aspect-square max-h-48 overflow-hidden bg-zinc-800">
          <img
            src={item.generated_image}
            alt="Generated content"
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* Variant badge */}
          {item.variant_label && (
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-bold bg-black/70 text-white">
              Variant {item.variant_label}
            </span>
          )}
          {/* Format badge */}
          <span className={`absolute top-2 right-2 px-2 py-0.5 rounded text-xs font-medium ${FORMAT_COLORS[item.format]}`}>
            {FORMAT_LABELS[item.format]}
          </span>
        </div>
      )}

      <div className="p-3 space-y-2">
        {/* Date + Status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">{item.slot_date}</span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[item.status]}`}>
            {item.status.replace('_', '-')}
          </span>
        </div>

        {/* Hook / Caption preview */}
        {item.brief?.hook && (
          <p className="text-sm text-white font-medium line-clamp-2">{item.brief.hook}</p>
        )}
        {item.caption_preview && (
          <p className="text-xs text-zinc-400 line-clamp-2">{item.caption_preview}</p>
        )}

        {/* Quality scores (compact) */}
        <QualityScoreBadge
          scores={item.quality_scores}
          guardrails={item.guardrail_flags}
          dedupScore={item.dedup_score}
          compact
        />

        {/* Expandable details */}
        {expanded && (
          <div className="pt-2 border-t border-zinc-800 space-y-2">
            <QualityScoreBadge
              scores={item.quality_scores}
              guardrails={item.guardrail_flags}
              dedupScore={item.dedup_score}
            />
            {item.brief?.hashtags?.length && (
              <div className="flex flex-wrap gap-1">
                {item.brief.hashtags.slice(0, 8).map((tag, i) => (
                  <span key={i} className="text-xs text-blue-400">#{tag}</span>
                ))}
              </div>
            )}
            {item.brief?.call_to_action && (
              <p className="text-xs text-zinc-500"><strong>CTA:</strong> {item.brief.call_to_action}</p>
            )}
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-500 hover:text-white transition"
        >
          {expanded ? 'Show less' : 'Show details'}
        </button>

        {/* Auto-approve timer */}
        {timeRemaining && isPending && (
          <div className="flex items-center gap-1 text-xs text-amber-500/70">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            Auto-approve in {timeRemaining}
          </div>
        )}

        {/* Actions */}
        {isPending && (
          <div className="flex items-center gap-2 pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={onToggleSelect}
                className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500"
              />
              <span className="text-xs text-zinc-500">Select</span>
            </label>

            <div className="flex-1" />

            <button
              onClick={onReject}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={onApprove}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : isAB ? `Pick ${item.variant_label}` : 'Approve'}
            </button>
          </div>
        )}

        {/* Reviewer notes (for resolved items) */}
        {item.reviewer_notes && (
          <p className="text-xs text-zinc-500 italic border-t border-zinc-800 pt-2 mt-2">
            Note: {item.reviewer_notes}
          </p>
        )}
      </div>
    </div>
  );
}
