import React from 'react';
import { NodeStatus } from '../../types/spaces.types';

interface Props {
  status: NodeStatus;
}

export const NodeStatusBadge: React.FC<Props> = ({ status }) => {
  if (status === 'idle') return null;

  const map: Record<NodeStatus, { label: string; cls: string }> = {
    idle: { label: '', cls: '' },
    running: { label: 'Running', cls: 'bg-brand/20 text-brand' },
    done: { label: 'Done', cls: 'bg-green-950/60 text-green-400' },
    error: { label: 'Error', cls: 'bg-red-950/60 text-red-400' },
  };

  const { label, cls } = map[status];
  return (
    <span className={`ml-auto text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full ${cls}`}>
      {label}
    </span>
  );
};
