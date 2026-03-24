import type { ConnectorPlatform, UserConnector } from '../types/connector.types';

const API = '/api/connectors';

export async function getPlatforms(): Promise<ConnectorPlatform[]> {
  const res = await fetch(`${API}/platforms`);
  if (!res.ok) return [];
  return res.json();
}

export async function getUserConnectors(userId: string): Promise<UserConnector[]> {
  const res = await fetch(`${API}/list?user_id=${userId}`);
  if (!res.ok) return [];
  return res.json();
}

export async function getOAuthUrl(platform: string, userId: string): Promise<string | null> {
  const res = await fetch(`${API}/auth/${platform}/url?user_id=${userId}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.ok ? data.url : null;
}

export async function saveApiKey(userId: string, platform: string, apiKey: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch(`${API}/api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, platform, api_key: apiKey }),
  });
  return res.json();
}

export async function disconnect(userId: string, platform: string): Promise<void> {
  await fetch(`${API}/${platform}?user_id=${userId}`, { method: 'DELETE' });
}

export async function toggleConnector(userId: string, platform: string, enabled: boolean): Promise<void> {
  await fetch(`${API}/${platform}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, enabled }),
  });
}
