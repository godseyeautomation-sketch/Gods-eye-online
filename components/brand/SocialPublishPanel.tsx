import React, { useState, useEffect } from 'react';
import { X, Send, Clock, Loader2, CheckCircle2, AlertCircle, ExternalLink, Upload } from 'lucide-react';
import { SOCIAL_PLATFORMS, type SocialPlatform, type SocialProfile, type ContentSlot } from '../../types/brand.types';
import { getProfiles, uploadPhoto, uploadText, getUploadStatus } from '../../services/uploadPostService';

interface Props {
  slot: ContentSlot;
  onClose: () => void;
  onPublished: (platforms: string[], requestId: string) => void;
}

type PublishMode = 'now' | 'schedule';

export const SocialPublishPanel: React.FC<Props> = ({ slot, onClose, onPublished }) => {
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [selectedPlatforms, setSelectedPlatforms] = useState<SocialPlatform[]>([]);
  const [selectedProfile, setSelectedProfile] = useState('');
  const [mode, setMode] = useState<PublishMode>('now');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [caption, setCaption] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ success: boolean; message: string; requestId?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cache image as stable data URL so blob: URLs don't break on re-render
  const [stableImageUrl, setStableImageUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!slot.generated_image) return;
    if (slot.generated_image.startsWith('data:') || slot.generated_image.startsWith('http')) {
      setStableImageUrl(slot.generated_image);
      return;
    }
    // Convert blob: URL to data URL for stability
    fetch(slot.generated_image)
      .then(r => r.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => setStableImageUrl(reader.result as string);
        reader.readAsDataURL(blob);
      })
      .catch(() => setStableImageUrl(slot.generated_image));
  }, [slot.generated_image]);

  // Build default caption from brief
  useEffect(() => {
    const parts: string[] = [];
    if (slot.brief?.hook) parts.push(slot.brief.hook);
    if (slot.brief?.caption) parts.push(slot.brief.caption);
    if (slot.brief?.call_to_action) parts.push(slot.brief.call_to_action);
    if (slot.brief?.hashtags?.length) {
      parts.push('\n' + slot.brief.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' '));
    }
    setCaption(parts.join('\n\n'));

    // Default schedule to slot date
    if (slot.slot_date) setScheduleDate(slot.slot_date);
  }, [slot]);

  // Load profiles
  useEffect(() => {
    getProfiles()
      .then(p => {
        setProfiles(p);
        if (p.length > 0) setSelectedProfile(p[0].username);
      })
      .catch(() => {})
      .finally(() => setLoadingProfiles(false));
  }, []);

  const togglePlatform = (p: SocialPlatform) => {
    setSelectedPlatforms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  };

  const handlePublish = async () => {
    if (!selectedProfile) { setError('Select a profile first'); return; }
    if (selectedPlatforms.length === 0) { setError('Select at least one platform'); return; }

    setPublishing(true);
    setError(null);
    setPublishResult(null);

    try {
      let scheduledDate: string | undefined;
      if (mode === 'schedule' && scheduleDate) {
        scheduledDate = `${scheduleDate}T${scheduleTime}:00`;
      }

      let result;
      if (stableImageUrl) {
        // Use the cached stable image URL (data: or blob:)
        result = await uploadPhoto(stableImageUrl, {
          platforms: selectedPlatforms,
          user: selectedProfile,
          caption,
          scheduled_date: scheduledDate,
          async_upload: true,
        });
      } else {
        // Text-only post
        result = await uploadText({
          platforms: selectedPlatforms,
          user: selectedProfile,
          text: caption,
          scheduled_date: scheduledDate,
        });
      }

      setPublishResult({
        success: result.success !== false,
        message: result.message || (mode === 'schedule' ? 'Scheduled successfully!' : 'Published successfully!'),
        requestId: result.request_id,
      });

      if (result.request_id) {
        onPublished(selectedPlatforms, result.request_id);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="font-bold text-text-primary">Publish to Social Media</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* Profile Selector */}
          <section>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-widest block mb-2">Profile</label>
            {loadingProfiles ? (
              <Loader2 size={14} className="animate-spin text-text-secondary" />
            ) : profiles.length === 0 ? (
              <div className="p-3 bg-amber-950/40 border border-amber-600/30 rounded-xl">
                <p className="text-amber-400 text-xs font-bold">No profiles connected</p>
                <p className="text-amber-300/80 text-[10px] mt-1">Go to the Social Accounts tab to add a profile first.</p>
              </div>
            ) : (
              <select
                value={selectedProfile}
                onChange={e => setSelectedProfile(e.target.value)}
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-brand"
              >
                {profiles.map(p => (
                  <option key={p.username} value={p.username}>{p.username}</option>
                ))}
              </select>
            )}
          </section>

          {/* Platform Selector */}
          <section>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-widest block mb-2">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {SOCIAL_PLATFORMS.map(p => (
                <button
                  key={p.key}
                  onClick={() => togglePlatform(p.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                    selectedPlatforms.includes(p.key)
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-text-secondary hover:border-text-secondary'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.label}
                </button>
              ))}
            </div>
          </section>

          {/* Publish Mode */}
          <section>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-widest block mb-2">When</label>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setMode('now')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-medium transition-all ${
                  mode === 'now' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-secondary'
                }`}
              >
                <Send size={12} /> Post Now
              </button>
              <button
                onClick={() => setMode('schedule')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-medium transition-all ${
                  mode === 'schedule' ? 'border-brand bg-brand/10 text-brand' : 'border-border text-text-secondary'
                }`}
              >
                <Clock size={12} /> Schedule
              </button>
            </div>

            {mode === 'schedule' && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={e => setScheduleDate(e.target.value)}
                  className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-brand"
                />
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={e => setScheduleTime(e.target.value)}
                  className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-brand"
                />
              </div>
            )}
          </section>

          {/* Caption */}
          <section>
            <label className="text-xs font-bold text-text-secondary uppercase tracking-widest block mb-2">Caption</label>
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              rows={5}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-text-primary text-sm placeholder-text-secondary focus:outline-none focus:border-brand transition-colors resize-none"
              placeholder="Write your caption..."
            />
            <p className="text-[10px] text-text-secondary mt-1">{caption.length} characters</p>
          </section>

          {/* Image Preview */}
          {stableImageUrl && (
            <section>
              <label className="text-xs font-bold text-text-secondary uppercase tracking-widest block mb-2">Image</label>
              <img src={stableImageUrl} alt="Post" className="w-full rounded-xl border border-border object-cover max-h-48" />
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-950/40 border border-red-900/60 rounded-xl text-red-400 text-xs">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Result */}
          {publishResult && (
            <div className={`flex items-start gap-2 p-3 rounded-xl text-xs ${
              publishResult.success
                ? 'bg-emerald-950/40 border border-emerald-800/60 text-emerald-400'
                : 'bg-red-950/40 border border-red-900/60 text-red-400'
            }`}>
              {publishResult.success ? <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />}
              <div>
                <p className="font-bold">{publishResult.message}</p>
                {publishResult.requestId && (
                  <p className="mt-1 opacity-80">Request ID: {publishResult.requestId}</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <button
            onClick={handlePublish}
            disabled={publishing || selectedPlatforms.length === 0 || !selectedProfile || !!publishResult?.success}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand text-bg text-sm font-bold disabled:opacity-50 hover:opacity-90 transition-all"
          >
            {publishing ? (
              <><Loader2 size={16} className="animate-spin" /> Publishing...</>
            ) : publishResult?.success ? (
              <><CheckCircle2 size={16} /> Published!</>
            ) : mode === 'schedule' ? (
              <><Clock size={16} /> Schedule Post</>
            ) : (
              <><Send size={16} /> Publish Now</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
