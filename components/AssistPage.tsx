
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBrain } from '../context/BrainContext';
import { MessageSquare, Send, Bot, User, X, Loader2, Sparkles, Maximize2, Minimize2 } from 'lucide-react';
import { generateImage } from '../services/geminiService';
import { ModelType } from '../types';

interface Message {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    attachments?: string[];
}

export const AssistPage: React.FC = () => {
    const { user } = useAuth();
    const { dirHandle, isConnected, currentProjectTag, saveAssetToBrain } = useBrain();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Load Chat History from OPFS
    useEffect(() => {
        const loadHistory = async () => {
            if (!dirHandle || !isConnected) {
                setMessages([{
                    role: 'model',
                    content: `Hi! I'm your Gods Eye Agentic AI. Connect your Local Brain to unlock memory & file access — or just start chatting. I can generate images, answer questions, and help with your creative projects.`,
                    timestamp: Date.now()
                }]);
                return;
            }
            try {
                const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: true });
                const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });
                const fileHandle = await memoryDir.getFileHandle('chat_history.json', { create: true });
                const file = await fileHandle.getFile();
                const text = await file.text();
                if (text) {
                    setMessages(JSON.parse(text));
                } else {
                    setMessages([{
                        role: 'model',
                        content: `Hi there! I'm your local Gods Eye Agent. I'm connected to your "${currentProjectTag}" project. I can chat, generate images, or summarize documents. How can I help?`,
                        timestamp: Date.now()
                    }]);
                }
            } catch (err) {
                console.error("Failed to load chat history:", err);
            }
        };
        loadHistory();
    }, [dirHandle, isConnected, currentProjectTag]);

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    const saveAndCompressHistory = async (newMessages: Message[]) => {
        setMessages(newMessages);
        if (!dirHandle || !isConnected) return;
        try {
            const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: true });
            const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });

            let finalMessages = [...newMessages];
            if (newMessages.length >= 25) {
                const toSummarize = newMessages.slice(0, newMessages.length - 5);
                const kept = newMessages.slice(newMessages.length - 5);
                const summaryPrompt = `Summarize the following conversation into a dense bulleted "Context Core". Focus only on facts, preferences, and decisions.\n\n${toSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n')}`;
                const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: [{ parts: [{ text: summaryPrompt }] }], generationConfig: { temperature: 0.1 } })
                });
                if (res.ok) {
                    const data = await res.json();
                    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (summary) {
                        finalMessages = [{ role: 'system', content: `[COMPRESSED MEMORY]:\n${summary}`, timestamp: Date.now() }, ...kept];
                        setMessages(finalMessages);
                    }
                }
            }

            const fileHandle = await memoryDir.getFileHandle('chat_history.json', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(finalMessages, null, 2));
            await writable.close();
        } catch (err) {
            console.error("Failed to save chat history:", err);
        }
    };

    const handleSend = async () => {
        if (!input.trim() || isThinking) return;

        const userMsg: Message = { role: 'user', content: input.trim(), timestamp: Date.now() };
        const updatedMessages = [...messages, userMsg];
        setInput('');
        setIsThinking(true);

        try {
            const tools = [{
                functionDeclarations: [{
                    name: "generate_image",
                    description: "Generates an image and saves it to the user's local disk.",
                    parameters: {
                        type: "OBJECT",
                        properties: { prompt: { type: "STRING", description: "A highly detailed, descriptive prompt for the image generator." } },
                        required: ["prompt"]
                    }
                }]
            }];

            const conversationContext = updatedMessages.map(m => `${m.role === 'model' ? 'model' : 'user'}: ${m.content}`).join('\n\n');
            const systemInstructions = `You are the Gods Eye Studio Agentic AI. You run directly on the user's device. You have tools. If the user asks for an image, call generate_image immediately — do NOT describe it first. Keep answers concise and professional.`;
            const fullPrompt = `System: ${systemInstructions}\n\n${conversationContext}\n\nmodel:`;

            const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], tools, toolConfig: { functionCallingConfig: { mode: "AUTO" } } })
            });

            if (!res.ok) throw new Error("Agent disconnected.");

            const data = await res.json();
            const parts = data.candidates?.[0]?.content?.parts || [];
            let functionCall = null;
            let textResponse = "";

            for (const part of parts) {
                if (part.functionCall) functionCall = part.functionCall;
                else if (part.text) textResponse += part.text;
            }

            if (functionCall?.name === 'generate_image') {
                const args = functionCall.args;
                textResponse = `Generating: "${args.prompt}" — saving to your ${currentProjectTag} folder.`;
                generateImage({
                    prompt: args.prompt,
                    model: ModelType.NANO_BANANA_PRO,
                    quality: '1K',
                    aspectRatio: '1:1',
                    userId: user?.id || 'anonymous'
                }).then(async (urls) => {
                    if (urls?.[0]) {
                        await saveAssetToBrain(urls[0], args.prompt);
                        const confirmMsg: Message = { role: 'model', content: "✅ Image generated and saved to your local assets folder!", timestamp: Date.now(), attachments: [urls[0]] };
                        saveAndCompressHistory([...updatedMessages, { role: 'model', content: textResponse, timestamp: Date.now() }, confirmMsg]);
                    }
                }).catch(e => console.error("Agent image gen failed:", e));
            }

            if (!textResponse && !functionCall) textResponse = "I didn't catch that. Could you rephrase?";

            await saveAndCompressHistory([...updatedMessages, { role: 'model', content: textResponse, timestamp: Date.now() }]);
        } catch (error) {
            console.error(error);
            await saveAndCompressHistory([...updatedMessages, { role: 'model', content: "Sorry, my connection dropped. Try again.", timestamp: Date.now() }]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="w-full h-full flex flex-col pt-16" style={{ height: '100vh' }}>
            {/* Header */}
            <div className="flex-shrink-0 flex items-center gap-4 px-6 py-4 border-b border-white/5 bg-panel/60 backdrop-blur-xl">
                <div className="w-10 h-10 bg-brand text-bg rounded-xl flex items-center justify-center shadow-lg">
                    <Bot size={22} />
                </div>
                <div>
                    <h2 className="font-bold text-base text-text-primary">Agentic AI</h2>
                    <p className="text-xs text-brand font-mono flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-brand animate-pulse inline-block" />
                        {isConnected ? `Connected · /${currentProjectTag}` : 'Ready · Connect Brain for memory'}
                    </p>
                </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scrollbar-hide">
                <div className="max-w-3xl mx-auto w-full space-y-6">
                    {messages.map((msg, i) => (
                        msg.role === 'system' ? (
                            <div key={i} className="flex justify-center">
                                <span className="px-3 py-1 bg-brand/10 text-brand border border-brand/20 rounded-full text-[10px] font-mono uppercase font-bold max-w-[80%] line-clamp-1">
                                    {msg.content}
                                </span>
                            </div>
                        ) : (
                            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-surface/60 border border-white/10' : 'bg-brand text-bg shadow-lg shadow-brand/20'}`}>
                                    {msg.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                                </div>
                                <div className={`flex flex-col gap-2 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-surface/60 backdrop-blur-md text-white border border-white/5 rounded-tr-sm' : 'bg-brand/5 backdrop-blur-md text-brand-light border border-brand/10 rounded-tl-sm'}`}>
                                        {msg.content}
                                    </div>
                                    {msg.attachments?.map((url, j) => (
                                        <img key={j} src={url} alt="Generated" className="w-48 h-48 object-cover rounded-xl border-2 border-brand/20 shadow-lg" />
                                    ))}
                                </div>
                            </div>
                        )
                    ))}

                    {isThinking && (
                        <div className="flex gap-3 items-center">
                            <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center animate-pulse">
                                <Loader2 size={16} className="animate-spin" />
                            </div>
                            <span className="text-xs text-brand font-mono uppercase tracking-widest animate-pulse">Processing…</span>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t border-white/5 bg-panel/60 backdrop-blur-xl px-4 md:px-8 py-4">
                <div className="max-w-3xl mx-auto relative flex items-end gap-3">
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                        placeholder='Ask anything, or say "generate a product photo of…"'
                        rows={1}
                        className="flex-1 bg-panel/60 backdrop-blur-xl border border-white/5 rounded-full px-5 py-3.5 pr-14 text-sm text-text-primary focus:outline-none focus:border-brand/30 focus:ring-1 focus:ring-brand/20 transition-all resize-none leading-relaxed"
                        style={{ maxHeight: '120px', overflowY: 'auto' }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="absolute right-3 bottom-3 p-2.5 bg-brand text-bg rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand/20 hover:shadow-brand/30"
                    >
                        <Send size={16} />
                    </button>
                </div>
                <p className="max-w-3xl mx-auto text-[10px] text-text-secondary/40 mt-2 px-1">Enter to send · Shift+Enter for new line</p>
            </div>
        </div>
    );
};
