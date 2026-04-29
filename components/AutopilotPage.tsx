import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { AppMode } from '../types';
import { getAllBrandProfiles } from '../services/brandService';
import ApprovalQueue from './brand/ApprovalQueue';
import QualityScoreBadge from './brand/QualityScoreBadge';
import { PriyaQuestionnaire } from './brand/PriyaQuestionnaire';
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

type SidebarView = 'pipeline' | 'queue' | 'competitors' | 'activity' | 'profile' | 'calendar';

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

interface AutopilotPageProps {
  onNavigate?: (mode: AppMode) => void;
}

export const AutopilotPage: React.FC<AutopilotPageProps> = ({ onNavigate }) => {
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
  const [newCompetitor, setNewCompetitor] = useState({ handle: '', website: '', instagram: '', tiktok: '', facebook: '', youtube: '', linkedin: '', x: '', pinterest: '', threads: '' });
  const [showSocialHandles, setShowSocialHandles] = useState(false);

  // Activity state
  const [allStageLogs, setAllStageLogs] = useState<PipelineStageLog[]>([]);

  // Approval queue pending count for sidebar badge
  const [queuePendingCount, setQueuePendingCount] = useState(0);

  // Per-agent running state + results
  const [runningAgent, setRunningAgent] = useState<string | null>(null);
  const [scoutResult, setScoutResult] = useState<{ filename: string; competitors_analyzed: number; opportunities: number; content_pillars: number; hooks_generated: number; generated_at: string } | null>(null);
  const [priyaProgress, setPriyaProgress] = useState<{ created: number; total: number } | null>(null);
  const [reviewResult, setReviewResult] = useState<{ decision: string; approved_count: number; rejected_count: number; total_reviewed: number } | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [chainMode, setChainMode] = useState(true); // auto-run next agent after current finishes
  const [scoutApproved, setScoutApproved] = useState(false); // Scout report approval gate
  const [scoutApproving, setScoutApproving] = useState(false);
  // Reject-with-feedback flow: inline textarea expand + regeneration state
  const [scoutRejecting, setScoutRejecting] = useState(false);
  const [scoutRejectOpen, setScoutRejectOpen] = useState(false);
  const [scoutRejectFeedback, setScoutRejectFeedback] = useState('');
  // Scout report preview modal — render-in-app alternative to downloading the .docx
  const [showScoutPreview, setShowScoutPreview] = useState(false);
  const [showPriyaModal, setShowPriyaModal] = useState(false); // Priya questionnaire visibility
  const [fullCycleMode, setFullCycleMode] = useState(false); // Run Full Cycle shortcut
  const [priyaPlatformProgress, setPriyaPlatformProgress] = useState<{ total: number; current: number; currentName: string; slotsByPlatform: Record<string, number>; status: string } | null>(null);
  const [autoRunTriggered, setAutoRunTriggered] = useState(false); // prevent re-triggering
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [cooldownAgent, setCooldownAgent] = useState<string | null>(null);

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
    if (!selectedBrandId) { setScoutResult(null); setScoutApproved(false); return; }
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
      setScoutApproved(!!brand.scout_report.approved_at);
    } else {
      setScoutApproved(false);
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
            tiktok: comp.tiktok,
            facebook: comp.facebook,
            youtube: comp.youtube,
            linkedin: comp.linkedin,
            x: comp.x,
            pinterest: comp.pinterest,
            threads: comp.threads,
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

  // ── Fetch approval queue pending count for sidebar badge ──────────────
  useEffect(() => {
    if (!user?.id || !selectedBrandId) return;
    const fetchPendingCount = async () => {
      try {
        const res = await fetch(`/api/approval-queue?brand_id=${selectedBrandId}&status=pending&limit=50`, {
          headers: { 'x-user-id': user.id },
        });
        const data = await res.json();
        if (data.ok) setQueuePendingCount((data.items || []).length);
      } catch {}
    };
    fetchPendingCount();
    const interval = setInterval(fetchPendingCount, 30000);
    return () => clearInterval(interval);
  }, [user?.id, selectedBrandId]);

  // ── Trigger full cycle ────────────────────────────────────────────────
  const triggerCycle = async () => {
    if (!user?.id || !selectedBrandId || isRunning) return;
    // Full cycle mode: auto-approve Scout + skip Priya modal, use defaults
    setFullCycleMode(true);
    runAgent('scout');
    return;
  };

  // Unused "legacy cron job" cycle (kept for future)
  const triggerCycleLegacy = async () => {
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
  const runAgent = async (agentId: string, extraConfig: Record<string, any> = {}) => {
    if (!user?.id || !selectedBrandId || runningAgent) return;
    setRunningAgent(agentId);
    setAgentError(null);
    if (agentId === 'creative') { setPriyaProgress(null); setPriyaPlatformProgress(null); }
    try {
      // Pass the full brand object directly so the backend doesn't need to look it up
      const brandPayload = brands.find(b => b.id === selectedBrandId) || null;

      // CRITICAL: Always use competitors from the brand profile, not from config state.
      // The brand profile is the source of truth; config state can be stale from UI.
      const brandCompetitors = (brandPayload?.competitors || []).map(comp => ({
        handle: comp.name,
        platform: 'instagram' as const,
        instagram: comp.instagram,
        tiktok: comp.tiktok,
        facebook: comp.facebook,
        youtube: comp.youtube,
        linkedin: comp.linkedin,
        x: comp.x,
        pinterest: comp.pinterest,
        threads: comp.threads,
        website: comp.website,
      }));

      const mergedConfig = {
        ...config,
        competitors: brandCompetitors.length ? brandCompetitors : (config.competitors || []),
        ...extraConfig, // merge in campaign, etc.
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

                  // Chain mode: if rejected, re-run Priya with cooldown
                  if (chainMode && pollData.decision === 'rejected') {
                    setCooldownAgent('creative');
                    setCooldownSeconds(15);
                    const cdInterval = setInterval(() => {
                      setCooldownSeconds(prev => {
                        if (prev <= 1) {
                          clearInterval(cdInterval);
                          setCooldownAgent(null);
                          runAgent('creative');
                          return 0;
                        }
                        return prev - 1;
                      });
                    }, 1000);
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
                  platform: slot.platform || 'instagram',
                });
              }
              console.log(`[Autopilot] Wrote ${data.result.slots.length} slots to IndexedDB (across ${new Set(data.result.slots.map((s: any) => s.platform)).size} platforms)`);
            } catch (err) {
              console.error('[Autopilot] Failed to write slots to IDB:', err);
            }
          }
        }
        setTimeout(fetchRuns, 2000);

        // Scout → Priya transition: if full-cycle, auto-approve + use defaults; otherwise pause for approval
        if (agentId === 'scout') {
          if (fullCycleMode) {
            // Auto-approve then run Priya with defaults (sensible from Scout's report)
            console.log('[Autopilot] Full cycle mode — auto-approving Scout + using defaults for Priya');
            const brand = brands.find(b => b.id === selectedBrandId);
            await approveScoutReport(false); // approve silently, no modal
            const defaultPlatforms: any[] = [];
            if (brand?.instagram_handle) defaultPlatforms.push('instagram');
            if (brand?.tiktok_handle) defaultPlatforms.push('tiktok');
            if (brand?.facebook_url) defaultPlatforms.push('facebook');
            if (brand?.linkedin_handle) defaultPlatforms.push('linkedin');
            const platforms = defaultPlatforms.length ? defaultPlatforms.slice(0, 3) : ['instagram'];
            const campaign = {
              duration_days: 30,
              target_audience: brand?.audience || 'General audience',
              campaign_goals: 'Brand awareness and engagement',
              themes: brand?.aesthetic || [],
              platforms,
            };
            setCooldownAgent('creative');
            setCooldownSeconds(15);
            const iv = setInterval(() => {
              setCooldownSeconds(prev => {
                if (prev <= 1) {
                  clearInterval(iv);
                  setCooldownAgent(null);
                  runAgent('creative', { campaign });
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            setRunningAgent(null);
            return;
          }
          // Non-full-cycle: pause, user must approve Scout report manually
          console.log('[Autopilot] Scout done — awaiting user approval before Priya runs');
          setRunningAgent(null);
          return;
        }

        // Chain mode: auto-run next agent in the hierarchy
        if (chainMode) {
          const next: Record<string, string | null> = {
            scout: null,            // Handled above — gated by approval
            creative: 'reviewer',   // Priya → Review (Slack HITL)
            reviewer: null,         // Review → decision handled separately
          };

          // Special case: if Review returns "rejected", re-run Priya with feedback (with cooldown)
          if (agentId === 'reviewer' && data.result?.decision === 'rejected') {
            console.log('[Autopilot] Review rejected — re-running Priya with feedback');
            setCooldownAgent('creative');
            setCooldownSeconds(15);
            const rejInterval = setInterval(() => {
              setCooldownSeconds(prev => {
                if (prev <= 1) {
                  clearInterval(rejInterval);
                  setCooldownAgent(null);
                  runAgent('creative');
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            setRunningAgent(null);
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
            // Show cooldown timer
            setCooldownAgent(nextAgent);
            setCooldownSeconds(15);
            const interval = setInterval(() => {
              setCooldownSeconds(prev => {
                if (prev <= 1) {
                  clearInterval(interval);
                  setCooldownAgent(null);
                  runAgent(nextAgent);
                  return 0;
                }
                return prev - 1;
              });
            }, 1000);
            setRunningAgent(null);
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
    } finally {
      // Always clear lock state so individual agents can be re-run later.
      // Without this, a thrown error or a code path that skipped the bottom
      // setRunningAgent(null) would leave the UI permanently locked.
      setRunningAgent(null);
      // If this was the last agent of a full cycle, end full-cycle mode so
      // that subsequent manual Scout/Priya/Review clicks behave as standalone
      // re-runs (not auto-chained, no auto-approve).
      if (agentId === 'reviewer' || agentId === 'dispatch' || agentId === 'karma') {
        setFullCycleMode(false);
      }
    }
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

  // ── Approve Scout's report — unlocks Priya ──────────────────────────────
  const approveScoutReport = async (autoOpenModal = true) => {
    if (!user?.id || !selectedBrandId || scoutApproving) return;
    setScoutApproving(true);
    try {
      const res = await fetch('/api/pipeline/scout/approve', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ brand_id: selectedBrandId }),
      });
      const data = await res.json();
      if (data.ok) {
        setScoutApproved(true);
        // Refresh brands so scout_report.approved_at is reflected
        if (user?.id) getAllBrandProfiles(user.id).then(all => setBrands(all));
        if (autoOpenModal) setShowPriyaModal(true);
      } else {
        setAgentError(`Approve failed: ${data.error || 'unknown'}`);
      }
    } catch (err: any) {
      setAgentError(`Approve failed: ${err.message}`);
    }
    setScoutApproving(false);
  };

  // ── Reject Scout with written feedback → regenerates weakness + strategy only ──
  const rejectScoutReport = async () => {
    if (!user?.id || !selectedBrandId || scoutRejecting) return;
    const feedback = scoutRejectFeedback.trim();
    if (!feedback) {
      setAgentError('Please describe what needs to change before rejecting.');
      return;
    }
    setScoutRejecting(true);
    setAgentError(null);
    try {
      const res = await fetch('/api/pipeline/scout/reject', {
        method: 'POST',
        headers,
        body: JSON.stringify({ brand_id: selectedBrandId, feedback }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setAgentError(`Regenerate failed: ${data.error || 'unknown'}`);
        setScoutRejecting(false);
        return;
      }
      // Fresh report — mirrors the shape of scoutResult stored after a normal run
      setScoutResult({
        filename: data.result.filename,
        competitors_analyzed: data.result.competitors_analyzed || 0,
        opportunities: data.result.weakness_data?.weaknesses_opportunities?.length || 0,
        content_pillars: data.result.content_pillars || 0,
        hooks_generated: data.result.hooks_generated || 0,
        generated_at: data.result.generated_at,
      });
      setScoutApproved(false);      // new report needs re-approval
      setScoutRejectOpen(false);    // collapse the textarea
      setScoutRejectFeedback('');
      // Refresh brand so scout_report.rejection_count is reflected
      if (user?.id) getAllBrandProfiles(user.id).then(all => setBrands(all));
    } catch (err: any) {
      setAgentError(`Regenerate failed: ${err.message}`);
    }
    setScoutRejecting(false);
  };

  // ── Priya questionnaire submission → triggers Priya with the campaign ──
  const handlePriyaQuestionnaireSubmit = (campaign: any) => {
    setShowPriyaModal(false);
    // Run Priya with campaign context
    runAgent('creative', { campaign });
  };

  // ── Poll Priya progress ────────────────────────────────────────────────
  useEffect(() => {
    if (runningAgent !== 'creative' || !selectedBrandId) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pipeline/priya-progress/${selectedBrandId}`);
        const data = await res.json();
        if (data.ok && data.progress) {
          setPriyaPlatformProgress({
            total: data.progress.total_platforms || 0,
            current: data.progress.current_platform || 0,
            currentName: data.progress.current_platform_name || '',
            slotsByPlatform: data.progress.slots_created || {},
            status: data.progress.status || 'running',
          });
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [runningAgent, selectedBrandId]);

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
          <h2 className="text-xl font-bold text-text-primary mb-2">No Brands Yet</h2>
          <p className="text-text-secondary text-sm mb-6">
            Create your first brand profile to start running autonomous agents (Scout, Priya, Review, Dispatch, Karma).
          </p>
          <button
            onClick={() => onNavigate?.(AppMode.BRAND)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-bg text-sm font-bold hover:bg-brand-hover transition shadow-md"
          >
            <span className="text-lg">+</span> Create Brand Profile
          </button>
          <p className="text-text-secondary/40 text-xs mt-4">
            Takes ~2 min. You'll come straight back here once it's saved.
          </p>
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
            <>
              <p className="text-xs text-text-secondary/40 mt-2 px-1 truncate">{selectedBrand.industry || 'General'}</p>
              {/* Edit profile / view calendar links — Brand tab is no longer
                  in the top nav (consolidated into Agents per item #2), so we
                  expose its key actions here so users can still reach them. */}
              <div className="flex items-center gap-2 mt-2 px-1">
                <button
                  onClick={() => setView('profile')}
                  className="flex-1 text-[11px] font-medium text-text-secondary hover:text-brand transition flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04]"
                  title="Open the brand profile editor (inline)"
                >
                  ✏️ Edit Brand
                </button>
              </div>
              {/* Slack OAuth — per-brand workspace connection. One-click
                  install, no API keys for the user. (Item #12) */}
              <SlackConnectionPanel brandId={selectedBrand.id} userId={user?.id || ''} />
            </>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-0.5">
          {([
            // Profile + Calendar ARE NOW INLINE — no more clicking out to a
            // separate Brand page. Brand profile and calendar render inside
            // the Agents tab when these sub-views are picked. (Item #2 + #5
            // properly consolidated.)
            { key: 'profile' as SidebarView, label: 'Brand Profile', count: 0 },
            { key: 'calendar' as SidebarView, label: 'Calendar', count: 0 },
            { key: 'pipeline' as SidebarView, label: 'Run Agents', count: runs.filter(r => r.status === 'running').length },
            { key: 'queue' as SidebarView, label: 'Approval Queue', count: queuePendingCount },
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
        {/* ── BRAND PROFILE VIEW (embedded — was a separate tab before) ── */}
        {view === 'profile' && selectedBrandId && (
          <BrandProfilePane
            brandId={selectedBrandId}
            userId={user?.id || ''}
            onSaved={() => {
              if (user?.id) getAllBrandProfiles(user.id).then(all => setBrands(all));
            }}
          />
        )}

        {/* ── CALENDAR VIEW (embedded calendar, no more clicking out) ── */}
        {view === 'calendar' && selectedBrandId && selectedBrand && (
          <BrandCalendarPane brand={selectedBrand} userId={user?.id || ''} />
        )}

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
                        {cooldownAgent === agent.id ? (
                          <>
                            <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                            <span className="text-[9px] font-bold uppercase tracking-widest text-brand animate-pulse">Next</span>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
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
                          disabled={!!runningAgent || (status === 'running' && runningAgent === agent.id)}
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

            {/* Cooldown timer banner */}
            {cooldownAgent && cooldownSeconds > 0 && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-brand/5 border border-brand/20">
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/5" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeWidth="2" className="text-brand"
                      strokeDasharray={`${(cooldownSeconds / 15) * 100} 100`} strokeLinecap="round" />
                  </svg>
                  <span className="absolute text-xs font-bold text-brand">{cooldownSeconds}</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    Cooling down before {cooldownAgent === 'creative' ? 'Priya' : cooldownAgent === 'reviewer' ? 'Review' : cooldownAgent}...
                  </p>
                  <p className="text-xs text-text-secondary">Giving Gemini API a breather to avoid rate limits</p>
                </div>
              </div>
            )}

            {/* Scout result banner */}
            {scoutResult && (() => {
              // Pull platform scrape status + rejection metadata from the active brand's stored report
              const activeBrand = brands.find(b => b.id === selectedBrandId);
              const storedReport = activeBrand?.scout_report;
              const platformStatus: Record<string, { status: string; profiles: number; error?: string }> =
                (storedReport?.scan_data?.platform_scrape_status || {}) as any;
              const rejectionCount = storedReport?.rejection_count || 0;
              const statusEntries = Object.entries(platformStatus);
              const hasStatus = statusEntries.length > 0;
              const PLATFORM_EMOJI: Record<string, string> = {
                instagram: '📸', tiktok: '🎵', facebook: '📘', youtube: '📺', linkedin: '💼', twitter: '𝕏', x: '𝕏',
              };

              return (
                <div className={`rounded-xl border ${scoutApproved ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-brand/5 border-brand/20'}`}>
                  <div className="flex items-center gap-3 p-3">
                    <span className={`text-lg ${scoutApproved ? 'text-emerald-400' : 'text-brand'}`}>
                      {scoutApproved ? '✓' : '📄'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary flex items-center gap-2">
                        {scoutApproved ? 'Scout Report Approved' : 'Scout Report Ready — Review before Priya starts'}
                        {rejectionCount > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/20">
                            Rerun #{rejectionCount}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-text-secondary truncate">
                        {scoutResult.competitors_analyzed} competitors · {scoutResult.content_pillars} pillars · {scoutResult.hooks_generated} hooks
                      </p>
                    </div>
                    <button onClick={() => setShowScoutPreview(true)} className="px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-text-primary text-xs font-medium border border-white/[0.08] transition flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      View
                    </button>
                    <button onClick={downloadScoutReport} className="px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] text-text-primary text-xs font-medium border border-white/[0.08] transition flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      Download
                    </button>
                    {!scoutApproved && !scoutRejectOpen && (
                      <>
                        <button
                          onClick={() => setScoutRejectOpen(true)}
                          disabled={scoutApproving || scoutRejecting}
                          className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold border border-red-500/20 transition disabled:opacity-40 flex items-center gap-1.5"
                        >
                          ✗ Reject & Rerun
                        </button>
                        <button
                          onClick={() => approveScoutReport(true)}
                          disabled={scoutApproving}
                          className="px-4 py-2 rounded-xl bg-brand text-bg text-xs font-bold hover:bg-brand-hover transition disabled:opacity-40 flex items-center gap-1.5"
                        >
                          {scoutApproving ? (
                            <><div className="w-3 h-3 rounded-full border-2 border-bg border-t-transparent animate-spin" /> Approving...</>
                          ) : (
                            <>✓ Approve & Continue</>
                          )}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Platform scrape coverage chips — shows which social networks were actually scraped */}
                  {hasStatus && (
                    <div className="flex items-center gap-1.5 flex-wrap px-3 pb-3 -mt-1">
                      <span className="text-[10px] uppercase tracking-wider text-text-secondary/60 font-semibold mr-1">Coverage:</span>
                      {statusEntries.map(([platform, info]) => {
                        const style =
                          info.status === 'ok'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : info.status === 'failed'
                              ? 'bg-red-500/10 text-red-400 border-red-500/20'
                              : info.status === 'empty'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                : 'bg-white/[0.03] text-text-secondary/60 border-white/[0.06]'; // no_handle / skipped
                        const label =
                          info.status === 'ok' ? `✓ ${info.profiles}`
                            : info.status === 'failed' ? '✗ failed'
                              : info.status === 'empty' ? '⚠ empty'
                                : info.status === 'no_handle' ? '— no handle'
                                  : info.status;
                        return (
                          <span
                            key={platform}
                            title={info.error || `${platform}: ${info.status}`}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${style} capitalize`}
                          >
                            <span>{PLATFORM_EMOJI[platform] || '📱'}</span>
                            <span>{platform}</span>
                            <span className="opacity-70">{label}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Inline reject textarea — click-to-reveal, submit regenerates */}
                  {!scoutApproved && scoutRejectOpen && (
                    <div className="px-3 pb-3 space-y-2 border-t border-white/[0.04] pt-3 mt-1">
                      <label className="text-[11px] text-text-secondary font-semibold uppercase tracking-wider">
                        What needs to change?
                      </label>
                      <textarea
                        value={scoutRejectFeedback}
                        onChange={e => setScoutRejectFeedback(e.target.value)}
                        placeholder="e.g. The positioning is too generic — emphasize our sustainability angle more. The content pillars feel derivative; push for sharper pattern interrupts."
                        className="w-full px-3 py-2 rounded-xl bg-red-500/5 border border-red-500/20 text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-red-500/40 resize-none transition"
                        rows={3}
                        autoFocus
                        disabled={scoutRejecting}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={rejectScoutReport}
                          disabled={scoutRejecting || !scoutRejectFeedback.trim()}
                          className="flex-1 py-2 rounded-xl text-xs font-bold bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/20 transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                        >
                          {scoutRejecting ? (
                            <><div className="w-3 h-3 rounded-full border-2 border-red-400 border-t-transparent animate-spin" /> Regenerating… (30–60s)</>
                          ) : (
                            <>Submit feedback & Rerun Scout</>
                          )}
                        </button>
                        <button
                          onClick={() => { setScoutRejectOpen(false); setScoutRejectFeedback(''); }}
                          disabled={scoutRejecting}
                          className="px-3 py-2 rounded-xl text-xs font-medium text-text-secondary/50 hover:text-text-secondary hover:bg-white/[0.04] transition disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="text-[10px] text-text-secondary/60">
                        Scout will re-run Steps 2 &amp; 3 (weakness analysis + strategy) with your feedback. Scraped data is reused — no Apify credits spent.
                      </p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Priya (Creative Agent) progress / result banner */}
            {runningAgent === 'creative' && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
                <div className="w-5 h-5 mt-0.5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary">
                    {priyaPlatformProgress
                      ? `Generating ${priyaPlatformProgress.currentName || 'calendar'} (${priyaPlatformProgress.current}/${priyaPlatformProgress.total})`
                      : 'Priya is doing additional research...'}
                  </p>
                  <p className="text-xs text-text-secondary mt-1">
                    {priyaPlatformProgress
                      ? 'Sequential platform generation — Scout\'s strategy + your campaign answers'
                      : 'Analyzing trends + best practices for each platform'}
                  </p>
                  {priyaPlatformProgress && priyaPlatformProgress.total > 0 && (
                    <div className="mt-3 space-y-1">
                      {Object.entries(priyaPlatformProgress.slotsByPlatform || {}).map(([platform, count]) => (
                        <div key={platform} className="flex items-center justify-between text-[10px] text-text-secondary">
                          <span className="capitalize">
                            {count > 0 ? '✓' : (priyaPlatformProgress.currentName === platform ? '⟳' : '○')} {platform}
                          </span>
                          <span>{count} slots</span>
                        </div>
                      ))}
                    </div>
                  )}
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
          <div className="px-6 pt-28 pb-6 space-y-5">
            {/* Header with context */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-bold text-text-primary">Approval Queue</h1>
                <span className="text-xs text-text-secondary">{selectedBrand?.name}</span>
              </div>
              <p className="text-xs text-text-secondary/50">
                Review AI-generated content before it goes live
              </p>
            </div>

            {/* Info banner when review agent is actively waiting */}
            {reviewResult?.decision === 'waiting' && runningAgent === 'reviewer' && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                <div className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">
                    Review in progress -- approve or reject items below
                  </p>
                  <p className="text-xs text-text-secondary">
                    {reviewResult.approved_count} approved, {reviewResult.rejected_count} rejected so far. You can also respond via Slack.
                  </p>
                </div>
              </div>
            )}

            {/* The actual approval queue component */}
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
              {/* Row 1: Brand Name + Website */}
              <div className="grid grid-cols-2 gap-3">
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
              {/* Collapsible Social Handles */}
              <button
                type="button"
                onClick={() => setShowSocialHandles(s => !s)}
                className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary/60 hover:text-text-secondary transition"
              >
                <svg className={`w-3 h-3 transition-transform ${showSocialHandles ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                Social Handles
              </button>
              {showSocialHandles && (
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { key: 'instagram', emoji: '\uD83D\uDCF8', placeholder: '@adidas' },
                    { key: 'tiktok', emoji: '\uD83C\uDFB5', placeholder: '@adidas' },
                    { key: 'facebook', emoji: '\uD83D\uDCD8', placeholder: 'Adidas' },
                    { key: 'youtube', emoji: '\u25B6\uFE0F', placeholder: 'Adidas' },
                    { key: 'linkedin', emoji: '\uD83D\uDCBC', placeholder: 'adidas' },
                    { key: 'x', emoji: '\uD835\uDD4F', placeholder: '@adidas' },
                    { key: 'pinterest', emoji: '\uD83D\uDCCC', placeholder: 'adidas' },
                    { key: 'threads', emoji: '\uD83E\uDDF5', placeholder: '@adidas' },
                  ] as { key: keyof typeof newCompetitor; emoji: string; placeholder: string }[]).map(s => (
                    <div key={s.key}>
                      <label className="block text-[10px] text-text-secondary/50 mb-0.5">{s.emoji} {s.key}</label>
                      <input
                        type="text"
                        value={newCompetitor[s.key]}
                        onChange={e => setNewCompetitor(prev => ({ ...prev, [s.key]: e.target.value }))}
                        placeholder={s.placeholder}
                        className="w-full px-2 py-1.5 rounded-md bg-surface border border-border-base text-text-primary text-xs placeholder-text-secondary/30 focus:outline-none focus:border-brand transition"
                      />
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={() => {
                  if (newCompetitor.handle.trim()) {
                    setConfig(c => ({ ...c, competitors: [...c.competitors, {
                      handle: newCompetitor.handle.trim(),
                      platform: 'instagram',
                      instagram: newCompetitor.instagram.replace('@', '').trim(),
                      tiktok: newCompetitor.tiktok.replace('@', '').trim(),
                      facebook: newCompetitor.facebook.trim(),
                      youtube: newCompetitor.youtube.trim(),
                      linkedin: newCompetitor.linkedin.trim(),
                      x: newCompetitor.x.replace('@', '').trim(),
                      pinterest: newCompetitor.pinterest.trim(),
                      threads: newCompetitor.threads.replace('@', '').trim(),
                      website: newCompetitor.website.trim(),
                    }] }));
                    setNewCompetitor({ handle: '', website: '', instagram: '', tiktok: '', facebook: '', youtube: '', linkedin: '', x: '', pinterest: '', threads: '' });
                    setShowSocialHandles(false);
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
                <p className="text-xs text-text-secondary">Add competitor brand name + social handles — Scout will research them</p>
              </div>
            ) : (
              <div className="space-y-3">
                {config.competitors.map((comp, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-panel border border-border-base">
                    <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-lg">🏢</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary">{comp.handle}</p>
                      {comp.website && <span className="text-[10px] text-text-secondary/40">{comp.website}</span>}
                      <div className="flex flex-wrap gap-2 mt-1">
                        {comp.instagram && <span className="text-[10px] text-text-secondary/60">{'\uD83D\uDCF8'} @{comp.instagram}</span>}
                        {comp.tiktok && <span className="text-[10px] text-text-secondary/60">{'\uD83C\uDFB5'} @{comp.tiktok}</span>}
                        {comp.facebook && <span className="text-[10px] text-text-secondary/60">{'\uD83D\uDCD8'} {comp.facebook}</span>}
                        {comp.youtube && <span className="text-[10px] text-text-secondary/60">{'\u25B6\uFE0F'} {comp.youtube}</span>}
                        {comp.linkedin && <span className="text-[10px] text-text-secondary/60">{'\uD83D\uDCBC'} {comp.linkedin}</span>}
                        {comp.x && <span className="text-[10px] text-text-secondary/60">{'\uD835\uDD4F'} @{comp.x}</span>}
                        {comp.pinterest && <span className="text-[10px] text-text-secondary/60">{'\uD83D\uDCCC'} {comp.pinterest}</span>}
                        {comp.threads && <span className="text-[10px] text-text-secondary/60">{'\uD83E\uDDF5'} @{comp.threads}</span>}
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

      {/* Priya Questionnaire Modal — auto-opened after Scout approval */}
      {showPriyaModal && selectedBrand && (
        <PriyaQuestionnaire
          brand={selectedBrand}
          scoutAudience={selectedBrand.scout_report?.weakness_data?.target_audience?.primary?.description || selectedBrand.audience}
          onComplete={handlePriyaQuestionnaireSubmit}
          onCancel={() => setShowPriyaModal(false)}
        />
      )}

      {/* Scout Report Preview Modal — shows the structured report data
          (pillars, hooks, weaknesses, opportunities, coverage) in-app
          without needing to download the .docx. */}
      {showScoutPreview && (() => {
        const activeBrand = brands.find(b => b.id === selectedBrandId);
        // Prefer the live brand.scout_report (most complete), fall back to
        // localStorage (which we stash after each Scout run for resilience).
        let r: any = activeBrand?.scout_report || null;
        if (!r && selectedBrandId) {
          try {
            const stored = localStorage.getItem(`scout_result_${selectedBrandId}`);
            if (stored) r = JSON.parse(stored);
          } catch {}
        }

        // No report yet → show a clear empty-state instead of silently
        // returning null (which made the View button feel broken).
        if (!r) {
          return (
            <div
              className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setShowScoutPreview(false)}
            >
              <div
                className="bg-panel border border-border rounded-2xl max-w-md w-full p-8 text-center"
                onClick={e => e.stopPropagation()}
              >
                <div className="text-4xl mb-3">🔍</div>
                <h2 className="text-lg font-bold text-text-primary mb-2">No Scout report yet</h2>
                <p className="text-sm text-text-secondary mb-6">
                  Run the Scout agent first. The report covers competitor analysis,
                  weakness opportunities, content pillars, hooks and more.
                </p>
                <button
                  onClick={() => setShowScoutPreview(false)}
                  className="px-5 py-2 rounded-xl bg-brand text-bg text-sm font-bold hover:bg-brand-hover transition"
                >
                  Got it
                </button>
              </div>
            </div>
          );
        }

        const pillars = r.strategy_data?.content_pillars || [];
        const hooks = r.strategy_data?.hook_bank || {};
        const weaknesses = r.weakness_data?.weaknesses_opportunities || [];
        const positioning = r.weakness_data?.positioning_statement || '';
        const differentiators = r.weakness_data?.key_differentiators || [];
        const coverage = r.scan_data?.platform_scrape_status || {};
        return (
          <div
            className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowScoutPreview(false)}
          >
            <div
              className="bg-panel border border-border rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-panel border-b border-border px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <h2 className="text-lg font-bold text-text-primary">Scout Report — {activeBrand?.name}</h2>
                  <p className="text-xs text-text-secondary">{r.competitors_analyzed || 0} competitors analyzed · {pillars.length} pillars · {Object.values(hooks).flat().length} hooks</p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={downloadScoutReport} className="px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-text-primary text-xs font-medium border border-white/[0.08] transition flex items-center gap-1.5">
                    Download .docx
                  </button>
                  <button onClick={() => setShowScoutPreview(false)} className="w-8 h-8 rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-text-secondary hover:text-text-primary flex items-center justify-center transition">
                    ✕
                  </button>
                </div>
              </div>
              <div className="p-6 space-y-6">
                {positioning && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Positioning</h3>
                    <p className="text-sm text-text-primary leading-relaxed">{positioning}</p>
                  </section>
                )}
                {differentiators.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Key Differentiators</h3>
                    <ul className="space-y-1.5">
                      {differentiators.map((d: string, i: number) => (
                        <li key={i} className="text-sm text-text-secondary flex gap-2"><span className="text-brand">•</span>{d}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {Object.keys(coverage).length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Scrape Coverage</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(coverage).map(([p, info]: [string, any]) => (
                        <span key={p} className={`px-2 py-1 rounded-lg text-[10px] font-medium border ${info.status === 'ok' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : info.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' : 'bg-white/[0.03] text-text-secondary/60 border-white/[0.06]'}`}>
                          {p}: {info.status === 'ok' ? `✓ ${info.profiles}` : info.status}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
                {pillars.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Content Pillars</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {pillars.map((p: any, i: number) => (
                        <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-bold text-text-primary">{p.name}</p>
                            {p.percentage != null && <span className="text-[10px] text-brand font-bold">{p.percentage}%</span>}
                          </div>
                          {p.purpose && <p className="text-xs text-text-secondary leading-relaxed">{p.purpose}</p>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {weaknesses.length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Opportunities ({weaknesses.length})</h3>
                    <div className="space-y-2">
                      {weaknesses.slice(0, 6).map((w: any, i: number) => (
                        <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.05]">
                          <p className="text-xs text-text-secondary mb-1">Their weakness:</p>
                          <p className="text-sm text-text-primary mb-1">{w.their_weakness}</p>
                          <p className="text-xs text-text-secondary mb-1 mt-2">Our opportunity:</p>
                          <p className="text-sm text-brand">{w.our_opportunity}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {Object.keys(hooks).length > 0 && (
                  <section>
                    <h3 className="text-[11px] uppercase tracking-wider text-brand font-bold mb-2">Hook Bank</h3>
                    {Object.entries(hooks).map(([category, hookList]: [string, any]) => Array.isArray(hookList) && hookList.length > 0 && (
                      <div key={category} className="mb-3">
                        <p className="text-[10px] uppercase tracking-wider text-text-secondary font-bold mb-1">{category.replace(/_/g, ' ')}</p>
                        <ul className="space-y-1">
                          {hookList.slice(0, 3).map((h: string, i: number) => (
                            <li key={i} className="text-xs text-text-primary leading-relaxed pl-3 border-l border-brand/30">"{h}"</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SlackConnectionPanel — per-brand "Add to Slack" OAuth button
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// BrandProfilePane — embeds the existing BrandPage profile editor as a sub-view
// of the Agents tab, so users never have to navigate away to edit brand details.
// ─────────────────────────────────────────────────────────────────────────────
const BrandProfilePane: React.FC<{ brandId: string; userId: string; onSaved?: () => void }> = ({ brandId, userId, onSaved }) => {
  // We render the existing BrandPage in 'embedded' mode by routing through it
  // — the page is heavy (handles its own state) but reuses all existing logic
  // for save, image upload, products, fonts, colors, etc.
  // Lazy-load to avoid a circular import (BrandPage may import from Autopilot).
  const [BrandPage, setBrandPage] = useState<React.ComponentType<any> | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('./brand/BrandPage').then(m => {
      if (!cancelled) setBrandPage(() => m.BrandPage);
    });
    return () => { cancelled = true; };
  }, []);
  if (!BrandPage) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }
  return (
    <div className="pt-20 pb-6">
      <BrandPage initialBrandId={brandId} embedded onSaved={onSaved} />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// BrandCalendarPane — embedded calendar view inside the Agents tab.
// Renders the same BrandCalendar component the standalone Brand page uses,
// loading slots for the current month and re-fetching when navigation changes.
// ─────────────────────────────────────────────────────────────────────────────
const BrandCalendarPane: React.FC<{ brand: BrandProfile; userId: string }> = ({ brand, userId }) => {
  const [BrandCalendar, setBrandCalendar] = useState<React.ComponentType<any> | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [slots, setSlots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<SocialPlatform>('instagram');

  useEffect(() => {
    let cancelled = false;
    import('./brand/BrandCalendar').then(m => {
      if (!cancelled) setBrandCalendar(() => m.BrandCalendar);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!brand?.id || !userId) return;
    let cancelled = false;
    setLoading(true);
    import('../services/brandService').then(({ getSlotsForMonth }) => {
      getSlotsForMonth(userId, brand.id, year, month).then(s => {
        if (!cancelled) {
          setSlots(s || []);
          setLoading(false);
        }
      }).catch(() => {
        if (!cancelled) { setSlots([]); setLoading(false); }
      });
    });
    return () => { cancelled = true; };
  }, [brand?.id, userId, year, month]);

  if (!BrandCalendar) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  return (
    <div className="pt-20 pb-6 px-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Calendar</h1>
          <p className="text-xs text-text-secondary mt-0.5">{brand.name} · {slots.length} slot{slots.length !== 1 ? 's' : ''} this month</p>
        </div>
        {loading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand" />}
      </div>
      <div className="bg-panel/40 border border-border rounded-2xl p-4 h-[calc(100vh-13rem)]">
        <BrandCalendar
          year={year}
          month={month}
          slots={slots}
          onMonthChange={(y: number, m: number) => { setYear(y); setMonth(m); }}
          onSlotClick={() => {}}
          selectedPlatform={platform}
          onPlatformChange={setPlatform}
        />
      </div>
    </div>
  );
};

const SlackConnectionPanel: React.FC<{ brandId: string; userId: string }> = ({ brandId, userId }) => {
  const [state, setState] = useState<{ connected: boolean; team?: string; channel?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    fetch(`/api/slack/integration?brand_id=${encodeURIComponent(brandId)}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        if (d?.ok && d.connected) setState({ connected: true, team: d.team_name, channel: d.channel_name });
        else setState({ connected: false });
      })
      .catch(() => { if (!cancelled) setState({ connected: false }); });
    return () => { cancelled = true; };
  }, [brandId]);

  const handleConnect = () => {
    if (!brandId || !userId) return;
    window.location.href = `/api/slack/install?brand_id=${encodeURIComponent(brandId)}&user_id=${encodeURIComponent(userId)}`;
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect this brand from Slack? Review will fall back to dashboard-only mode.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/slack/integration?brand_id=${encodeURIComponent(brandId)}`, { method: 'DELETE' });
      const d = await res.json();
      if (d?.ok) setState({ connected: false });
    } finally { setBusy(false); }
  };

  if (!state) return null;

  return (
    <div className="mt-2 px-1">
      {state.connected ? (
        <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400 text-[11px]">●</span>
            <span className="text-[11px] font-bold text-emerald-400">Slack connected</span>
          </div>
          <p className="text-[10px] text-text-secondary/70 leading-snug">
            Posts to <span className="font-mono">#{state.channel || 'channel'}</span>
            {state.team ? ` in ${state.team}` : ''}
          </p>
          <button
            onClick={handleDisconnect}
            disabled={busy}
            className="self-start text-[10px] font-medium text-red-400/80 hover:text-red-400 disabled:opacity-40"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-[#4A154B] hover:bg-[#5C2C5D] text-white text-[11px] font-bold transition"
          title="Connect this brand to a Slack workspace via OAuth — one click, no API keys"
        >
          <svg viewBox="0 0 122.8 122.8" className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9z" fill="#E01E5A"/>
            <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9z" fill="#36C5F0"/>
            <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9z" fill="#2EB67D"/>
            <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9z" fill="#ECB22E"/>
          </svg>
          Add to Slack
        </button>
      )}
    </div>
  );
};
