/**
 * Skills & Agents Service
 * Supabase CRUD + skills.sh marketplace integration
 */

import { supabase } from './supabaseClient';

export interface Skill {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string;
  content: string;
  category: string;
  source: 'builtin' | 'marketplace' | 'custom';
  marketplace_id?: string;
  marketplace_source?: string;
  is_agent: boolean;
  tools_access: string[];
  icon: string;
  enabled: boolean;
  created_at: string;
}

export interface MarketplaceSkill {
  id: string;
  skillId: string;
  name: string;
  description: string;
  installs: number;
  source: string;
  isInstalled: boolean;
}

// ── Supabase CRUD ──────────────────────────────────────────────────────────

export async function listSkills(userId: string): Promise<Skill[]> {
  const { data, error } = await supabase
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  const dbSkills = (error || !data) ? [] : data;
  if (error) console.error('[Skills] List error:', error);

  // Deduplicate DB skills by slug (keep the most recent one)
  const seenSlugs = new Set<string>();
  const uniqueDbSkills = dbSkills.filter(s => {
    if (seenSlugs.has(s.slug)) return false;
    seenSlugs.add(s.slug);
    return true;
  });

  // Merge built-in skills that aren't already in the database
  const builtinFallbacks = BUILTIN_SKILLS
    .filter(s => !seenSlugs.has(s.slug))
    .map(s => ({
      ...s,
      id: `builtin-${s.slug}`,
      user_id: userId,
      created_at: new Date().toISOString(),
    } as Skill));

  return [...uniqueDbSkills, ...builtinFallbacks];
}

export async function getSkillBySlug(userId: string, slug: string): Promise<Skill | null> {
  const { data } = await supabase
    .from('skills')
    .select('*')
    .eq('user_id', userId)
    .eq('slug', slug)
    .eq('enabled', true)
    .single();

  if (data) return data;

  // Fallback to built-in skill definition
  const builtin = BUILTIN_SKILLS.find(s => s.slug === slug && s.enabled);
  if (builtin) {
    return {
      ...builtin,
      id: `builtin-${builtin.slug}`,
      user_id: userId,
      created_at: new Date().toISOString(),
    } as Skill;
  }

  return null;
}

export async function createSkill(skill: Partial<Skill> & { user_id: string; name: string; content: string }): Promise<Skill | null> {
  const slug = skill.slug || skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { data, error } = await supabase
    .from('skills')
    .insert({
      ...skill,
      slug,
      source: skill.source || 'custom',
      is_agent: skill.is_agent || false,
      tools_access: skill.tools_access || [],
      icon: skill.icon || '⚡',
      enabled: true,
    })
    .select()
    .single();
  if (error) { console.error('[Skills] Create error:', error); return null; }
  return data;
}

export async function updateSkill(id: string, updates: Partial<Skill>): Promise<boolean> {
  const { error } = await supabase
    .from('skills')
    .update(updates)
    .eq('id', id);
  if (error) { console.error('[Skills] Update error:', error); return false; }
  return true;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('skills')
    .delete()
    .eq('id', id);
  if (error) { console.error('[Skills] Delete error:', error); return false; }
  return true;
}

export async function toggleSkill(id: string, enabled: boolean): Promise<boolean> {
  return updateSkill(id, { enabled } as any);
}

// ── Marketplace (skills.sh) ────────────────────────────────────────────────

export async function searchMarketplace(query: string, limit = 20): Promise<MarketplaceSkill[]> {
  try {
    // Use server proxy to avoid CORS issues with skills.sh
    const url = `/api/skills/search?q=${encodeURIComponent(query || 'claude')}&limit=${limit}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data: any = await res.json();

    const results = data.results || data.skills || data || [];
    return results.map((s: any) => ({
      id: s.id || s.slug || s.name,
      skillId: s.slug || s.skillId || s.name || s.id,
      name: s.name || s.slug || s.id,
      description: s.description || '',
      installs: s.installs || s.downloads || 0,
      source: s.source || '',
      isInstalled: false,
    }));
  } catch (err: any) {
    console.warn('[Skills] Marketplace search failed:', err.message);
    return [];
  }
}

export async function fetchSkillReadme(source: string): Promise<string> {
  try {
    if (!source) return '';
    // Use server proxy to avoid CORS
    const res = await fetch(`/api/skills/readme?source=${encodeURIComponent(source)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.content || '';
  } catch {
    return '';
  }
}

export async function installFromMarketplace(
  userId: string,
  marketplaceSkill: MarketplaceSkill,
): Promise<Skill | null> {
  // Fetch the skill content from GitHub
  const content = await fetchSkillReadme(marketplaceSkill.source);
  if (!content) return null;

  // Parse front matter for metadata
  const { name, description, category, isAgent, icon } = parseFrontMatter(content, marketplaceSkill.name);

  return createSkill({
    user_id: userId,
    name,
    slug: marketplaceSkill.skillId,
    description: description || marketplaceSkill.description,
    content,
    category,
    source: 'marketplace',
    marketplace_id: marketplaceSkill.id,
    marketplace_source: marketplaceSkill.source,
    is_agent: isAgent,
    icon,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseFrontMatter(content: string, fallbackName: string) {
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  let name = fallbackName;
  let description = '';
  let category = 'custom';
  let isAgent = false;
  let icon = '⚡';

  if (match) {
    const yaml = match[1];
    const nameMatch = yaml.match(/^name:\s*(.+)$/m);
    const descMatch = yaml.match(/^description:\s*(.+)$/m);
    const catMatch = yaml.match(/^category:\s*(.+)$/m);
    const agentMatch = yaml.match(/^(?:is_agent|agent):\s*(.+)$/m);
    const iconMatch = yaml.match(/^icon:\s*(.+)$/m);

    if (nameMatch) name = nameMatch[1].trim();
    if (descMatch) description = descMatch[1].trim();
    if (catMatch) category = catMatch[1].trim();
    if (agentMatch) isAgent = ['true', 'yes', '1'].includes(agentMatch[1].trim().toLowerCase());
    if (iconMatch) icon = iconMatch[1].trim();
  }

  if (!description) {
    const lines = content.replace(/^---[\s\S]*?---\n?/, '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        description = trimmed.slice(0, 120);
        break;
      }
    }
  }

  return { name, description, category, isAgent, icon };
}

// ── Built-in Skills (seeded on first use) ──────────────────────────────────

export const BUILTIN_SKILLS: Omit<Skill, 'id' | 'user_id' | 'created_at'>[] = [
  {
    name: 'SEO Auditor',
    slug: 'seo-auditor',
    description: 'Audit any website for SEO issues and get actionable fixes',
    content: `You are an expert SEO auditor. When given a URL or website, perform a comprehensive SEO audit covering:
- Technical SEO (meta tags, headings, schema markup, page speed indicators)
- On-page SEO (keyword usage, content quality, internal linking)
- Off-page signals (if data available)
- Mobile friendliness
- Core Web Vitals indicators

Use the search_web tool to check the site and gather data. Present findings in a clear report with severity ratings (Critical/Warning/Info) and specific fix instructions.`,
    category: 'marketing',
    source: 'builtin',
    is_agent: true,
    tools_access: ['search_web', 'scan_brand_website'],
    icon: '🔍',
    enabled: true,
    marketplace_id: undefined,
    marketplace_source: undefined,
  },
  {
    name: 'Content Strategist',
    slug: 'content-strategist',
    description: 'Plan a content strategy with topics, formats, and publishing schedule',
    content: `You are a senior content strategist. When asked to plan content:
1. Research the brand/niche using search_web
2. Identify 5-10 content pillars based on audience and goals
3. For each pillar, suggest 3-5 specific content pieces with: title, format (post/reel/story/carousel), platform, hook, and CTA
4. Create a weekly publishing schedule
5. Include engagement predictions and A/B test suggestions

Always consider the user's brand profile and creative style preferences.`,
    category: 'marketing',
    source: 'builtin',
    is_agent: true,
    tools_access: ['search_web', 'generate_content_calendar', 'generate_content_brief'],
    icon: '📋',
    enabled: true,
    marketplace_id: undefined,
    marketplace_source: undefined,
  },
  {
    name: 'Ad Creative Generator',
    slug: 'ad-creative-gen',
    description: 'Generate scroll-stopping ad creatives with copy and visuals',
    content: `You are an elite performance marketing creative director. When asked to create ads:
1. Ask about the product, target audience, and platform if not provided
2. Generate 3 ad variations, each with:
   - Headline (under 40 chars)
   - Primary text (platform-appropriate length)
   - CTA text
   - Image prompt for generate_image tool
3. Use direct response copywriting principles: problem → agitation → solution
4. Include A/B testing recommendations
5. Generate the visuals using generate_image

Focus on thumb-stopping power and clear value propositions.`,
    category: 'ads',
    source: 'builtin',
    is_agent: true,
    tools_access: ['generate_image', 'search_web'],
    icon: '🎯',
    enabled: true,
    marketplace_id: undefined,
    marketplace_source: undefined,
  },
  {
    name: 'Competitor Analyzer',
    slug: 'competitor-analyzer',
    description: 'Deep-dive competitor analysis with actionable gaps',
    content: `You are a competitive intelligence analyst. When given a brand or competitor:
1. Use search_web to research the competitor thoroughly
2. Analyze their: positioning, messaging, visual style, content strategy, pricing
3. Identify gaps and opportunities the user can exploit
4. Suggest 5 specific content/campaign ideas that differentiate from the competitor
5. Provide a SWOT summary

Be data-driven and specific. No generic advice.`,
    category: 'strategy',
    source: 'builtin',
    is_agent: true,
    tools_access: ['search_web', 'scan_brand_website'],
    icon: '🔬',
    enabled: true,
    marketplace_id: undefined,
    marketplace_source: undefined,
  },
  {
    name: 'Brand Voice Writer',
    slug: 'brand-voice-writer',
    description: 'Write in any brand\'s voice — captions, emails, ads, bios',
    content: `You are a brand voice specialist. You write exclusively in the brand's unique voice and tone.
1. First check if the user has a brand profile — use list_brands and their brand DNA
2. Match the brand's tone, vocabulary, and style exactly
3. Adapt to the requested format: social caption, email, ad copy, bio, tagline, etc.
4. Always maintain brand consistency while being creative
5. Suggest 2-3 variations with different emotional angles

Never use generic marketing language. Every word should feel like it came from the brand itself.`,
    category: 'creative',
    source: 'builtin',
    is_agent: false,
    tools_access: ['list_brands', 'search_brain'],
    icon: '✍️',
    enabled: true,
    marketplace_id: undefined,
    marketplace_source: undefined,
  },
];

export async function seedBuiltinSkills(userId: string): Promise<void> {
  // Query DB directly to avoid builtin fallbacks inflating the list
  const { data } = await supabase
    .from('skills')
    .select('slug')
    .eq('user_id', userId);
  const existingSlugs = new Set((data || []).map((s: any) => s.slug));

  for (const skill of BUILTIN_SKILLS) {
    if (!existingSlugs.has(skill.slug)) {
      await createSkill({ ...skill, user_id: userId } as any);
    }
  }
}
