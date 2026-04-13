import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { getAllBrandProfiles } from '../services/brandService';
import ApprovalQueue from './brand/ApprovalQueue';
import QualityScoreBadge from './brand/QualityScoreBadge';
import type { BrandProfile, PipelineRun, PipelineStageLog, PipelineStage, SocialPlatform } from '../types/brand.types';
import { SOCIAL_PLATFORMS } from '../types/brand.types';

// ── Agent Definitions ───────────────────────────────────────────────────────
const AGENTS = [
  {
    id: 'scout',
    name: 'Scout',
    role: 'Research Agent',
    description: 'Researches trending topics, scrapes competitor content, and generates content briefs based on performance signals.',
    icon: '🔍',
    stage: 'scout' as PipelineStage,
    color: 'blue',
  },
  {
    id: 'creative',
    name: 'Priya',
    role: 'Creative Agent',
    description: 'Generates full content briefs with captions, hashtags, CTAs, and AI images for each platform and format.',
    icon: '🎨',
    stage: 'create' as PipelineStage,
    color: 'violet',
  },
  {
    id: 'reviewer',
    name: 'Review',
    role: 'Quality Agent',
    description: 'Scores content on 4 dimensions, checks brand compliance guardrails, and runs embedding dedup against last 30 days.',
    icon: '✅',
    stage: 'review' as PipelineStage,
    color: 'cyan',
  },
  {
    id: 'dispatcher',
    name: 'Dispatch',
    role: 'Publisher Agent',
    description: 'Schedules and publishes approved content to social platforms at optimal times.',
    icon: '🚀',
    stage: 'publish' as PipelineStage,
    color: 'orange',
  },
  {
    id: 'analyst',
    name: 'Karma',
    role: 'Analytics Agent',
    description: 'Tracks post performance, distills winning signals, and generates winner-inspired briefs for the next cycle.',
    icon: '📊',
    stage: 'analyze' as PipelineStage,
    color: 'emerald',
  },
];

const PIPELINE_STAGES: { key: PipelineStage; label: string }[] = [
  { key: 'scout', label: 'Scout' },
  { key: 'create', label: 'Create' },
  { key: 'review', label: 'Review' },
  { key: 'approve', label: 'Approve' },
  { key: 'publish', label: 'Publish' },
  { key: 'analyze', label: 'Analyze' },
];

type SidebarView = 'pipeline' | 'queue' | 'competitors' | 'activity';

// ── Config for pipeline ─────────────────────────────────────────────────────
interface PipelineConfig {
  platforms: string[];
  post_count: number;
  auto_approve_hours: number;
  enable_ab_test: boolean;
  competitors: { handle: string; platform?: string }[];
}

const DEFAULT_CONFIG: PipelineConfig = {
  platforms: ['instagram', 'tiktok', 'facebook'],
  post_count: 15,
  auto_approve_hours: 4,
  enable_ab_test: false,
  competitors: [],
};

export const AutopilotPage: React.FC = () => {
  const { user } = useAuth();

  // Brand state
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [loadingBrands, setLoadingBrands] = useState(true);

  // View state
  const [view, setView] = useState<SidebarView>('pipeline');

  // Pipeline state
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [stageLogs, setStageLogs] = useState<PipelineStageLog[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Config state
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [newCompetitor, setNewCompetitor] = useState({ handle: '', website: '', instagram: '' });

  // Activity state
  const [allStageLogs, setAllStageLogs] = useState<PipelineStageLog[]>([]);

  // Per-agent running state + results
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [scoutResult, setScoutResult] = useState<{ filename: string; competitors_analyzed: number; opportunities: number; content_pillars: number; hooks_generated: number; generated_at: string } | null>(null);
  const [priyaProgress, setPriyaProgress] = useState<{ created: number; total: number } | null>(null);
  const [reviewResult, setReviewResult] = useState<{ decision: string; approved_count: number; rejected_count: number; total_reviewed: number } | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [chainMode, setChainMode] = useState(true); // auto-run next agent after current finishes
  const [autoRunTriggered, setAutoRunTriggered] = useState(false); // prevent re-triggering

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': user?.id || '',
  };

  const selectedBrand = brands.find(b => b.id === selectedBrandId) || null;

  // ── Load brands ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      setLoadingBrands(true);
      try {
        const all = await getAllBrandProfiles(user.id);
        setBrands(all);

        // Check for auto-run flag from BrandWizard completion
        const autoRunRaw = localStorage.getItem('autopilot_auto_run');
        let preselectedId: string | null = null;
        if (autoRunRaw) {
          try {
            const autoRun = JSON.parse(autoRunRaw);
            // Only use if recent (within 30 seconds)
            if (Date.now() - (autoRun.timestamp || 0) < 30000) {
              preselectedId = autoRun.brandId;
            }
          } catch {}
        }

        if (preselectedId && all.find(b => b.id === preselectedId)) {
          setSelectedBrandId(preselectedId);
        } else if (all.length && !selectedBrandId) {
          setSelectedBrandId(all[0].id);
        }
      } catch {}
      setLoadingBrands(false);
    })();
  }, [user?.id]);

  // ── Restore scoutResult from brand profile when switching brands ──────
  useEffect(() => {
    if (!selectedBrandId) { setScoutResult(null); return; }
    const brand = brands.find(b => b.id === selectedBrandId);
    if (brand?.scout_report) {
      setScoutResult({
        filename: brand.scout_report.filename,
        competitors_analyzed: brand.scout_report.competitors_analyzed || 0,
        opportunities: 0,
        content_pillars: brand.scout_report.content_pillars || 0,
        hooks_generated: brand.scout_report.hooks_generated || 0,
        generated_at: brand.scout_report.generated_at,
      });
    } else {
      // Also check localStorage fallback
      const stored = localStorage.getItem(`scout_result_${selectedBrandId}`);
      if (stored) {
        try { setScoutResult(JSON.parse(stored)); } catch {}
      } else {
        setScoutResult(null);
      }
    }
    // Restore Priya progress too
    const storedPriya = localStorage.getItem(`priya_progress_${selectedBrandId}`);
    if (storedPriya) {
      try { setPriyaProgress(JSON.parse(storedPriya)); } catch { setPriyaProgress(null); }
    } else {
      setPriyaProgress(null);
    }
    // Restore Review result
    const storedReview = localStorage.getItem(`review_result_${selectedBrandId}`);
    if (storedReview) {
      try { setReviewResult(JSON.parse(storedReview)); } catch { setReviewResult(null); }
    } else {
      setReviewResult(null);
    }
  }, [selectedBrandId, brands]);

  // ── Auto-trigger Scout from BrandWizard navigation ────────────────────
  useEffect(() => {
    if (!user?.id || !selectedBrandId || autoRunTriggered) return;
    const autoRunRaw = localStorage.getItem('autopilot_auto_run');
    if (!autoRunRaw) return;
    try {
      const autoRun = JSON.parse(autoRunRaw);
      // Only if recent AND matches selected brand
      if (Date.now() - (autoRun.timestamp || 0) > 30000) {
        localStorage.removeItem('autopilot_auto_run');
        return;
      }
      if (autoRun.brandId !== selectedBrandId) return;

      // Clear flag so it doesn't re-trigger on refresh
      localStorage.removeItem('autopilot_auto_run');
      setAutoRunTriggered(true);

      // Load brand competitors into config
      const brand = brands.find(b => b.id === selectedBrandId);
      if (brand?.competitors?.length) {
        setConfig(c => ({
          ...c,
          competitors: brand.competitors!.map(comp => ({
            handle: comp.name,
            platform: 'instagram' as const,
            instagram: comp.instagram,
            website: comp.website,
          } as any)),
        }));
      }

      // Auto-run Scout after a short delay (allow state to settle)
      setTimeout(() => runAgent('scout'), 600);
    } catch (err) {
      console.warn('[Autopilot] auto-run parse failed:', err);
      localStorage.removeItem('autopilot_auto_run');
    }
  }, [user?.id, selectedBrandId, brands, autoRunTriggered]);

  // ── Load pipeline runs for selected brand ─────────────────────────────
  const fetchRuns = useCallback(async () => {
    if (!user?.id || !selectedBrandId) return;
    try {
      const res = await fetch(`/api/pipeline/runs?brand_id=${selectedBrandId}&limit=20`, { headers });
      const data = await res.json();
      if (data.ok) {
        setRuns(data.runs || []);
        if (data.runs?.length && !selectedRunId) setSelectedRunId(data.runs[0].id);
      }
    } catch {}
  }, [user?.id, selectedBrandId]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // ── Load stage logs for selected run ──────────────────────────────────
  useEffect(() => {
    if (!selectedRunId) { setStageLogs([]); return; }
    (async () => {
      try {
        const res = await fetch(`/api/pipeline/runs/${selectedRunId}/stages`);
        const data = await res.json();
        if (data.ok) setStageLogs(data.stages || []);
      } catch {}
    })();
  }, [selectedRunId]);

  // ── Auto-refresh while running ────────────────────────────────────────
  useEffect(() => {
    if (!runs.some(r => r.status === 'running')) return;
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [runs, fetchRuns]);

  // ── Load all stage logs for activity view ─────────────────────────────
  useEffect(() => {
    if (view !== 'activity' || !runs.length) return;
    (async () => {
      const allLogs: PipelineStageLog[] = [];
      for (const run of runs.slice(0, 5)) {
        try {
          const res = await fetch(`/api/pipeline/runs/${run.id}/stages`);
          const data = await res.json();
          if (data.ok) allLogs.push(...(data.stages || []));
        } catch {}
      }
      setAllStageLogs(allLogs.sort((a, b) => new Date(b.completed_at || b.started_at || '').getTime() - new Date(a.completed_at || a.started_at || '').getTime()));
    })();
  }, [view, runs]);

  // ── Trigger full cycle ────────────────────────────────────────────────
  const triggerCycle = async () => {
    if (!user?.id || !selectedBrandId || isRunning) return;
    setIsRunning(true);
    try {
      // Create the cron job
      const createRes = await fetch('/api/cron/jobs', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          brandId: selectedBrandId,
          taskType: 'autopilot-cycle',
          name: `Autopilot: ${selectedBrand?.name || 'Brand'}`,
          cronExpression: '0 6 * * *',
          config,
        }),
      });
      const createData = await createRes.json();
      if (createData.ok && createData.job?.id) {
        await fetch(`/api/cron/jobs/${createData.job.id}/run`, {
          method: 'POST',
          headers,
        });
        setTimeout(fetchRuns, 3000);
      }
    } catch (err) {
      console.error('Failed to trigger cycle:', err);
    }
    setIsRunning(false);
  };

  // ── Run a single agent ─────────────────────────────────────────────────
  const runAgent = async (agentId: string) => {
    if (!user?.id || !selectedBrandId || runningAgent) return;
    setRunningAgent(agentId);
    setAgentError(null);
    if (agentId === 'creative') setPriyaProgress(null);
    try {
      // Pass the full brand object directly so the backend doesn't need to look it up
      const brandPayload = brands.find(b => b.id === selectedBrandId) || null;

      // CRITICAL: Always use competitors from the brand profile, not from config state.
      // The brand profile is the source of truth; config state can be stale from UI.
      const brandCompetitors = (brandPayload?.competitors || []).map(comp => ({
        handle: comp.name,
        platform: 'instagram' as const,
        instagram: comp.instagram,
        website: comp.website,
      }));

      const mergedConfig = {
        ...config,
        competitors: brandCompetitors.length ? brandCompetitors : (config.competitors || []),
      };

      console.log(`[Autopilot] Running ${agentId} with ${mergedConfig.competitors.length} competitors:`, mergedConfig.competitors);

      const res = await fetch('/api/pipeline/run-agent', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent_id: agentId,
          brand_id: selectedBrandId,
          brand: brandPayload,
          config: mergedConfig,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`[Agent] ${agentId} result:`, data.text);
        if (agentId === 'scout' && data.result) {
          setScoutResult(data.result);
          localStorage.setItem(`scout_result_${selectedBrandId}`, JSON.stringify(data.result));
          // Also refresh brands so the scout_report is attached
          if (user?.id) {
            getAllBrandProfiles(user.id).then(all => setBrands(all));
          }
        }
        if (agentId === 'reviewer' && data.result) {
          if (data.result.decision === 'waiting' && data.result.review_id) {
            // Review is now non-blocking — start polling for button clicks
            setReviewResult({ decision: 'waiting', approved_count: 0, rejected_count: 0, total_reviewed: data.result.total_reviewed || 3 });
            const pollReviewId = data.result.review_id;
            const pollInterval = setInterval(async () => {
              try {
                const pollRes = await fetch(`/api/pipeline/review-status/${pollReviewId}`);
                const pollData = await pollRes.json();
                if (pollData.status === 'complete') {
                  clearInterval(pollInterval);
                  setReviewResult({
                    decision: pollData.decision,
                    approved_count: pollData.approved_count || 0,
                    rejected_count: pollData.rejected_count || 0,
                    total_reviewed: pollData.total_reviewed || 3,
                  });
                  localStorage.setItem(`review_result_${selectedBrandId}`, JSON.stringify(pollData));
                  setRunningAgent(null);
                  setTimeout(fetchRuns, 2000);

                  // Chain mode: if rejected, re-run Priya
                  if (chainMode && pollData.decision === 'rejected') {
                    setTimeout(() => runAgent('creative'), 1500);
                  }
                } else if (pollData.status === 'waiting') {
                  setReviewResult({
                    decision: 'waiting',
                    approved_count: pollData.approved_count || 0,
                    rejected_count: pollData.rejected_count || 0,
                    total_reviewed: pollData.total_reviewed || 3,
                  });
                }
              } catch {}
            }, 5000); // Poll every 5 seconds
            return; // Don't set runningAgent to null — keep it showing "working"
          } else {
            setReviewResult({
              decision: data.result.decision,
              approved_count: data.result.approved_count || 0,
              rejected_count: data.result.rejected_count || 0,
              total_reviewed: data.result.total_reviewed || 0,
            });
            localStorage.setItem(`review_result_${selectedBrandId}`, JSON.stringify(data.result));
          }
        }
        if (agentId === 'creative' && data.result) {
          const progress = { created: data.result.slots_created || 0, total: data.result.slots_total || 0 };
          setPriyaProgress(progress);
          localStorage.setItem(`priya_progress_${selectedBrandId}`, JSON.stringify(progress));

          // ── Write slots to IndexedDB so Brand page sees them ─────────
          if (data.result.slots && Array.isArray(data.result.slots) && user?.id) {
            try {
              const { upsertSlot } = await import('../services/brandService');
              for (const slot of data.result.slots) {
                await upsertSlot(user.id, selectedBrandId, slot.slot_date, slot.format, {
                  idea: slot.idea || '',
                  brief: slot.brief || null,
                  generated_image: slot.generated_image || null,
                  status: slot.status || 'briefed',
                  approved: false,
                });
              }
              console.log(`[Autopilot] Wrote ${data.result.slots.length} slots to IndexedDB`);
            } catch (err) {
              console.error('[Autopilot] Failed to write slots to IDB:', err);
            }
          }
        }
        setTimeout(fetchRuns, 2000);

        // Chain mode: auto-run next agent in the hierarchy
        if (chainMode) {
          const next: Record<string, string | null> = {
            scout: 'creative',     // Scout → Priya
            creative: 'reviewer',  // Priya → Review (Slack HITL)
            reviewer: null,        // Review → decision handled separately
          };

          // Special case: if Review returns "rejected", re-run Priya with feedback
          if (agentId === 'reviewer' && data.result?.decision === 'rejected') {
            console.log('[Autopilot] Review rejected — re-running Priya with feedback');
            setRunningAgent(null);
            setTimeout(() => runAgent('creative'), 1500);
            return;
          }

          // Special case: if Review times out, stop the chain
          if (agentId === 'reviewer' && data.result?.decision === 'timeout') {
            console.log('[Autopilot] Review timed out — stopping chain');
            setRunningAgent(null);
            return;
          }

          const nextAgent = next[agentId];
          if (nextAgent) {
            setRunningAgent(null);
            setTimeout(() => runAgent(nextAgent), 1500);
            return;
          }
        }
      } else {
        console.error(`[Agent] ${agentId} failed:`, data.error);
        setAgentError(`${agentId}: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error(`[Agent] ${agentId} error:`, err);
      setAgentError(`${agentId}: ${err.message || 'Network error'}`);
    }
    setRunningAgent(null);
  };

  // ── Download scout report ─────────────────────────────────────────────
  const downloadScoutReport = () => {
    if (!scoutResult?.filename) return;
    const link = document.createElement('a');
    link.href = `/api/pipeline/scout-report/${encodeURIComponent(scoutResult.filename)}`;
    link.download = scoutResult.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // ── Get agent status from latest run ──────────────────────────────────
  const getAgentStatus = (stage: PipelineStage): 'idle' | 'running' | 'completed' | 'error' => {
    const latestRun = runs[0];
    if (!latestRun || latestRun.status !== 'running') return 'idle';
    const log = stageLogs.find(l => l.stage === stage);
    if (!log) {
      // Check if this stage hasn't started yet
      const stageIdx = PIPELINE_STAGES.findIndex(s => s.key === stage);
      const currentIdx = PIPELINE_STAGES.findIndex(s => s.key === latestRun.current_stage);
      return stageIdx > currentIdx ? 'idle' : stageIdx === currentIdx ? 'running' : 'idle';
    }
    if (log.status === 'running') return 'running';
    if (log.status === 'completed') return 'completed';
    if (log.status === 'failed') return 'error';
    return 'idle';
  };

  const getAgentLastRun = (stage: PipelineStage): string | null => {
    for (const run of runs) {
      if (run.stage_summary?.[stage]) {
        return run.started_at;
      }
    }
    return null;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  if (loadingBrands) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (!brands.length) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🤖</div>
          <h2 className="text-xl font-bold text-text-primary mb-2">No Brands Found</h2>
          <p className="text-text-secondary text-sm">Create a brand profile first in the Brand page, then come back to set up autonomous agents.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">
      {/* ── Left Sidebar ──────────────────────────────────────────────── */}
      <div className="w-52 flex-shrink-0 border-r border-white/[0.04] flex flex-col">

        {/* Brand Selector — pushed down to clear the header/logo */}
        <div className="px-4 pt-32 pb-4">
          <select
            value={selectedBrandId || ''}
            onChange={e => { setSelectedBrandId(e.target.value); setSelectedRunId(null); }}
            className="w-full px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-text-primary text-sm font-medium focus:outline-none focus:border-brand/40 transition cursor-pointer appearance-none"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
          >
            {brands.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          {selectedBrand && (
            <p className="text-xs text-text-secondary/40 mt-2 px-1 truncate">{selectedBrand.industry || 'General'}</p>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {([
            { key: 'pipeline' as SidebarView, label: 'Pipeline', count: runs.filter(r => r.status === 'running').length },
            { key: 'queue' as SidebarView, label: 'Approval Queue', count: 0 },
            { key: 'competitors' as SidebarView, label: 'Competitors', count: config.competitors.length },
            { key: 'activity' as SidebarView, label: 'Activity', count: 0 },
          ]).map(item => (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                view === item.key
                  ? 'bg-brand/[0.08] text-brand font-semibold'
                  : 'text-text-secondary/60 hover:text-text-secondary hover:bg-white/[0.02] font-medium'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full transition-colors ${view === item.key ? 'bg-brand' : 'bg-white/[0.08]'}`} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.count > 0 && (
                <span className="min-w-[18px] text-center px-1 py-0.5 rounded-md text-[9px] font-bold bg-brand/10 text-brand">{item.count}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Quick Settings */}
        <div className="px-4 py-4 space-y-3 border-t border-white/[0.04]">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.15em] text-text-secondary/30 font-semibold">Posts</span>
            <div className="flex gap-px rounded-lg overflow-hidden border border-white/[0.06]">
              {[15, 30, 45].map(n => (
                <button
                  key={n}
                  onClick={() => setConfig(c => ({ ...c, post_count: n }))}
                  className={`px-2.5 py-1 text-[10px] font-bold transition ${config.post_count === n ? 'bg-brand text-bg' : 'bg-white/[0.02] text-text-secondary/40 hover:text-text-secondary'}`}
                >{n}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.15em] text-text-secondary/30 font-semibold">Review</span>
            <div className="flex gap-px rounded-lg overflow-hidden border border-white/[0.06]">
              {[{ v: 0, l: 'Auto' }, { v: 4, l: '4h' }, { v: 24, l: '24h' }].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setConfig(c => ({ ...c, auto_approve_hours: opt.v }))}
                  className={`px-2.5 py-1 text-[10px] font-bold transition ${config.auto_approve_hours === opt.v ? 'bg-brand text-bg' : 'bg-white/[0.02] text-text-secondary/40 hover:text-text-secondary'}`}
                >{opt.l}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.15em] text-text-secondary/30 font-semibold">A/B Test</span>
            <button
              onClick={() => setConfig(c => ({ ...c, enable_ab_test: !c.enable_ab_test }))}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${config.enable_ab_test ? 'bg-brand' : 'bg-white/[0.08]'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${config.enable_ab_test ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.15em] text-text-secondary/30 font-semibold" title="When ON, agents auto-chain: Scout → Priya → ...">Chain Mode</span>
            <button
              onClick={() => setChainMode(m => !m)}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${chainMode ? 'bg-brand' : 'bg-white/[0.08]'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${chainMode ? 'translate-x-4' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── PIPELINE VIEW ──────────────────────────────────────────── */}
        {view === 'pipeline' && (
          <div className="px-6 pt-28 pb-6 space-y-5">
            {/* Header — compact row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-text-primary">Agents</h1>
                <span className="text-xs text-text-secondary">{selectedBrand?.name}</span>
                {runs.length > 0 && <span className="text-[10px] text-text-secondary/50">{runs.length} runs</span>}
              </div>
              <button
                onClick={triggerCycle}
                disabled={isRunning || runs.some(r => r.status === 'running') || !selectedBrandId}
                className="px-4 py-2 rounded-full text-xs font-bold bg-brand text-bg hover:bg-brand-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isRunning || runs.some(r => r.status === 'running') ? (
                  <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-bg" /> Running...</>
                ) : (
                  'Run Full Cycle'
                )}
              </button>
            </div>

            {/* Agent Cards Grid */}
            <div className="grid grid-cols-5 gap-3">
              {AGENTS.map(agent => {
                const status = getAgentStatus(agent.stage);
                const lastRun = getAgentLastRun(agent.stage);
                const isAgentRunning = runningAgent === agent.id || status === 'running';

                return (
                  <div
                    key={agent.id}
                    className={`group relative rounded-2xl border transition-all duration-300 overflow-hidden ${
                      isAgentRunning
                        ? 'border-brand/30 bg-brand/[0.03]'
                        : 'border-border-base bg-panel/60 hover:border-white/10 hover:bg-panel'
                    }`}
                  >
                    {/* Top bar with status */}
                    <div className="flex items-center justify-between px-4 pt-3 pb-0">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base ${
                        isAgentRunning ? 'bg-brand/10' : 'bg-white/[0.04]'
                      }`}>
                        {agent.icon}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          isAgentRunning ? 'bg-brand animate-pulse' :
                          status === 'completed' ? 'bg-emerald-500' :
                          status === 'error' ? 'bg-red-500' : 'bg-white/15'
                        }`} />
                        <span className={`text-[9px] font-bold uppercase tracking-widest ${
                          isAgentRunning ? 'text-brand' :
                          status === 'completed' ? 'text-emerald-400' :
                          status === 'error' ? 'text-red-400' : 'text-text-secondary/50'
                        }`}>
                          {isAgentRunning ? 'Active' : status === 'completed' ? 'Done' : status === 'error' ? 'Error' : 'Idle'}
                        </span>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="px-4 pt-2.5 pb-3">
                      <h3 className="text-sm font-bold text-text-primary leading-tight">{agent.name}</h3>
                      <p className="text-[9px] text-text-secondary/50 uppercase tracking-widest mt-0.5">{agent.role}</p>
                      <p className="text-[11px] text-text-secondary leading-relaxed mt-2 line-clamp-2">{agent.description}</p>
                    </div>

                    {/* Footer */}
                    <div className="px-4 pb-3 space-y-2">
                      {/* Scout download button */}
                      {agent.id === 'scout' && scoutResult?.filename && !isAgentRunning && (
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadScoutReport(); }}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-bold bg-brand/10 text-brand hover:bg-brand/20 border border-brand/20 transition-all"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                          Download Report
                        </button>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-text-secondary/40">
                          {lastRun ? new Date(lastRun).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Never'}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); runAgent(agent.id); }}
                          disabled={!!runningAgent || status === 'running'}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
                            isAgentRunning
                              ? 'bg-brand/20 text-brand'
                              : 'text-text-secondary/50 hover:bg-brand/10 hover:text-brand'
                          } disabled:opacity-30 disabled:cursor-not-allowed`}
                        >
                          {isAgentRunning ? (
                            <span className="flex items-center gap-1">
                              <div className="w-2 h-2 rounded-full border border-brand border-t-transparent animate-spin" />
                              Working
                            </span>
                          ) : 'Run'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Error display */}
            {agentError && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                <span className="text-red-400 text-sm">Error:</span>
                <span className="text-red-300 text-sm flex-1">{agentError}</span>
                <button onClick={() => setAgentError(null)} className="text-red-400 hover:text-red-300 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            )}

            {/* Scout result banner */}
            {scoutResult && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-brand/5 border border-brand/20">
                <span className="text-brand text-lg">📄</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Scout Report Ready</p>
                  <p className="text-xs text-text-secondary">{scoutResult.competitors_analyzed} competitors analyzed · {scoutResult.content_pillars} pillars · {scoutResult.hooks_generated} hooks</p>
                </div>
                <button onClick={downloadScoutReport} className="px-4 py-2 rounded-xl bg-brand text-bg text-xs font-bold hover:bg-brand-hover transition flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Download .docx
                </button>
              </div>
            )}

            {/* Priya (Creative Agent) progress / result banner */}
            {runningAgent === 'creative' && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/20">
                <div className="w-5 h-5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Priya is generating your calendar...</p>
                  <p className="text-xs text-text-secondary">Reading Scout's research → creating briefs + captions for each day</p>
                </div>
              </div>
            )}
            {priyaProgress && runningAgent !== 'creative' && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-violet-500/5 border border-violet-500/20">
                <span className="text-violet-400 text-lg">📅</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Priya created {priyaProgress.created} content slots</p>
                  <p className="text-xs text-text-secondary">Check the Brand → Calendar tab to view your content plan</p>
                </div>
              </div>
            )}

            {/* Review (Slack HITL) progress / result banner */}
            {runningAgent === 'reviewer' && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                <div className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    {reviewResult?.decision === 'waiting'
                      ? `Waiting for Slack approval (${reviewResult.approved_count || 0} approved, ${reviewResult.rejected_count || 0} rejected)`
                      : 'Sending 3 calendar posts to Slack...'}
                  </p>
                  <p className="text-xs text-text-secondary">Check #all-godseye — click Approve or Reject on each post</p>
                </div>
              </div>
            )}
            {reviewResult && runningAgent !== 'reviewer' && (
              <div className={`flex items-center gap-3 p-3 rounded-xl border ${
                reviewResult.decision === 'approved' ? 'bg-emerald-500/5 border-emerald-500/20' :
                reviewResult.decision === 'rejected' ? 'bg-red-500/5 border-red-500/20' :
                'bg-yellow-500/5 border-yellow-500/20'
              }`}>
                <span className="text-lg">
                  {reviewResult.decision === 'approved' ? '✅' : reviewResult.decision === 'rejected' ? '❌' : '⏱️'}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    Review {reviewResult.decision}: {reviewResult.approved_count} approved, {reviewResult.rejected_count} rejected
                  </p>
                  <p className="text-xs text-text-secondary">
                    {reviewResult.decision === 'approved' ? 'Proceeding to publish' :
                     reviewResult.decision === 'rejected' ? 'Priya will re-run with feedback' :
                     'Neither threshold reached within 10 min'}
                  </p>
                </div>
              </div>
            )}

            {/* Pipeline Flow */}
            <div className="flex items-center gap-1 px-2">
              {PIPELINE_STAGES.map((stage, i) => {
                const log = stageLogs.find(l => l.stage === stage.key);
                const latestRun = runs[0];
                const isActive = latestRun?.status === 'running' && latestRun?.current_stage === stage.key;
                const isDone = log?.status === 'completed';
                const isFailed = log?.status === 'failed';

                return (
                  <React.Fragment key={stage.key}>
                    {i > 0 && <div className={`flex-1 h-px ${isDone ? 'bg-brand/30' : 'bg-border-base'}`} />}
                    <div className="flex flex-col items-center gap-1">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                        isActive ? 'bg-brand text-bg ring-2 ring-brand/20' :
                        isDone ? 'bg-brand/15 text-brand' :
                        isFailed ? 'bg-red-500/15 text-red-400' :
                        'bg-white/[0.04] text-text-secondary/40'
                      }`}>
                        {isDone ? '✓' : i + 1}
                      </div>
                      <span className={`text-[8px] font-bold uppercase tracking-widest ${
                        isActive ? 'text-brand' : isDone ? 'text-brand/60' : 'text-text-secondary/30'
                      }`}>{stage.label}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Recent Runs */}
            <div>
              <h3 className="text-[9px] font-bold text-text-secondary/40 uppercase tracking-widest mb-2">Recent Runs</h3>
              {runs.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-border-base rounded-xl">
                  <p className="text-text-secondary text-sm">No runs yet</p>
                  <p className="text-[10px] text-text-secondary/50 mt-1">Click "Run Full Cycle" to start</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {runs.slice(0, 10).map(run => (
                    <button
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedRunId === run.id
                          ? 'border-brand/30 bg-brand/5'
                          : 'border-border-base bg-panel hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${
                            run.status === 'running' ? 'bg-brand animate-pulse' :
                            run.status === 'completed' ? 'bg-emerald-500' :
                            run.status === 'failed' ? 'bg-red-500' : 'bg-text-secondary'
                          }`} />
                          <div>
                            <span className="text-sm font-medium text-text-primary">
                              {new Date(run.started_at).toLocaleDateString()} {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <p className="text-[10px] text-text-secondary capitalize">{run.status} — {run.current_stage}</p>
                          </div>
                        </div>
                        {run.stage_summary && (
                          <div className="flex gap-2 text-[10px]">
                            {run.stage_summary.scout && <span className="px-2 py-0.5 rounded bg-white/5 text-text-secondary">{run.stage_summary.scout.briefs} briefs</span>}
                            {run.stage_summary.create && <span className="px-2 py-0.5 rounded bg-white/5 text-text-secondary">{run.stage_summary.create.slots} slots</span>}
                            {run.stage_summary.review && <span className="px-2 py-0.5 rounded bg-white/5 text-text-secondary">avg {run.stage_summary.review.avgScore}</span>}
                          </div>
                        )}
                      </div>
                      {run.error_message && <p className="text-xs text-red-400 mt-1 truncate">{run.error_message}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── APPROVAL QUEUE VIEW ────────────────────────────────────── */}
        {view === 'queue' && selectedBrandId && (
          <div className="px-6 pt-28 pb-6">
            <div className="flex items-center gap-3 mb-5">
              <h1 className="text-lg font-bold text-text-primary">Approval Queue</h1>
              <span className="text-xs text-text-secondary">{selectedBrand?.name}</span>
            </div>
            <ApprovalQueue brandId={selectedBrandId} onRefresh={fetchRuns} />
          </div>
        )}

        {/* ── COMPETITORS VIEW ───────────────────────────────────────── */}
        {view === 'competitors' && (
          <div className="px-6 pt-28 pb-6 space-y-5">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-text-primary">Competitors</h1>
              <span className="text-xs text-text-secondary">Scout researches these each cycle</span>
            </div>

            {/* Add Competitor Form */}
            <div className="p-5 rounded-2xl bg-panel border border-border-base space-y-4">
              <h3 className="text-sm font-bold text-text-primary">Add Competitor</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Brand Name *</label>
                  <input
                    type="text"
                    value={newCompetitor.handle}
                    onChange={e => setNewCompetitor(prev => ({ ...prev, handle: e.target.value }))}
                    placeholder="e.g. Adidas"
                    className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border-base text-text-primary text-sm placeholder-text-secondary/40 focus:outline-none focus:border-brand transition"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Instagram Handle</label>
                  <input
                    type="text"
                    value={newCompetitor.instagram}
                    onChange={e => setNewCompetitor(prev => ({ ...prev, instagram: e.target.value }))}
                    placeholder="@adidas"
                    className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border-base text-text-primary text-sm placeholder-text-secondary/40 focus:outline-none focus:border-brand transition"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-text-secondary uppercase tracking-wider mb-1">Website</label>
                  <input
                    type="text"
                    value={newCompetitor.website}
                    onChange={e => setNewCompetitor(prev => ({ ...prev, website: e.target.value }))}
                    placeholder="adidas.com"
                    className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border-base text-text-primary text-sm placeholder-text-secondary/40 focus:outline-none focus:border-brand transition"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  if (newCompetitor.handle.trim()) {
                    setConfig(c => ({ ...c, competitors: [...c.competitors, {
                      handle: newCompetitor.handle.trim(),
                      platform: 'instagram',
                      instagram: newCompetitor.instagram.replace('@', '').trim() || newCompetitor.handle.trim(),
                      website: newCompetitor.website.trim(),
                    }] }));
                    setNewCompetitor({ handle: '', website: '', instagram: '' });
                  }
                }}
                className="px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:bg-brand-hover transition"
              >
                + Add Competitor
              </button>
            </div>

            {/* Competitor List */}
            {config.competitors.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border-base rounded-2xl">
                <p className="text-text-secondary text-lg mb-1">No competitors tracked</p>
                <p className="text-xs text-text-secondary">Add competitor brand name + Instagram handle — Scout will research them</p>
              </div>
            ) : (
              <div className="space-y-3">
                {config.competitors.map((comp, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-panel border border-border-base">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg">🏢</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary">{comp.handle}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {comp.instagram && <span className="text-[10px] text-text-secondary">@{comp.instagram}</span>}
                        {comp.website && <span className="text-[10px] text-text-secondary/40">{comp.website}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfig(c => ({ ...c, competitors: c.competitors.filter((_, idx) => idx !== i) }))}
                      className="text-text-secondary hover:text-red-400 transition p-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ACTIVITY LOG VIEW ──────────────────────────────────────── */}
        {view === 'activity' && (
          <div className="px-6 pt-28 pb-6 space-y-5">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-bold text-text-primary">Activity</h1>
              <span className="text-xs text-text-secondary">Agent execution events</span>
            </div>

            {allStageLogs.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border-base rounded-2xl">
                <p className="text-text-secondary">No activity yet</p>
                <p className="text-xs text-text-secondary mt-1">Run a pipeline cycle to see agent events</p>
              </div>
            ) : (
              <div className="space-y-2">
                {allStageLogs.map(log => {
                  const agent = AGENTS.find(a => a.stage === log.stage);
                  return (
                    <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-panel border border-border-base">
                      <span className="text-lg mt-0.5">{agent?.icon || '⚙️'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary capitalize">{log.stage}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                            log.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                            log.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                            log.status === 'running' ? 'bg-brand/10 text-brand' :
                            'bg-white/5 text-text-secondary'
                          }`}>{log.status}</span>
                          {log.duration_ms > 0 && (
                            <span className="text-[10px] text-text-secondary">{(log.duration_ms / 1000).toFixed(1)}s</span>
                          )}
                        </div>
                        {log.output && Object.keys(log.output).length > 0 && (
                          <p className="text-xs text-text-secondary mt-1 truncate">
                            {JSON.stringify(log.output).slice(0, 120)}
                          </p>
                        )}
                      </div>
                      <span className="text-[10px] text-text-secondary whitespace-nowrap">
                        {log.completed_at ? new Date(log.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '...'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
