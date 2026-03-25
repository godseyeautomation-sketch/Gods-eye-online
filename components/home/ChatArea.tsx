import React, { useRef, useEffect } from 'react';
import type { ChatMessage } from '../../services/conversationService';
import type { BrandProfile } from '../../types/brand.types';
import { MessageBubble } from './MessageBubble';
import { ChatInput, type ChatModelId, type SkillOption, type BrandOption } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';

interface Props {
  messages: ChatMessage[];
  streamingText: string | null;
  streamingToolCalls: any[];
  streamingAttachments: any[];
  streamingSearchResults: any[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onSuggestionClick: (text: string) => void;
  isLoading: boolean;
  userName?: string;
  hasConversation: boolean;
  onFileUpload?: () => void;
  fileInputRef?: React.RefObject<HTMLInputElement>;
  onFilesSelected?: (files: FileList) => void;
  attachedImages?: string[];
  onRemoveAttachment?: (index: number) => void;
  selectedModel?: ChatModelId;
  onModelChange?: (model: ChatModelId) => void;
  brands?: BrandProfile[];
  activeBrandId?: string | null;
  onBrandChange?: (id: string | null) => void;
  skills?: SkillOption[];
  onSkillSelect?: (slug: string) => void;
  bridgeStatus?: 'disconnected' | 'connecting' | 'ready' | 'running' | 'error' | 'starting' | 'stopped';
  onBridgeConnect?: () => void;
}

export const ChatArea: React.FC<Props> = ({
  messages,
  streamingText,
  streamingToolCalls,
  streamingAttachments,
  streamingSearchResults,
  inputValue,
  onInputChange,
  onSend,
  onSuggestionClick,
  isLoading,
  userName,
  hasConversation,
  onFileUpload,
  fileInputRef,
  onFilesSelected,
  attachedImages = [],
  onRemoveAttachment,
  selectedModel,
  onModelChange,
  brands = [],
  activeBrandId,
  onBrandChange,
  skills = [],
  onSkillSelect,
  bridgeStatus,
  onBridgeConnect,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, streamingToolCalls.length, streamingAttachments.length]);

  if (!hasConversation) {
    return (
      <WelcomeScreen
        onSuggestionClick={onSuggestionClick}
        userName={userName}
        inputValue={inputValue}
        onInputChange={onInputChange}
        onSend={onSend}
        onFileUpload={onFileUpload}
        isLoading={isLoading}
        fileInputRef={fileInputRef}
        onFilesSelected={onFilesSelected}
        attachedImages={attachedImages}
        onRemoveAttachment={onRemoveAttachment}
        brands={brands}
        activeBrandId={activeBrandId}
        onBrandChange={onBrandChange}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 pt-32 pb-4" data-chat-messages>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* Streaming */}
          {(streamingText !== null || streamingToolCalls.length > 0 || streamingAttachments.length > 0 || isLoading) && (
            <div className="mb-5">
              <div className="max-w-full pl-1">
                {streamingToolCalls.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {streamingToolCalls.map((tc: any, i: number) => (
                      <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm transition-all ${
                        tc.status === 'running' ? 'border-brand/30 bg-brand/5' :
                        tc.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
                        'border-border-base bg-surface/50'
                      }`}>
                        <span className="text-base flex-shrink-0">
                          {tc.name === 'generate_image' ? '✦' : tc.name === 'generate_video' ? '▶' :
                           tc.name === 'scan_brand_website' ? '◎' : tc.name === 'search_web' ? '◈' : '⬡'}
                        </span>
                        <span className="text-text-primary font-medium">
                          {tc.name.replace(/_/g, ' ')}
                          {tc.status === 'running' && <span className="ml-2 text-brand animate-pulse">...</span>}
                          {tc.status === 'success' && <span className="ml-2 text-green-500">done</span>}
                          {tc.status === 'error' && <span className="ml-2 text-red-400">failed</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {streamingAttachments.length > 0 && (
                  <div className={`grid gap-2 mb-3 ${streamingAttachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1 max-w-md'}`}>
                    {streamingAttachments.map((att: any, i: number) => (
                      att.type === 'image' ? (
                        <img key={i} src={att.url} alt="" className="rounded-xl w-full border border-border-base" />
                      ) : att.type === 'video' ? (
                        <video key={i} src={att.url} controls className="rounded-xl w-full border border-border-base" />
                      ) : null
                    ))}
                  </div>
                )}

                {streamingText !== null && streamingText.length > 0 ? (
                  <p className="text-[15px] text-text-primary/90 leading-[1.7] whitespace-pre-wrap">{streamingText}</p>
                ) : streamingToolCalls.length === 0 && isLoading ? (
                  <div className="flex items-center gap-1.5 py-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce" />
                    <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:0.15s]" />
                    <div className="w-1.5 h-1.5 rounded-full bg-brand animate-bounce [animation-delay:0.3s]" />
                  </div>
                ) : null}

                {streamingSearchResults.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-[10px] text-text-secondary/50 font-medium uppercase tracking-widest">Sources</p>
                    {streamingSearchResults.map((sr: any, i: number) => (
                      <a key={i} href={sr.url} target="_blank" rel="noopener noreferrer"
                        className="block px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-xs text-brand truncate">
                        {sr.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <ChatInput
        value={inputValue}
        onChange={onInputChange}
        onSend={onSend}
        onFileUpload={onFileUpload}
        disabled={isLoading}
        attachedImages={attachedImages}
        onRemoveAttachment={onRemoveAttachment}
        fileInputRef={fileInputRef}
        onFilesSelected={onFilesSelected}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        skills={skills}
        onSkillSelect={onSkillSelect}
        brands={brands.map(b => ({ id: b.id || '', name: b.name || 'Unnamed' }))}
        selectedBrand={activeBrandId}
        onBrandChange={onBrandChange}
        bridgeStatus={bridgeStatus}
        onBridgeConnect={onBridgeConnect}
      />
    </div>
  );
};
