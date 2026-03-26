// Ad Campaign Service — client-side API for campaign management
import type { AdCampaign, AdCreative } from '../types/brand.types';

const BASE = '/api/campaigns';

export async function listCampaigns(userId: string, brandId?: string, platform?: string): Promise<AdCampaign[]> {
  const params = new URLSearchParams({ user_id: userId });
  if (brandId) params.set('brand_id', brandId);
  if (platform) params.set('platform', platform);
  const res = await fetch(`${BASE}/list?${params}`);
  if (!res.ok) return [];
  return res.json();
}

export async function syncCampaigns(userId: string, platform: 'google_ads' | 'meta_ads', brandId?: string): Promise<AdCampaign[]> {
  const res = await fetch(`${BASE}/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, platform, brand_id: brandId }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.campaigns || [];
}

export async function getCampaignMetrics(userId: string, campaignId: string, dateRange?: string) {
  const params = new URLSearchParams({ user_id: userId });
  if (dateRange) params.set('date_range', dateRange);
  const res = await fetch(`${BASE}/${campaignId}/metrics?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function updateCampaignStatus(userId: string, campaignId: string, status: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${BASE}/${campaignId}/update-status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, status }),
  });
  return res.json();
}

export async function pushCreative(userId: string, opts: {
  platform: string;
  image_url: string;
  asset_name?: string;
  campaign_id?: string;
  brand_id?: string;
}): Promise<{ success: boolean; error?: string }> {
  const campaignId = opts.campaign_id || 'none';
  const res = await fetch(`${BASE}/${campaignId}/push-creative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: userId,
      image_url: opts.image_url,
      asset_name: opts.asset_name || 'GodsEye Creative',
      platform: opts.platform,
      brand_id: opts.brand_id,
    }),
  });
  return res.json();
}

export async function createCampaign(userId: string, platform: string, params: Record<string, any>): Promise<{ success: boolean; campaign_id?: string; error?: string }> {
  const res = await fetch(`${BASE}/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, platform, ...params }),
  });
  return res.json();
}

export async function listCreatives(userId: string, campaignId?: string): Promise<AdCreative[]> {
  const params = new URLSearchParams({ user_id: userId });
  if (campaignId) params.set('campaign_id', campaignId);
  const res = await fetch(`${BASE}/creatives?${params}`);
  if (!res.ok) return [];
  return res.json();
}
