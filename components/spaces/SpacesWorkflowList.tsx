import React, { useEffect, useState } from 'react';
import { WorkflowRecord } from '../../types/spaces.types';
import { getUserWorkflows, deleteWorkflow } from '../../services/workflowsService';
import { LayoutGrid, Trash2, Clock, X, Loader2 } from 'lucide-react';

interface SpacesWorkflowListProps {
  userId: string;
  isOpen: boolean;
  onClose: () => void;
  onLoad: (workflow: WorkflowRecord) => void;
  currentWorkflowId?: string;
}

export const SpacesWorkflowList: React.FC<SpacesWorkflowListProps> = ({
  userId,
  isOpen,
  onClose,
  onLoad,
  currentWorkflowId,
}) => {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    getUserWorkflows(userId)
      .then(setWorkflows)
      .finally(() => setLoading(false));
  }, [isOpen, userId]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this workflow?')) return;
    const ok = await deleteWorkflow(id, userId);
    if (ok) setWorkflows(ws => ws.filter(w => w.id !== id));
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className={`absolute right-0 top-28 bottom-0 w-72 z-10 transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="h-full bg-panel/95 backdrop-blur-xl border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LayoutGrid size={16} className="text-brand" />
            <h3 className="text-sm font-bold text-text-primary">My Spaces</h3>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-12 text-text-secondary">
              <Loader2 size={20} className="animate-spin" />
            </div>
          )}

          {!loading && workflows.length === 0 && (
            <div className="text-center py-12 text-text-secondary text-sm">
              <LayoutGrid size={28} className="mx-auto mb-3 opacity-30" />
              No saved spaces yet.
              <br />Save your first workflow!
            </div>
          )}

          {!loading && workflows.map(wf => (
            <button
              key={wf.id}
              onClick={() => onLoad(wf)}
              className={`w-full text-left p-3 rounded-xl border transition-all hover:border-brand/50 hover:bg-surface group ${
                wf.id === currentWorkflowId
                  ? 'border-brand/40 bg-brand/5'
                  : 'border-border bg-surface/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary truncate">{wf.name}</div>
                  <div className="flex items-center gap-1 mt-1 text-[10px] text-text-secondary">
                    <Clock size={9} />
                    {formatDate(wf.updated_at)}
                    <span className="mx-1">·</span>
                    {wf.nodes.length} nodes
                  </div>
                </div>
                <button
                  onClick={e => handleDelete(e, wf.id)}
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-950/50 text-text-secondary hover:text-red-400 transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
