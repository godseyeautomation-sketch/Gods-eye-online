import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import ApprovalQueue from './ApprovalQueue';
import type { PipelineRun, PipelineStageLog, PipelineConfig, PipelineStage, SocialPlatform } from '../../types/brand.types';
import { SOCIAL_PLATFORMS } from '../../types/brand.types';

interface AutopilotDashboardProps {
  brandId: string;
  brandName: string;
}

const STAGES: { key: PipelineStage; label: string; icon: string; desc: string }[] = [
  { key: 'scout', label: 'Scout', icon: '🔍', desc: 'Research trends & competitors' },
  { key: 'create', label: 'Create', icon: '🎨', desc: 'Generate briefs & images' },
  { key: 'review', label: 'Review', icon: '✅', desc: 'Quality scoring & guardrails' },
  { key: 'approve', label: 'Approve', icon: '👤', desc: 'Human-in-the-loop review' },
  { key: 'publish', label: 'Publish', icon: '🚀', desc: 'Post to social platforms' },
  { key: 'analyze', label: 'Analyze', icon: '📊', desc: 'Track & distill signals' },
];

const DEFAULT_CONFIG: PipelineConfig = {
  platforms: ['instagram', 'tiktok', 'facebook'],
  post_count: 15,
  auto_approve_hours: 4,
  enable_ab_test: false,
  competitors: [],
};

type Tab = 'overview' | 'queue' | 'config';

export default function AutopilotDashboard({ brandId, brandName }: AutopilotDashboardProps) {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null);
  const [stageLogs, setStageLogs] = useState<PipelineStageLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [configState, setConfigState] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [isRunning, setIsRunning] = useState(false);
  const [newCompetitor, setNewCompetitor] = useState('');

  // Fetch pipeline runs
  const fetchRuns = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/pipeline/runs?brand_id=${brandId}&limit=10`, {
        headers: { 'x-user-id': user.id },
      });
      const data = await res.json();
      if (data.ok) {
        setRuns(data.runs || []);
        if (data.runs?.length && !selectedRun) setSelectedRun(data.runs[0]);
      }
    } catch (err) {
      console.error('Failed to fetch pipeline runs:', err);
    }
    setLoading(false);
  }, [user?.id, brandId]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  // Fetch stage logs for selected run
  useEffect(() => {
    if (!selectedRun) return;
    (async () => {
      try {
        const res = await fetch(`/api/pipeline/runs/${selectedRun.id}/stages`);
        const data = await res.json();
        if (data.ok) setStageLogs(data.stages || []);
      } catch {}
    })();
  }, [selectedRun?.id]);

  // Auto-refresh while a pipeline is running
  useEffect(() => {
    const running = runs.some(r => r.status === 'running');
    if (!running) return;
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, [runs, fetchRuns]);

  // Trigger a new autopilot cycle
  const triggerCycle = async () => {
    if (!user?.id || isRunning) return;
    setIsRunning(true);
    try {
      // Create a cron job and run it immediately
      const createRes = await fetch('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
        body: JSON.stringify({
          brandId,
          taskType: 'autopilot-cycle',
          name: `Autopilot: ${brandName}`,
          cronExpression: '0 6 * * *',
          config: configState,
        }),
      });
      const createData = await createRes.json();
      if (createData.ok && createData.job?.id) {
        // Run immediately
        await fetch(`/api/cron/jobs/${createData.job.id}/run`, {
          method: 'POST',
          headers: { 'x-user-id': user.id },
        });
        // Refresh after a short delay
        setTimeout(fetchRuns, 2000);
      }
    } catch (err) {
      console.error('Failed to trigger cycle:', err);
    }
    setIsRunning(false);
  };

  return (
    <div className="space-y-6">
      {/* Tab Bar */}
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
        {([
          { key: 'overview' as Tab, label: 'Pipeline Overview', icon: '🤖' },
          { key: 'queue' as Tab, label: 'Approval Queue', icon: '📋' },
          { key: 'config' as Tab, label: 'Configuration', icon: '⚙️' },
        ]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-violet-500 text-white'
                : 'border-transparent text-zinc-400 hover:text-white hover:border-zinc-600'
            }`}
          >
            <span className="mr-1.5">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Agent Cards */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Agent Pipeline</h3>
              <button
                onClick={triggerCycle}
                disabled={isRunning || runs.some(r => r.status === 'running')}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isRunning || runs.some(r => r.status === 'running') ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    Running...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    Run Cycle Now
                  </>
                )}
              </button>
            </div>

            {/* Stage Pipeline Visualization */}
            <div className="grid grid-cols-6 gap-2">
              {STAGES.map((stage, i) => {
                const log = stageLogs.find(l => l.stage === stage.key);
                const isCurrentStage = selectedRun?.current_stage === stage.key && selectedRun?.status === 'running';
                const isCompleted = log?.status === 'completed';
                const isFailed = log?.status === 'failed';

                return (
                  <div
                    key={stage.key}
                    className={`relative p-3 rounded-xl border transition-all ${
                      isCurrentStage
                        ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10'
                        : isCompleted
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : isFailed
                            ? 'border-red-500/30 bg-red-500/5'
                            : 'border-zinc-700/50 bg-zinc-900/50'
                    }`}
                  >
                    {/* Connection arrow */}
                    {i > 0 && (
                      <div className="absolute -left-2 top-1/2 -translate-y-1/2 text-zinc-600">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                      </div>
                    )}

                    <div className="text-center">
                      <div className="text-2xl mb-1">{stage.icon}</div>
                      <p className="text-xs font-semibold text-white">{stage.label}</p>
                      <p className="text-[10px] text-zinc-500 mt-0.5">{stage.desc}</p>

                      {/* Status indicator */}
                      {isCurrentStage && (
                        <div className="mt-2 flex items-center justify-center gap-1">
                          <div className="animate-pulse w-2 h-2 rounded-full bg-violet-500" />
                          <span className="text-[10px] text-violet-400">Active</span>
                        </div>
                      )}
                      {isCompleted && log && (
                        <div className="mt-2 text-[10px] text-emerald-400">
                          {(log.duration_ms / 1000).toFixed(0)}s
                        </div>
                      )}
                      {isFailed && (
                        <div className="mt-2 text-[10px] text-red-400">Failed</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Runs */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-400 mb-3">Recent Pipeline Runs</h3>
            {loading && <div className="text-center py-8 text-zinc-500">Loading...</div>}

            {!loading && runs.length === 0 && (
              <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl">
                <p className="text-zinc-500 text-lg mb-2">No pipeline runs yet</p>
                <p className="text-zinc-600 text-sm mb-4">Click "Run Cycle Now" to start your first autopilot cycle</p>
              </div>
            )}

            <div className="space-y-2">
              {runs.map(run => (
                <button
                  key={run.id}
                  onClick={() => setSelectedRun(run)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedRun?.id === run.id
                      ? 'border-violet-500/50 bg-violet-500/5'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${
                        run.status === 'running' ? 'bg-violet-500 animate-pulse' :
                        run.status === 'completed' ? 'bg-emerald-500' :
                        run.status === 'failed' ? 'bg-red-500' : 'bg-zinc-500'
                      }`} />
                      <div>
                        <p className="text-sm text-white font-medium">
                          {new Date(run.started_at).toLocaleDateString()} {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-xs text-zinc-500 capitalize">{run.status} — Stage: {run.current_stage}</p>
                      </div>
                    </div>

                    {/* Stage summary badges */}
                    {run.stage_summary && (
                      <div className="flex items-center gap-2 text-xs">
                        {run.stage_summary.scout && (
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{run.stage_summary.scout.briefs} briefs</span>
                        )}
                        {run.stage_summary.create && (
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{run.stage_summary.create.slots} slots</span>
                        )}
                        {run.stage_summary.review && (
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">avg {run.stage_summary.review.avgScore}</span>
                        )}
                        {run.stage_summary.approve && (
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{run.stage_summary.approve.queued} queued</span>
                        )}
                      </div>
                    )}
                  </div>

                  {run.error_message && (
                    <p className="text-xs text-red-400 mt-2 truncate">{run.error_message}</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Approval Queue Tab ────────────────────────────────────────── */}
      {tab === 'queue' && (
        <ApprovalQueue brandId={brandId} onRefresh={fetchRuns} />
      )}

      {/* ── Configuration Tab ─────────────────────────────────────────── */}
      {tab === 'config' && (
        <div className="max-w-2xl space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-white mb-4">Autopilot Configuration</h3>
            <p className="text-sm text-zinc-400 mb-6">
              Configure how the autonomous pipeline runs for <strong className="text-white">{brandName}</strong>.
            </p>
          </div>

          {/* Platforms */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Target Platforms</label>
            <div className="flex flex-wrap gap-2">
              {SOCIAL_PLATFORMS.slice(0, 6).map(p => {
                const isSelected = configState.platforms.includes(p.key);
                return (
                  <button
                    key={p.key}
                    onClick={() => {
                      setConfigState(prev => ({
                        ...prev,
                        platforms: isSelected
                          ? prev.platforms.filter(k => k !== p.key)
                          : [...prev.platforms, p.key],
                      }));
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                      isSelected
                        ? 'border-violet-500 bg-violet-500/10 text-white'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Post count */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Posts per Cycle</label>
            <div className="flex gap-3">
              {[15, 30, 45].map(count => (
                <button
                  key={count}
                  onClick={() => setConfigState(prev => ({ ...prev, post_count: count }))}
                  className={`px-4 py-2 rounded-lg text-sm border transition ${
                    configState.post_count === count
                      ? 'border-violet-500 bg-violet-500/10 text-white'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  {count} posts
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-1">Distributed across selected platforms</p>
          </div>

          {/* Auto-approve hours */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Review Window</label>
            <div className="flex gap-3">
              {[
                { value: 0, label: 'Full Autopilot', desc: 'No review needed' },
                { value: 2, label: '2 hours', desc: 'Quick review' },
                { value: 4, label: '4 hours', desc: 'Standard' },
                { value: 24, label: '24 hours', desc: 'Full day review' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setConfigState(prev => ({ ...prev, auto_approve_hours: opt.value }))}
                  className={`flex-1 p-3 rounded-lg text-center border transition ${
                    configState.auto_approve_hours === opt.value
                      ? 'border-violet-500 bg-violet-500/10'
                      : 'border-zinc-700 bg-zinc-800 hover:border-zinc-600'
                  }`}
                >
                  <p className={`text-sm font-medium ${configState.auto_approve_hours === opt.value ? 'text-white' : 'text-zinc-400'}`}>{opt.label}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 mt-1">
              {configState.auto_approve_hours === 0
                ? 'Content will be published automatically after quality gates pass'
                : `Content auto-approves after ${configState.auto_approve_hours} hours if not reviewed`
              }
            </p>
          </div>

          {/* A/B Testing */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-700 bg-zinc-800/50">
            <div>
              <p className="text-sm font-medium text-white">A/B Testing</p>
              <p className="text-xs text-zinc-500">Generate 2 variants for top-priority content</p>
            </div>
            <button
              onClick={() => setConfigState(prev => ({ ...prev, enable_ab_test: !prev.enable_ab_test }))}
              className={`relative w-11 h-6 rounded-full transition ${configState.enable_ab_test ? 'bg-violet-600' : 'bg-zinc-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${configState.enable_ab_test ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {/* Competitors */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Competitor Accounts</label>
            <div className="space-y-2 mb-2">
              {configState.competitors.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-sm text-zinc-300 flex-1">@{c.handle} <span className="text-zinc-500">({c.platform || 'instagram'})</span></span>
                  <button
                    onClick={() => setConfigState(prev => ({
                      ...prev,
                      competitors: prev.competitors.filter((_, idx) => idx !== i),
                    }))}
                    className="text-zinc-500 hover:text-red-400 transition"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newCompetitor}
                onChange={e => setNewCompetitor(e.target.value)}
                placeholder="@competitor_handle"
                className="flex-1 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-violet-500"
                onKeyDown={e => {
                  if (e.key === 'Enter' && newCompetitor.trim()) {
                    setConfigState(prev => ({
                      ...prev,
                      competitors: [...prev.competitors, { handle: newCompetitor.replace('@', '').trim(), platform: 'instagram' }],
                    }));
                    setNewCompetitor('');
                  }
                }}
              />
              <button
                onClick={() => {
                  if (newCompetitor.trim()) {
                    setConfigState(prev => ({
                      ...prev,
                      competitors: [...prev.competitors, { handle: newCompetitor.replace('@', '').trim(), platform: 'instagram' }],
                    }));
                    setNewCompetitor('');
                  }
                }}
                className="px-3 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm text-white transition"
              >
                Add
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-1">Scout will research their content strategy and find gaps</p>
          </div>
        </div>
      )}
    </div>
  );
}
