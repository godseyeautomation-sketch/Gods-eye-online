import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Clock, Play, Pause, Trash2, RefreshCw, Plus, ChevronDown, CheckCircle, XCircle, Zap } from 'lucide-react';

interface CronJob {
  id: string;
  name: string;
  task_type: string;
  cron_expression: string;
  enabled: boolean;
  brand_id: string | null;
  config: any;
  timezone: string;
  last_run_at: string | null;
  last_run_status: string | null;
  created_at: string;
}

interface Execution {
  id: string;
  status: string;
  result: any;
  error_message: string | null;
  executed_at: string;
}

const TASK_TYPE_INFO: Record<string, { icon: string; label: string; color: string }> = {
  'research-trends': { icon: '🔬', label: 'Research Trends', color: 'text-blue-400' },
  'pull-analytics': { icon: '📊', label: 'Pull Analytics', color: 'text-purple-400' },
  'weekly-strategy': { icon: '📅', label: 'Weekly Strategy', color: 'text-green-400' },
  'auto-publish': { icon: '🚀', label: 'Auto Publisher', color: 'text-orange-400' },
  'competitor-scan': { icon: '🔍', label: 'Competitor Scan', color: 'text-pink-400' },
  'custom': { icon: '⚡', label: 'Custom Task', color: 'text-yellow-400' },
  'autopilot-cycle': { icon: '🤖', label: 'Autopilot Cycle', color: 'text-violet-400' },
  'auto-approve-check': { icon: '✅', label: 'Auto-Approve Check', color: 'text-teal-400' },
};

const CRON_PRESETS = [
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily 9am', value: '0 9 * * *' },
  { label: 'Daily 3pm', value: '0 15 * * *' },
  { label: 'Monday 9am', value: '0 9 * * 1' },
  { label: 'Weekdays 10am', value: '0 10 * * 1-5' },
];

function cronToHuman(expr: string): string {
  const presetMatch = CRON_PRESETS.find(p => p.value === expr);
  if (presetMatch) return presetMatch.label;
  const parts = expr.split(' ');
  if (parts.length !== 5) return expr;
  const [min, hr, dom, mon, dow] = parts;
  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (hr.startsWith('*/')) return `Every ${hr.slice(2)} hours`;
  if (dom === '*' && mon === '*' && dow === '*') return `Daily at ${hr}:${min.padStart(2, '0')}`;
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = dow.split(',').map(d => days[parseInt(d)] || d).join(', ');
    return `${dayNames} at ${hr}:${min.padStart(2, '0')}`;
  }
  return expr;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export const CronJobsPage: React.FC = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [executions, setExecutions] = useState<Record<string, Execution[]>>({});
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('research-trends');
  const [newCron, setNewCron] = useState('0 15 * * *');
  const [newCustomPrompt, setNewCustomPrompt] = useState('');
  const [creating, setCreating] = useState(false);

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-user-id': user?.id || '' };

  const fetchJobs = async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/cron/jobs?user_id=${user.id}`, { headers });
      const data = await res.json();
      setJobs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[CronPage] Failed to load jobs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, [user]);

  const fetchHistory = async (jobId: string) => {
    try {
      const res = await fetch(`/api/cron/executions?job_id=${jobId}&limit=10`, { headers });
      const data = await res.json();
      setExecutions(prev => ({ ...prev, [jobId]: Array.isArray(data) ? data : [] }));
    } catch (err) {
      console.error('[CronPage] Failed to load history:', err);
    }
  };

  const toggleExpand = (jobId: string) => {
    if (expandedJob === jobId) {
      setExpandedJob(null);
    } else {
      setExpandedJob(jobId);
      if (!executions[jobId]) fetchHistory(jobId);
    }
  };

  const toggleEnabled = async (job: CronJob) => {
    try {
      await fetch(`/api/cron/jobs/${job.id}/toggle`, {
        method: 'POST', headers,
      });
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j));
    } catch (err) {
      console.error('[CronPage] Toggle failed:', err);
    }
  };

  const deleteJob = async (jobId: string) => {
    if (!confirm('Delete this cron job? This cannot be undone.')) return;
    try {
      await fetch(`/api/cron/jobs/${jobId}`, { method: 'DELETE', headers });
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch (err) {
      console.error('[CronPage] Delete failed:', err);
    }
  };

  const runNow = async (jobId: string) => {
    setRunning(prev => new Set(prev).add(jobId));
    try {
      const res = await fetch(`/api/cron/jobs/${jobId}/run`, { method: 'POST', headers });
      const data = await res.json();
      // Refresh the job and history
      await fetchJobs();
      await fetchHistory(jobId);
      if (data.status === 'failed') {
        alert(`Job failed: ${data.error}`);
      }
    } catch (err) {
      console.error('[CronPage] Run failed:', err);
    } finally {
      setRunning(prev => { const s = new Set(prev); s.delete(jobId); return s; });
    }
  };

  const createJob = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const body: any = {
        user_id: user?.id,
        agent_type: newType,
        name: newName.trim(),
        cron_expression: newCron,
        prompt: newType === 'custom' && newCustomPrompt ? newCustomPrompt : newName.trim(),
      };
      await fetch('/api/cron/jobs', { method: 'POST', headers, body: JSON.stringify(body) });
      setNewName('');
      setNewCustomPrompt('');
      setShowCreate(false);
      await fetchJobs();
    } catch (err) {
      console.error('[CronPage] Create failed:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-bg pt-16">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-text-primary flex items-center gap-3">
              <Clock size={24} className="text-brand" />
              Cron Jobs
            </h1>
            <p className="text-sm text-text-secondary mt-1">Automated tasks that run on schedule</p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 active:scale-95 transition-all"
          >
            <Plus size={16} />
            New Job
          </button>
        </div>

        {/* Create Form */}
        {showCreate && (
          <div className="rounded-2xl border border-brand/20 bg-brand/[0.03] p-5 mb-6 space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Create New Cron Job</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-text-secondary uppercase tracking-widest mb-1.5">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Daily Trend Research"
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40"
                />
              </div>

              <div>
                <label className="block text-[11px] text-text-secondary uppercase tracking-widest mb-1.5">Task Type</label>
                <select
                  value={newType}
                  onChange={e => setNewType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm focus:outline-none focus:border-brand/40"
                >
                  {Object.entries(TASK_TYPE_INFO).map(([id, info]) => (
                    <option key={id} value={id}>{info.icon} {info.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-text-secondary uppercase tracking-widest mb-1.5">Schedule</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CRON_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setNewCron(p.value)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      newCron === p.value
                        ? 'bg-brand/20 text-brand border border-brand/30'
                        : 'bg-white/5 text-text-secondary border border-white/5 hover:bg-white/10'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newCron}
                onChange={e => setNewCron(e.target.value)}
                placeholder="0 15 * * *"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm font-mono placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40"
              />
            </div>

            {newType === 'custom' && (
              <div>
                <label className="block text-[11px] text-text-secondary uppercase tracking-widest mb-1.5">Custom Prompt</label>
                <textarea
                  value={newCustomPrompt}
                  onChange={e => setNewCustomPrompt(e.target.value)}
                  placeholder="What should the AI do on each run?"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-text-primary text-sm placeholder:text-text-secondary/30 focus:outline-none focus:border-brand/40 resize-none"
                />
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={createJob}
                disabled={!newName.trim() || creating}
                className="px-5 py-2 rounded-xl bg-brand text-bg text-sm font-bold hover:brightness-110 active:scale-95 transition-all disabled:opacity-30"
              >
                {creating ? 'Creating...' : 'Create Job'}
              </button>
              <button onClick={() => setShowCreate(false)} className="text-sm text-text-secondary hover:text-text-primary">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Jobs List */}
        {loading ? (
          <div className="text-center py-20 text-text-secondary/40 text-sm">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-20">
            <Clock size={48} className="mx-auto text-white/5 mb-4" />
            <p className="text-text-secondary/40 text-sm">No cron jobs yet</p>
            <p className="text-text-secondary/20 text-xs mt-1">Create one above or ask in chat</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => {
              const info = TASK_TYPE_INFO[job.task_type] || { icon: '⚙️', label: job.task_type, color: 'text-text-secondary' };
              const isExpanded = expandedJob === job.id;
              const isRunning = running.has(job.id);
              const jobExecs = executions[job.id] || [];

              return (
                <div key={job.id} className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden">
                  {/* Job header */}
                  <div className="flex items-center gap-3 px-5 py-4">
                    <span className="text-xl">{info.icon}</span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-text-primary truncate">{job.name}</p>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          job.enabled ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-text-secondary/40'
                        }`}>
                          {job.enabled ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[11px] text-text-secondary/50 font-mono">{job.cron_expression}</span>
                        <span className="text-[11px] text-text-secondary/30">{cronToHuman(job.cron_expression)}</span>
                        {job.last_run_at && (
                          <span className="text-[11px] text-text-secondary/30">
                            Last: {timeAgo(job.last_run_at)}
                            {job.last_run_status === 'success' && <CheckCircle size={10} className="inline ml-1 text-green-400" />}
                            {job.last_run_status === 'failed' && <XCircle size={10} className="inline ml-1 text-red-400" />}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => runNow(job.id)}
                        disabled={isRunning}
                        title="Run now"
                        className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-brand transition-all disabled:opacity-30"
                      >
                        {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />}
                      </button>
                      <button
                        onClick={() => toggleEnabled(job)}
                        title={job.enabled ? 'Pause' : 'Resume'}
                        className="p-2 rounded-lg hover:bg-white/5 text-text-secondary hover:text-text-primary transition-all"
                      >
                        {job.enabled ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button
                        onClick={() => deleteJob(job.id)}
                        title="Delete"
                        className="p-2 rounded-lg hover:bg-red-500/10 text-text-secondary hover:text-red-400 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        onClick={() => toggleExpand(job.id)}
                        className="p-2 rounded-lg hover:bg-white/5 text-text-secondary transition-all"
                      >
                        <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded: execution history */}
                  {isExpanded && (
                    <div className="border-t border-white/5 px-5 py-3 bg-white/[0.01]">
                      <p className="text-[11px] text-text-secondary/40 uppercase tracking-widest mb-2">Execution History</p>
                      {jobExecs.length === 0 ? (
                        <p className="text-xs text-text-secondary/30 py-2">No executions yet</p>
                      ) : (
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                          {jobExecs.map(exec => (
                            <div key={exec.id} className="flex items-start gap-2 py-1.5">
                              {exec.status === 'success' ? (
                                <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                              ) : (
                                <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[11px] font-medium ${exec.status === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                    {exec.status}
                                  </span>
                                  <span className="text-[10px] text-text-secondary/30">{timeAgo(exec.executed_at)}</span>
                                </div>
                                {exec.error_message && (
                                  <p className="text-[11px] text-red-400/60 mt-0.5 truncate">{exec.error_message}</p>
                                )}
                                {exec.result?.text && (
                                  <p className="text-[11px] text-text-secondary/40 mt-0.5 line-clamp-2">{exec.result.text.slice(0, 200)}...</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Config display */}
                      {job.config && Object.keys(job.config).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <p className="text-[11px] text-text-secondary/40 uppercase tracking-widest mb-1">Config</p>
                          <pre className="text-[11px] text-text-secondary/30 font-mono bg-white/[0.02] rounded-lg p-2 overflow-x-auto">
                            {JSON.stringify(job.config, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
