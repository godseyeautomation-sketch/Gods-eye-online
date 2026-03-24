/**
 * Bridge Skill — Context sync between Gemini and Local AI
 *
 * Two directions:
 * 1. Gemini → Local: Summarize chat context into a compact brief for the local AI
 * 2. Local → Gemini: Summarize terminal transcript for Gemini to use with creative tools
 */

import type { ChatMessage } from './conversationService';

/**
 * Build context brief from Gemini chat to send to local AI as first prompt
 *
 * Takes: recent chat messages, user profile, brand data
 * Returns: ~500 word context brief string
 */
export function buildContextBrief(params: {
  messages: ChatMessage[];
  personality?: any;
  brandProfile?: any;
  skillContext?: string;
}): string {
  const { messages, personality, brandProfile, skillContext } = params;
  const parts: string[] = [];

  parts.push('═══ GODS EYE STUDIO CONTEXT ═══');
  parts.push('You are working inside Gods Eye Studio, a creative AI platform.');
  parts.push('The user has switched to local mode for file/code work.');
  parts.push('When they need images, videos, or web research, they will switch back to Gemini.');
  parts.push('');

  // User profile
  if (personality) {
    parts.push('── USER PROFILE ──');
    parts.push(`Name: ${personality.name || 'User'}`);
    parts.push(`Role: ${(personality.role || '').replace(/_/g, ' ')}`);
    if (personality.vibes?.length) parts.push(`Creative style: ${personality.vibes.join(', ')}`);
    if (personality.use_cases?.length) parts.push(`Creates: ${personality.use_cases.join(', ')}`);
    if (personality.soul) parts.push(`AI personality: ${personality.soul}`);
    parts.push('');
  }

  // Brand context
  if (brandProfile) {
    parts.push('── ACTIVE BRAND ──');
    parts.push(`Brand: ${brandProfile.name || 'Unknown'}`);
    if (brandProfile.industry) parts.push(`Industry: ${brandProfile.industry}`);
    if (brandProfile.audience) parts.push(`Audience: ${brandProfile.audience}`);
    if (brandProfile.tone) parts.push(`Tone: ${brandProfile.tone}`);
    if (brandProfile.tagline) parts.push(`Tagline: ${brandProfile.tagline}`);
    if (brandProfile.colors?.length) parts.push(`Colors: ${brandProfile.colors.join(', ')}`);
    if (brandProfile.keywords?.length) parts.push(`Keywords: ${brandProfile.keywords.join(', ')}`);
    parts.push('');
  }

  // Active skill
  if (skillContext) {
    parts.push('── ACTIVE SKILL ──');
    parts.push(skillContext);
    parts.push('');
  }

  // Recent conversation (last 10 messages, summarized)
  if (messages.length > 0) {
    parts.push('── RECENT CONVERSATION ──');
    const recent = messages.slice(-10);
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'User' : 'AI';
      const msgText = msg.text || msg.content || '';
      const text = msgText.length > 200 ? msgText.slice(0, 200) + '...' : msgText;
      parts.push(`${role}: ${text}`);
    }
    parts.push('');
  }

  parts.push('── INSTRUCTIONS ──');
  parts.push('Work in the folder the user selected. Create files, write code, build what they need.');
  parts.push('Be direct and action-oriented. Start working immediately.');

  return parts.join('\n');
}

/**
 * Build Gemini context from local AI transcript
 *
 * Takes: raw terminal transcript from local session
 * Returns: context injection string for Gemini's next response
 */
export function buildGeminiContextFromTranscript(transcript: string): string {
  if (!transcript || transcript.length < 50) {
    return '';
  }

  // Truncate very long transcripts (keep first and last parts)
  let processedTranscript = transcript;
  if (transcript.length > 8000) {
    const firstPart = transcript.slice(0, 4000);
    const lastPart = transcript.slice(-4000);
    processedTranscript = `${firstPart}\n\n[... middle of session truncated ...]\n\n${lastPart}`;
  }

  return `═══ LOCAL AI SESSION CONTEXT ═══
The user was working with a local AI (Claude Code) on their machine.
Here is a summary of what was created/discussed in that session:

${processedTranscript}

═══ END LOCAL SESSION ═══

The user has now switched back to you (Gemini) for creative tools.
Use the context above to understand what was built, and generate
images/videos/content that matches what was created locally.`;
}

/**
 * Extract key outputs from a transcript (for quick context)
 * Looks for file creation, code patterns, and key decisions
 */
export function extractKeyOutputs(transcript: string): string[] {
  const outputs: string[] = [];
  const lines = transcript.split('\n');

  for (const line of lines) {
    // File creation
    if (line.match(/created?|wrote|generated|saved/i) && line.match(/\.\w{2,4}/)) {
      outputs.push(line.trim());
    }
    // Decisions/conclusions
    if (line.match(/^(done|finished|completed|ready|result)/i)) {
      outputs.push(line.trim());
    }
  }

  return outputs.slice(0, 20); // Max 20 key outputs
}
