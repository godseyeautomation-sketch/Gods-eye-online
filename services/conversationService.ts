/**
 * Conversation Service
 * IndexedDB CRUD for persistent chat conversations and messages.
 */

import { openDB } from 'idb';

const DB_NAME = 'klint-studio-db';

// ── Types ────────────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  isArchived: boolean;
}

export interface ChatAttachment {
  type: 'image' | 'video' | 'file';
  url: string;
  prompt?: string;
  model?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, any>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: any;
}

export interface SearchResultEntry {
  title: string;
  url: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
  toolCalls?: ToolCallRecord[];
  searchResults?: SearchResultEntry[];
  imageDataUrls?: string[]; // User-attached images (base64 data URLs) sent to Gemini for understanding
}

// ── DB Helper ────────────────────────────────────────────────────────────────

async function getDB() {
  return openDB(DB_NAME);
}

// ── Conversations CRUD ───────────────────────────────────────────────────────

export async function createConversation(userId: string, title?: string): Promise<Conversation> {
  const db = await getDB();
  const now = Date.now();
  const conv: Conversation = {
    id: crypto.randomUUID(),
    userId,
    title: title || 'New conversation',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    preview: '',
    isArchived: false,
  };
  await db.put('conversations', conv);
  return conv;
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function listConversations(userId: string): Promise<Conversation[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('conversations', 'userId', userId);
  return all.sort((a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt);
}

export async function updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
  const db = await getDB();
  const conv = await db.get('conversations', id);
  if (!conv) return;
  Object.assign(conv, patch, { updatedAt: Date.now() });
  await db.put('conversations', conv);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('conversations', id);
  // Delete all messages in conversation
  const messages = await getMessages(id);
  const tx = db.transaction('chat_messages', 'readwrite');
  for (const msg of messages) {
    await tx.store.delete(msg.id);
  }
  await tx.done;
}

// ── Messages CRUD ────────────────────────────────────────────────────────────

export async function addMessage(msg: ChatMessage): Promise<ChatMessage> {
  const db = await getDB();
  await db.put('chat_messages', msg);

  // Update conversation metadata
  const conv = await db.get('conversations', msg.conversationId);
  if (conv) {
    conv.updatedAt = msg.timestamp;
    conv.messageCount = (conv.messageCount || 0) + 1;
    if (msg.role === 'user') {
      conv.preview = msg.content.slice(0, 100);
    }
    await db.put('conversations', conv);
  }

  return msg;
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('chat_messages', 'conversationId', conversationId);
  return all.sort((a: ChatMessage, b: ChatMessage) => a.timestamp - b.timestamp);
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
  const db = await getDB();
  const msg = await db.get('chat_messages', id);
  if (!msg) return;
  Object.assign(msg, patch);
  await db.put('chat_messages', msg);
}

export async function getMessageCount(conversationId: string): Promise<number> {
  const db = await getDB();
  const all = await db.getAllFromIndex('chat_messages', 'conversationId', conversationId);
  return all.length;
}
