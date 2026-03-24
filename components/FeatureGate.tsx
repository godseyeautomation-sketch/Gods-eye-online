import React from 'react';
import { Lock, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface FeatureGateProps {
  feature: 'video' | 'spaces';
  children: React.ReactNode;
}

export const FeatureGate: React.FC<FeatureGateProps> = ({ feature, children }) => {
  const { canUseVideo, canUseSpaces, isAdmin } = useAuth();

  // Super admin always bypasses the gate
  if (isAdmin) return <>{children}</>;

  const hasAccess = feature === 'video' ? canUseVideo : canUseSpaces;

  if (hasAccess) return <>{children}</>;

  const featureName = feature === 'video' ? 'AI Video Studio' : 'Spaces Canvas';

  return (
    <div className="h-full w-full flex items-center justify-center relative overflow-hidden">
      {/* Background blur effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-bg via-panel/50 to-bg" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(202,255,0,0.03)_0%,transparent_70%)]" />

      {/* Animated grid lines */}
      <div className="absolute inset-0 opacity-10"
        style={{
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '40px 40px'
        }}
      />

      {/* Main card */}
      <div className="relative z-10 flex flex-col items-center text-center gap-6 p-10 max-w-md">
        {/* Lock icon with glow */}
        <div className="relative">
          <div className="absolute inset-0 bg-brand/20 rounded-full blur-2xl scale-150" />
          <div className="relative w-20 h-20 rounded-2xl bg-panel border border-brand/30 flex items-center justify-center shadow-[0_0_40px_rgba(202,255,0,0.15)]">
            <Lock size={36} className="text-brand" />
          </div>
        </div>

        {/* Text */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand/10 border border-brand/20 text-brand text-xs font-bold uppercase tracking-widest">
            Premium Feature
          </div>
          <h2 className="text-2xl font-bold text-text-primary">
            {featureName} is Locked
          </h2>
          <p className="text-text-secondary text-sm leading-relaxed">
            This feature requires admin approval. Contact your admin to get access to <strong className="text-text-primary">{featureName}</strong>.
          </p>
        </div>

        {/* CTA */}
        <a
          href="mailto:bitan@outreachpro.io?subject=Access Request: Gods Eye AI&body=Hi, I'd like to request access to the {featureName} feature on Gods Eye AI."
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-brand text-bg font-bold text-sm hover:bg-brand/90 transition-all hover:shadow-[0_0_20px_rgba(202,255,0,0.4)] active:scale-95"
        >
          <Mail size={16} />
          Contact Admin to Unlock
        </a>

        <p className="text-text-secondary/50 text-xs">
          Your request will be reviewed by the platform administrator.
        </p>
      </div>
    </div>
  );
};
