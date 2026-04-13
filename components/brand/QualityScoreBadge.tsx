import React from 'react';
import type { QualityScores, GuardrailFlags } from '../../types/brand.types';

interface QualityScoreBadgeProps {
  scores: QualityScores | null;
  guardrails?: GuardrailFlags | null;
  dedupScore?: number;
  compact?: boolean;
}

function scoreColor(score: number): string {
  if (score >= 8) return 'bg-emerald-500';
  if (score >= 7) return 'bg-yellow-500';
  if (score >= 5) return 'bg-orange-500';
  return 'bg-red-500';
}

function scoreTextColor(score: number): string {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 7) return 'text-yellow-400';
  if (score >= 5) return 'text-orange-400';
  return 'text-red-400';
}

export default function QualityScoreBadge({ scores, guardrails, dedupScore, compact = false }: QualityScoreBadgeProps) {
  if (!scores) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${scoreColor(scores.overall)} text-white`}>
          {scores.overall}/10
        </span>
        {guardrails && !guardrails.compliance_ok && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
            Flagged
          </span>
        )}
        {dedupScore !== undefined && dedupScore > 0.85 && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
            Similar
          </span>
        )}
      </div>
    );
  }

  const dimensions = [
    { label: 'Hook', value: scores.hook },
    { label: 'Brand Voice', value: scores.brand_voice },
    { label: 'CTA', value: scores.cta_clarity },
    { label: 'Unique', value: scores.uniqueness },
  ];

  return (
    <div className="space-y-2">
      {/* Overall score */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 w-16">Overall</span>
        <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${scoreColor(scores.overall)}`}
            style={{ width: `${scores.overall * 10}%` }}
          />
        </div>
        <span className={`text-xs font-bold w-8 text-right ${scoreTextColor(scores.overall)}`}>
          {scores.overall}
        </span>
      </div>

      {/* Individual dimensions */}
      {dimensions.map(dim => (
        <div key={dim.label} className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 w-16 truncate">{dim.label}</span>
          <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${scoreColor(dim.value)}`}
              style={{ width: `${dim.value * 10}%` }}
            />
          </div>
          <span className={`text-xs w-6 text-right ${scoreTextColor(dim.value)}`}>{dim.value}</span>
        </div>
      ))}

      {/* Guardrail flags */}
      {guardrails && !guardrails.compliance_ok && (
        <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/20">
          <p className="text-xs font-medium text-red-400 mb-1">Compliance Issues:</p>
          {guardrails.issues.map((issue, i) => (
            <p key={i} className="text-xs text-red-300/70 ml-2">- {issue}</p>
          ))}
        </div>
      )}

      {/* Dedup warning */}
      {dedupScore !== undefined && dedupScore > 0.7 && (
        <div className={`mt-1 text-xs ${dedupScore > 0.85 ? 'text-amber-400' : 'text-zinc-500'}`}>
          Similarity: {(dedupScore * 100).toFixed(0)}% {dedupScore > 0.85 ? '(near duplicate)' : ''}
        </div>
      )}

      {/* Feedback */}
      {scores.feedback && (
        <p className="text-xs text-zinc-500 italic mt-1">{scores.feedback}</p>
      )}
    </div>
  );
}
