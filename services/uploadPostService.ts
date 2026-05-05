/**
 * Upload-Post API Service
 *
 * Frontend client for the Upload-Post API proxy (/api/upload-post/*).
 * Handles social media publishing, scheduling, analytics, and profile management.
 */

import type { SocialPlatform, PublishResult, SocialProfile, UploadStatus, ScheduledPost, PostAnalytics } from '../types/brand.types';

// ── Core Upload Endpoints ────────────────────────────────────────────────────

export interface PhotoUploadOptions {
  platforms: SocialPlatform[];
  user: string;                    // Upload-Post profile username
  caption?: string;
  hashtags?: string[];
  first_comment?: string;
  scheduled_date?: string;         // ISO-8601
  add_to_queue?: boolean;
  async_upload?: boolean;
  // Platform-specific
  facebook_page_id?: string;
  linkedin_page_id?: string;
  pinterest_board_id?: string;
  tiktok_post_mode?: 'DIRECT_POST' | 'MEDIA_UPLOAD';
}

export interface VideoUploadOptions extends PhotoUploadOptions {
  title?: string;
  youtube_privacy?: 'public' | 'private' | 'unlisted';
}

export interface TextUploadOptions {
  platforms: SocialPlatform[];
  user: string;
  text: string;
  first_comment?: string;
  scheduled_date?: string;
  add_to_queue?: boolean;
}

/** Convert any image URL (blob:, data:, http) to a File object */
async function urlToFile(url: string, filename = 'photo.jpg'): Promise<File> {
  const res = await fetch(url);
  const blob = await res.blob();
  const ext = blob.type.includes('png') ? '.png' : '.jpg';
  return new File([blob], filename.replace(/\.\w+$/, ext), { type: blob.type || 'image/jpeg' });
}

/** Upload a photo to social media platforms via multipart/form-data */
export async function uploadPhoto(mediaUrl: string, options: PhotoUploadOptions): Promise<PublishResult> {
  const formData = new FormData();

  // Convert the image to a File and add as photos[]
  const file = await urlToFile(mediaUrl, 'post-image.jpg');
  formData.append('photos[]', file);

  // Required fields
  formData.append('user', options.user);
  options.platforms.forEach(p => formData.append('platform[]', p));

  // Optional fields
  let captionText = options.caption || '';
  if (options.hashtags?.length) {
    captionText = `${captionText}\n\n${options.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ')}`.trim();
  }
  if (captionText) formData.append('description', captionText);
  if (options.scheduled_date) formData.append('scheduled_date', options.scheduled_date);
  if (options.first_comment) formData.append('first_comment', options.first_comment);
  if (options.facebook_page_id) formData.append('facebook_page_id', options.facebook_page_id);
  if (options.linkedin_page_id) formData.append('target_linkedin_page_id', options.linkedin_page_id);
  if (options.pinterest_board_id) formData.append('pinterest_board_id', options.pinterest_board_id);
  if (options.async_upload) formData.append('async_upload', 'true');

  const res = await fetch('/api/upload-post/photos', {
    method: 'POST',
    body: formData,  // No Content-Type header — browser sets multipart boundary automatically
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || err.message || `Upload failed: ${res.status}`);
  }
  return res.json();
}

/** Upload a video to social media platforms */
export async function uploadVideo(mediaUrl: string, options: VideoUploadOptions): Promise<PublishResult> {
  const body: any = {
    ...options,
    media_url: mediaUrl,
    platforms: options.platforms,
  };

  const res = await fetch('/api/upload-post/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || err.message || `Upload failed: ${res.status}`);
  }
  return res.json();
}

/** Post text-only content to platforms */
export async function uploadText(options: TextUploadOptions): Promise<PublishResult> {
  const res = await fetch('/api/upload-post/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || err.message || `Upload failed: ${res.status}`);
  }
  return res.json();
}

// ── Status & History ─────────────────────────────────────────────────────────

/** Check status of an async upload */
export async function getUploadStatus(requestId: string): Promise<UploadStatus> {
  const res = await fetch(`/api/upload-post/status?request_id=${encodeURIComponent(requestId)}`);
  if (!res.ok) throw new Error('Failed to get upload status');
  return res.json();
}

/** Get upload history — `userId` is required for server-side filtering to
 *  just the caller's owned profiles. Omitting it returns an empty list. */
export async function getHistory(page = 1, limit = 20, userId?: string): Promise<any> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (userId) qs.set('user_id', userId);
  const res = await fetch(`/api/upload-post/history?${qs.toString()}`, {
    headers: userId ? { 'x-user-id': userId } : undefined,
  });
  if (!res.ok) throw new Error('Failed to get history');
  return res.json();
}

// ── Schedule Management ──────────────────────────────────────────────────────

/** List scheduled posts — `userId` required for server-side filtering. */
export async function getScheduledPosts(userId?: string): Promise<ScheduledPost[]> {
  const res = await fetch('/api/upload-post/schedule', {
    headers: userId ? { 'x-user-id': userId } : undefined,
  });
  if (!res.ok) throw new Error('Failed to get scheduled posts');
  const data = await res.json();
  return data.data || data.scheduled_posts || data || [];
}

/** Cancel a scheduled post */
export async function cancelScheduledPost(jobId: string): Promise<void> {
  const res = await fetch(`/api/upload-post/schedule/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to cancel scheduled post');
}

/** Edit a scheduled post */
export async function editScheduledPost(jobId: string, updates: Record<string, any>): Promise<any> {
  const res = await fetch(`/api/upload-post/schedule/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to edit scheduled post');
  return res.json();
}

// ── Queue System ─────────────────────────────────────────────────────────────

/** Get queue settings */
export async function getQueueSettings(): Promise<any> {
  const res = await fetch('/api/upload-post/queue/settings');
  if (!res.ok) throw new Error('Failed to get queue settings');
  return res.json();
}

/** Update queue settings */
export async function updateQueueSettings(settings: { slots?: string[]; timezone?: string }): Promise<any> {
  const res = await fetch('/api/upload-post/queue/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update queue settings');
  return res.json();
}

// ── Analytics ────────────────────────────────────────────────────────────────

/** Get analytics for a profile */
export async function getProfileAnalytics(profileUsername: string): Promise<PostAnalytics> {
  const res = await fetch(`/api/upload-post/analytics/${encodeURIComponent(profileUsername)}`);
  if (!res.ok) throw new Error('Failed to get analytics');
  return res.json();
}

/** Get analytics for a specific post */
export async function getPostAnalytics(requestId: string): Promise<any> {
  const res = await fetch(`/api/upload-post/post-analytics/${encodeURIComponent(requestId)}`);
  if (!res.ok) throw new Error('Failed to get post analytics');
  return res.json();
}

/** Get total impressions for a profile */
export async function getTotalImpressions(profileUsername: string): Promise<any> {
  const res = await fetch(`/api/upload-post/impressions/${encodeURIComponent(profileUsername)}`);
  if (!res.ok) throw new Error('Failed to get impressions');
  return res.json();
}

// ── User/Profile Management ──────────────────────────────────────────────────

/** List connected social profiles (filtered by userId) */
export async function getProfiles(userId?: string): Promise<SocialProfile[]> {
  const qs = userId ? `?user_id=${encodeURIComponent(userId)}` : '';
  const res = await fetch(`/api/upload-post/users${qs}`, {
    headers: userId ? { 'x-user-id': userId } : undefined,
  });
  if (!res.ok) throw new Error('Failed to get profiles');
  const data = await res.json();
  return data.profiles || data.data || data.users || [];
}

/** Generate a secure URL for a user to connect their social accounts via OAuth */
export async function generateConnectUrl(username: string, options?: {
  userId?: string;
  platforms?: string[];
  logoImage?: string;
  connectTitle?: string;
  connectDescription?: string;
  showCalendar?: boolean;
}): Promise<{ access_url: string; duration: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options?.userId) headers['x-user-id'] = options.userId;
  const res = await fetch('/api/upload-post/users/generate-jwt', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username,
      // user_id in the body so the server can pre-create the ownership row
      // even before the user finishes the OAuth flow on upload-post.com
      ...(options?.userId ? { user_id: options.userId } : {}),
      platforms: options?.platforms || ['tiktok', 'instagram', 'facebook', 'x', 'linkedin', 'youtube', 'threads', 'pinterest', 'google_business'],
      connect_title: options?.connectTitle || 'Connect Social Media',
      connect_description: options?.connectDescription || 'Link your social accounts to Gods Eye Studio',
      logo_image: options?.logoImage,
      show_calendar: options?.showCalendar ?? false,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to generate connect URL' }));
    throw new Error(err.error || err.message || 'Failed to generate connect URL');
  }
  return res.json();
}

/**
 * Quick check whether the current user has at least one Upload-Post profile
 * with a connected platform. Used by the global "needs connection" popup
 * to decide whether to show.
 */
export async function checkAnyConnection(userId: string): Promise<{ connected: boolean; profiles: SocialProfile[] }> {
  try {
    const profiles = await getProfiles(userId);
    const connected = profiles.some(p => {
      const accts = p.social_accounts || {};
      return Object.values(accts).some(v => v && String(v).length > 0);
    });
    return { connected, profiles };
  } catch {
    return { connected: false, profiles: [] };
  }
}

/** Create a new social profile (tagged with userId for isolation) */
export async function createProfile(profile: { username: string; platform?: string; user_id?: string }): Promise<SocialProfile> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (profile.user_id) headers['x-user-id'] = profile.user_id;
  const res = await fetch('/api/upload-post/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(profile),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to create profile' }));
    throw new Error(err.error || err.message || 'Failed to create profile');
  }
  return res.json();
}

/** Delete a social profile */
export async function deleteProfile(username: string, userId?: string): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  const res = await fetch('/api/upload-post/users', {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ username, user_id: userId }),
  });
  if (!res.ok) throw new Error('Failed to delete profile');
}

/** Verify API account */
export async function verifyAccount(): Promise<{ email: string; plan: string }> {
  const res = await fetch('/api/upload-post/me');
  if (!res.ok) throw new Error('Failed to verify account');
  return res.json();
}

// ── Platform Helpers ─────────────────────────────────────────────────────────

/** Get Facebook pages for a user */
export async function getFacebookPages(user: string): Promise<any[]> {
  const res = await fetch(`/api/upload-post/facebook/pages?user=${encodeURIComponent(user)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || data.pages || [];
}

/** Get LinkedIn company pages */
export async function getLinkedInPages(user: string): Promise<any[]> {
  const res = await fetch(`/api/upload-post/linkedin/pages?user=${encodeURIComponent(user)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || data.pages || [];
}

/** Get Pinterest boards */
export async function getPinterestBoards(user: string): Promise<any[]> {
  const res = await fetch(`/api/upload-post/pinterest/boards?user=${encodeURIComponent(user)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || data.boards || [];
}

// ── Media Retrieval ──────────────────────────────────────────────────────────

/** Get recent posts for a user on a platform */
export async function getRecentMedia(platform: string, user: string): Promise<any[]> {
  const res = await fetch(`/api/upload-post/media?platform=${encodeURIComponent(platform)}&user=${encodeURIComponent(user)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.data || data.media || [];
}
