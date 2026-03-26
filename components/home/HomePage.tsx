import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBrain } from '../../context/BrainContext';
import { buildContextBrief, buildGeminiContextFromTranscript } from '../../services/bridgeSkill';
import { ConversationSidebar } from './ConversationSidebar';
import { ChatArea } from './ChatArea';
import {
  createConversation,
  listConversations,
  deleteConversation,
  updateConversation,
  addMessage,
  getMessages,
  type Conversation,
  type ChatMessage,
  type ChatAttachment,
  type ToolCallRecord,
  type SearchResultEntry,
} from '../../services/conversationService';
import { sendMessage as orchestratorSend } from '../../services/chatOrchestrator';
import { getAllBrandProfiles } from '../../services/brandService';
import type { BrandProfile } from '../../types/brand.types';
import { listSkills, getSkillBySlug } from '../../services/skillsService';
import type { SkillOption } from './ChatInput';
import type { ChatModelId } from './ChatInput';
import type { AppMode } from '../../types';

interface Props {
  onNavigate: (mode: AppMode) => void;
}

export const HomePage: React.FC<Props> = ({ onNavigate }) => {
  const { user, profile } = useAuth();
  const brain = useBrain();
  const userId = user?.id || 'anon';

  // Brand context for chat
  const [brands, setBrands] = useState<BrandProfile[]>([]);
  const [activeBrandId, setActiveBrandId] = useState<string | null>(() =>
    localStorage.getItem(`klint_active_brand_${userId}`) || null
  );

  // Skills for slash commands
  const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
  const [activeSkillContent, setActiveSkillContent] = useState<string | null>(null);
  const activeBrand = brands.find(b => b.id === activeBrandId) || null;

  useEffect(() => {
    if (userId !== 'anon') {
      getAllBrandProfiles(userId).then(setBrands).catch(() => {});
      listSkills(userId).then(skills => {
        // Deduplicate by slug
        const seen = new Set<string>();
        const unique = skills.filter(s => s.enabled).filter(s => {
          if (seen.has(s.slug)) return false;
          seen.add(s.slug);
          return true;
        });
        setSkillOptions(unique.map(s => ({
          slug: s.slug, name: s.name, icon: s.icon, is_agent: s.is_agent,
        })));
      }).catch(() => {});
    }
  }, [userId]);

  // Get personality from profile or localStorage fallback
  const getUserPersonality = () => {
    if (profile?.personality) return profile.personality;
    try {
      const stored = localStorage.getItem(`godseye_personality_${userId}`);
      return stored ? JSON.parse(stored) : undefined;
    } catch { return undefined; }
  };

  // State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Streaming state
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallRecord[]>([]);
  const [streamingAttachments, setStreamingAttachments] = useState<ChatAttachment[]>([]);
  const [streamingSearchResults, setStreamingSearchResults] = useState<SearchResultEntry[]>([]);

  // Model selection
  const [selectedModel, setSelectedModel] = useState<ChatModelId>('gemini-3-flash-preview');
  // Handle model change
  const handleModelChange = useCallback(async (modelId: ChatModelId) => {
    setSelectedModel(modelId);
  }, []);

  // File upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);

  const handleFileUpload = () => fileInputRef.current?.click();

  const handleFilesSelected = (files: FileList) => {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setAttachedImages(prev => [...prev, e.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveAttachment = (index: number) => {
    setAttachedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [userId]);

  const loadConversations = async () => {
    const convs = await listConversations(userId);
    setConversations(convs);
  };

  const loadMessages = async (convId: string) => {
    const msgs = await getMessages(convId);
    setMessages(msgs);
  };

  // Select conversation
  const handleSelectConversation = async (id: string) => {
    setActiveConvId(id);
    await loadMessages(id);
  };

  // New conversation
  const handleNewConversation = async () => {
    setActiveConvId(null);
    setMessages([]);
    setInputValue('');
  };

  // Delete conversation
  const handleDeleteConversation = async (id: string) => {
    await deleteConversation(id);
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    await loadConversations();
  };

  // Rename conversation
  const handleRenameConversation = async (id: string, title: string) => {
    await updateConversation(id, { title });
    await loadConversations();
  };

  // Auto-generate title from first message
  const autoTitle = async (convId: string, userText: string) => {
    try {
      const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `Generate a concise 4-6 word title for this conversation. Reply with ONLY the title, no quotes:\n\n"${userText.slice(0, 200)}"` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 20 },
        }),
      });
      const data = await res.json();
      const title = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (title) {
        await updateConversation(convId, { title });
        await loadConversations();
      }
    } catch { /* title gen failure is non-fatal */ }
  };

  // Send message
  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;

    setInputValue('');
    setIsLoading(true);
    setStreamingText(null);
    setStreamingToolCalls([]);
    setStreamingAttachments([]);
    setStreamingSearchResults([]);

    try {
      // Create or get conversation
      let convId = activeConvId;
      if (!convId) {
        const conv = await createConversation(userId, 'New conversation');
        convId = conv.id;
        setActiveConvId(convId);
        await loadConversations();
      }

      // Add user message (include attached images if any)
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        conversationId: convId,
        role: 'user',
        content: text,
        timestamp: Date.now(),
        imageDataUrls: attachedImages.length > 0 ? [...attachedImages] : undefined,
      };
      await addMessage(userMsg);
      setAttachedImages([]); // Clear attachments after sending
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      // Auto-title on first message
      if (updatedMessages.filter(m => m.role === 'user').length === 1) {
        autoTitle(convId, text);
      }

      // Collect streaming state for final message
      let finalText = '';
      const collectedToolCalls: ToolCallRecord[] = [];
      const collectedAttachments: ChatAttachment[] = [];
      const collectedSearchResults: SearchResultEntry[] = [];

      // Send to orchestrator
      const activeConv = conversations.find(c => c.id === convId);
      // Build brand context string
      const brandCtx = activeBrand ? [
        `Brand: ${activeBrand.name}`,
        activeBrand.tagline ? `Tagline: ${activeBrand.tagline}` : '',
        activeBrand.industry ? `Industry: ${activeBrand.industry}` : '',
        activeBrand.audience ? `Audience: ${activeBrand.audience}` : '',
        activeBrand.tone?.length ? `Tone: ${activeBrand.tone.join(', ')}` : '',
        activeBrand.visual_style ? `Visual Style: ${activeBrand.visual_style}` : '',
        activeBrand.colors?.length ? `Colors: ${activeBrand.colors.join(', ')}` : '',
        activeBrand.keywords?.length ? `Keywords: ${activeBrand.keywords.join(', ')}` : '',
        activeBrand.products?.length ? `Products: ${activeBrand.products.map(p => p.name).join(', ')}` : '',
      ].filter(Boolean).join('\n') : undefined;

      await orchestratorSend(updatedMessages, {
        userId,
        model: selectedModel,
        personality: getUserPersonality(),
        skillOverride: activeSkillContent || undefined,
        conversationId: convId || undefined,
        conversationTitle: activeConv?.title || undefined,
        brandContext: brandCtx,
        onChunk: (accumulated) => {
          setStreamingText(accumulated);
          finalText = accumulated;
        },
        onToolCall: (tc) => {
          collectedToolCalls.push(tc);
          setStreamingToolCalls([...collectedToolCalls]);
        },
        onToolResult: (name, result) => {
          const tc = collectedToolCalls.find(t => t.name === name && t.status === 'running');
          if (tc) {
            tc.status = result?.error ? 'error' : 'success';
            tc.result = result;
            setStreamingToolCalls([...collectedToolCalls]);
          }
        },
        onAttachment: (att) => {
          collectedAttachments.push(att);
          setStreamingAttachments([...collectedAttachments]);
        },
        onSearchResults: (results) => {
          collectedSearchResults.push(...results);
          setStreamingSearchResults([...collectedSearchResults]);
        },
        onComplete: async (fullText) => {
          // Save model response as message
          const modelMsg: ChatMessage = {
            id: crypto.randomUUID(),
            conversationId: convId!,
            role: 'model',
            content: fullText,
            timestamp: Date.now(),
            toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
            attachments: collectedAttachments.length > 0 ? collectedAttachments : undefined,
            searchResults: collectedSearchResults.length > 0 ? collectedSearchResults : undefined,
          };
          await addMessage(modelMsg);
          setMessages(prev => [...prev, modelMsg]);

          // Clear streaming state
          setStreamingText(null);
          setStreamingToolCalls([]);
          setStreamingAttachments([]);
          setStreamingSearchResults([]);
          setIsLoading(false);
          await loadConversations();
        },
        onError: (error) => {
          console.error('[Gods Eye] Chat error:', error);
          // Save error as model message
          const errorMsg: ChatMessage = {
            id: crypto.randomUUID(),
            conversationId: convId!,
            role: 'model',
            content: `Something went wrong: ${error.message}. Please try again.`,
            timestamp: Date.now(),
          };
          addMessage(errorMsg).then(() => {
            setMessages(prev => [...prev, errorMsg]);
          });
          setStreamingText(null);
          setStreamingToolCalls([]);
          setStreamingAttachments([]);
          setStreamingSearchResults([]);
          setIsLoading(false);
        },
        getRAGContext: async (prompt, topK) => {
          if (brain?.getRAGContext) {
            return brain.getRAGContext(prompt, topK);
          }
          return '';
        },
        searchBrain: async (query, topK) => {
          if (brain?.searchBrain) {
            return brain.searchBrain(query, topK);
          }
          return [];
        },
        onNavigate: (mode) => {
          onNavigate(mode as any);
        },
      });
    } catch (err: any) {
      console.error('[Gods Eye] Send error:', err);
      setIsLoading(false);
      setStreamingText(null);
      setStreamingToolCalls([]);
      setStreamingAttachments([]);
      setStreamingSearchResults([]);
    }
  }, [inputValue, isLoading, activeConvId, userId, messages, brain, onNavigate]);

  // Suggestion chip click
  const handleSuggestionClick = (text: string) => {
    setInputValue(text);
    // Auto-send after a brief moment so user sees it
    setTimeout(() => {
      setInputValue(text);
      // We need to trigger send manually since inputValue won't be updated yet in the callback
      const sendWithText = async () => {
        setInputValue('');
        setIsLoading(true);
        setStreamingText(null);
        setStreamingToolCalls([]);
        setStreamingAttachments([]);
        setStreamingSearchResults([]);

        const conv = await createConversation(userId, 'New conversation');
        setActiveConvId(conv.id);
        await loadConversations();

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          conversationId: conv.id,
          role: 'user',
          content: text,
          timestamp: Date.now(),
        };
        await addMessage(userMsg);
        setMessages([userMsg]);
        autoTitle(conv.id, text);

        let finalText = '';
        const collectedToolCalls: ToolCallRecord[] = [];
        const collectedAttachments: ChatAttachment[] = [];
        const collectedSearchResults: SearchResultEntry[] = [];

        // Build brand context for new conversation
        const newConvBrandCtx = activeBrand ? [
          `Brand: ${activeBrand.name}`,
          activeBrand.tagline ? `Tagline: ${activeBrand.tagline}` : '',
          activeBrand.industry ? `Industry: ${activeBrand.industry}` : '',
          activeBrand.audience ? `Audience: ${activeBrand.audience}` : '',
          activeBrand.tone?.length ? `Tone: ${activeBrand.tone.join(', ')}` : '',
          activeBrand.visual_style ? `Visual Style: ${activeBrand.visual_style}` : '',
          activeBrand.colors?.length ? `Colors: ${activeBrand.colors.join(', ')}` : '',
          activeBrand.products?.length ? `Products: ${activeBrand.products.map(p => p.name).join(', ')}` : '',
        ].filter(Boolean).join('\n') : undefined;

        await orchestratorSend([userMsg], {
          userId,
          model: selectedModel,
          personality: getUserPersonality(),
          skillOverride: activeSkillContent || undefined,
          conversationId: conv.id,
          conversationTitle: conv.title || undefined,
          brandContext: newConvBrandCtx,
          onChunk: (acc) => { setStreamingText(acc); finalText = acc; },
          onToolCall: (tc) => { collectedToolCalls.push(tc); setStreamingToolCalls([...collectedToolCalls]); },
          onToolResult: (name, result) => {
            const tc = collectedToolCalls.find(t => t.name === name && t.status === 'running');
            if (tc) { tc.status = result?.error ? 'error' : 'success'; tc.result = result; setStreamingToolCalls([...collectedToolCalls]); }
          },
          onAttachment: (att) => { collectedAttachments.push(att); setStreamingAttachments([...collectedAttachments]); },
          onSearchResults: (results) => { collectedSearchResults.push(...results); setStreamingSearchResults([...collectedSearchResults]); },
          onComplete: async (fullText) => {
            const modelMsg: ChatMessage = { id: crypto.randomUUID(), conversationId: conv.id, role: 'model', content: fullText, timestamp: Date.now(), toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined, attachments: collectedAttachments.length > 0 ? collectedAttachments : undefined, searchResults: collectedSearchResults.length > 0 ? collectedSearchResults : undefined };
            await addMessage(modelMsg);
            setMessages(prev => [...prev, modelMsg]);
            setStreamingText(null); setStreamingToolCalls([]); setStreamingAttachments([]); setStreamingSearchResults([]); setIsLoading(false);
            await loadConversations();
          },
          onError: (error) => { console.error('[Gods Eye]', error); setIsLoading(false); setStreamingText(null); setStreamingToolCalls([]); setStreamingAttachments([]); setStreamingSearchResults([]); },
          getRAGContext: async (prompt, topK) => brain?.getRAGContext ? brain.getRAGContext(prompt, topK) : '',
          searchBrain: async (query, topK) => brain?.searchBrain ? brain.searchBrain(query, topK) : [],
          onNavigate: (mode) => onNavigate(mode as any),
        });
      };
      sendWithText();
    }, 100);
  };

  const userName = profile?.full_name || user?.user_metadata?.full_name || user?.email;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-20 left-4 z-30 lg:hidden p-2 rounded-xl bg-panel border border-border-base shadow-lg"
      >
        <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar */}
      <ConversationSidebar
        conversations={conversations}
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        onRename={handleRenameConversation}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        userName={userName}
        onNavigate={(mode) => onNavigate(mode as any)}
        skillsCount={skillOptions.length}
      />

      {/* Main chat area */}
      <ChatArea
        messages={messages}
        streamingText={streamingText}
        streamingToolCalls={streamingToolCalls}
        streamingAttachments={streamingAttachments}
        streamingSearchResults={streamingSearchResults}
        inputValue={inputValue}
        onInputChange={setInputValue}
        onSend={handleSend}
        onSuggestionClick={handleSuggestionClick}
        isLoading={isLoading}
        userName={userName}
        hasConversation={activeConvId !== null}
        onFileUpload={handleFileUpload}
        fileInputRef={fileInputRef as any}
        onFilesSelected={handleFilesSelected}
        attachedImages={attachedImages}
        onRemoveAttachment={handleRemoveAttachment}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
        brands={brands}
        activeBrandId={activeBrandId}
        onBrandChange={(id) => {
          setActiveBrandId(id);
          if (id) localStorage.setItem(`klint_active_brand_${userId}`, id);
          else localStorage.removeItem(`klint_active_brand_${userId}`);
        }}
        skills={skillOptions}
        onSkillSelect={async (slug) => {
          const skill = await getSkillBySlug(userId, slug);
          if (skill) {
            setActiveSkillContent(skill.content);
            setInputValue(`[Using ${skill.name}] `);
          }
        }}
      />
    </div>
  );
};
