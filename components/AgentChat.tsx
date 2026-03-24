import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useBrain } from '../context/BrainContext';
import { MessageSquare, Send, Bot, User, X, Loader2, Sparkles, Maximize2, Minimize2, GripVertical } from 'lucide-react';
import { generateImage } from '../services/geminiService';
import { ModelType } from '../types';

interface Message {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    attachments?: string[];
}

interface Position { x: number; y: number; }

const STORAGE_KEY = 'agentchat-pos';

const clampPos = (x: number, y: number, w: number, h: number): Position => ({
    x: Math.max(0, Math.min(window.innerWidth - w, x)),
    y: Math.max(0, Math.min(window.innerHeight - 60, y)),
});

const loadSavedPos = (w: number, h: number): Position => {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const p = JSON.parse(saved) as Position;
            if (typeof p.x === 'number' && typeof p.y === 'number') {
                return clampPos(p.x, p.y, w, h);
            }
        }
    } catch {}
    // Default: bottom-left, away from Generate button (bottom-right)
    return { x: 24, y: Math.max(24, window.innerHeight - 650) };
};

export const AgentChat: React.FC = () => {
    const { user } = useAuth();
    const { dirHandle, isConnected, currentProjectTag, saveAssetToBrain } = useBrain();
    const [isOpen, setIsOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // ── Draggable — pointer-capture approach (smooth, no stale closure) ────
    const containerRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const [pos, setPos] = useState<Position>({ x: 24, y: 100 }); // safe default; updated on mount
    const dragData = useRef<{ startMX: number; startMY: number; startEX: number; startEY: number } | null>(null);
    const buttonDragData = useRef<{ startMX: number; startMY: number; startEX: number; startEY: number; didDrag: boolean } | null>(null);

    // Initialise position after mount (needs window.innerHeight)
    useEffect(() => {
        const w = isExpanded ? 620 : 390;
        setPos(loadSavedPos(w, isOpen ? 620 : 56));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const savePos = useCallback((p: Position) => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
    }, []);

    // Header pointer-down → start drag with pointer capture
    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest('button')) return;
        if (e.button !== 0) return; // left mouse only
        const el = containerRef.current;
        if (!el) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        dragData.current = { startMX: e.clientX, startMY: e.clientY, startEX: rect.left, startEY: rect.top };
        el.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragData.current) return;
        const el = containerRef.current;
        if (!el) return;
        const dx = e.clientX - dragData.current.startMX;
        const dy = e.clientY - dragData.current.startMY;
        const clamped = clampPos(dragData.current.startEX + dx, dragData.current.startEY + dy, el.offsetWidth, el.offsetHeight);
        // Direct DOM manipulation — zero React re-renders during drag
        el.style.left = `${clamped.x}px`;
        el.style.top = `${clamped.y}px`;
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!dragData.current) return;
        const el = containerRef.current;
        if (!el) return;
        el.releasePointerCapture(e.pointerId);
        dragData.current = null;
        const rect = el.getBoundingClientRect();
        const newPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
        setPos(newPos);
        savePos(newPos);
    };

    // Closed-button drag handlers (tap = open, drag = move)
    const onButtonPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        const el = buttonRef.current;
        if (!el) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        buttonDragData.current = { startMX: e.clientX, startMY: e.clientY, startEX: rect.left, startEY: rect.top, didDrag: false };
        el.setPointerCapture(e.pointerId);
    };

    const onButtonPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!buttonDragData.current) return;
        const el = buttonRef.current;
        if (!el) return;
        const dx = e.clientX - buttonDragData.current.startMX;
        const dy = e.clientY - buttonDragData.current.startMY;
        if (!buttonDragData.current.didDrag && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        buttonDragData.current.didDrag = true;
        const clamped = clampPos(buttonDragData.current.startEX + dx, buttonDragData.current.startEY + dy, el.offsetWidth, el.offsetHeight);
        el.style.left = `${clamped.x}px`;
        el.style.top = `${clamped.y}px`;
    };

    const onButtonPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
        if (!buttonDragData.current) return;
        const el = buttonRef.current;
        if (!el) return;
        el.releasePointerCapture(e.pointerId);
        const wasDrag = buttonDragData.current.didDrag;
        buttonDragData.current = null;
        if (wasDrag) {
            const rect = el.getBoundingClientRect();
            const newPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
            setPos(newPos);
            savePos(newPos);
        } else {
            setIsOpen(true);
        }
    };

    // Load Chat History from OPFS
    useEffect(() => {
        const loadHistory = async () => {
            if (!dirHandle || !isConnected) return;
            try {
                const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: true });
                const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });
                const fileHandle = await memoryDir.getFileHandle('chat_history.json', { create: true });
                const file = await fileHandle.getFile();
                const text = await file.text();

                if (text) {
                    const parsed = JSON.parse(text);
                    setMessages(parsed);
                } else {
                    // Initial Greeting
                    setMessages([{
                        role: 'model',
                        content: `Hi there! I'm your local Gods Eye Agent. I'm connected to your "${currentProjectTag}" project files. I can chat, generate images, or summarize documents. How can I help you today?`,
                        timestamp: Date.now()
                    }]);
                }
            } catch (err) {
                console.error("Failed to load chat history:", err);
            }
        };

        if (isOpen) {
            loadHistory();
        }
    }, [dirHandle, isConnected, currentProjectTag, isOpen]);

    // Save Chat History to OPFS (with Compression Rule)
    const saveAndCompressHistory = async (newMessages: Message[]) => {
        setMessages(newMessages); // Update UI immediately

        if (!dirHandle || !isConnected) return;
        try {
            const projectDir = await dirHandle.getDirectoryHandle(currentProjectTag, { create: true });
            const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });

            // The "25-Message Compression Rule"
            let finalMessagesToSave = [...newMessages];
            if (newMessages.length >= 25) {
                console.log("Memory Compactor Triggered: Compressing 25 messages...");

                // Get the last 20 messages to summarize (keep the absolute last 5 for immediate context)
                const messagesToSummarize = newMessages.slice(0, newMessages.length - 5);
                const keptMessages = newMessages.slice(newMessages.length - 5);

                const summaryPrompt = `
Summarize the following conversation history into a dense, bulleted "Context Core". 
Focus ONLY on facts learned, established preferences, active project details, and key decisions. 
Omit pleasantries.

History to compress:
${messagesToSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n')}
`;

                // Call background summarizer
                const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: summaryPrompt }] }],
                        generationConfig: { temperature: 0.1 }
                    })
                });

                if (res.ok) {
                    const data = await res.json();
                    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;

                    if (summary) {
                        finalMessagesToSave = [
                            { role: 'system', content: `[COMPRESSED OPFS MEMORY NODE]:\n${summary}`, timestamp: Date.now() },
                            ...keptMessages
                        ];
                        console.log("Memory successfully compacted!");
                        // Update UI with compacted array
                        setMessages(finalMessagesToSave);
                    }
                }
            }

            // Save to disk
            const fileHandle = await memoryDir.getFileHandle('chat_history.json', { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(finalMessagesToSave, null, 2));
            await writable.close();

        } catch (err) {
            console.error("Failed to save chat history to OPFS:", err);
        }
    };

    // Auto-scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isThinking]);

    const handleSend = async () => {
        if (!input.trim() || isThinking) return;

        const userMsg: Message = { role: 'user', content: input.trim(), timestamp: Date.now() };
        const updatedMessages = [...messages, userMsg];
        setInput('');
        setIsThinking(true);

        try {
            // Function Calling Definitions
            const tools = [
                {
                    functionDeclarations: [
                        {
                            name: "generate_image",
                            description: "Generates an image and automatically saves it to the user's local disk.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    prompt: {
                                        type: "STRING",
                                        description: "A highly detailed, visually descriptive prompt for the image generator."
                                    }
                                },
                                required: ["prompt"]
                            }
                        }
                    ]
                }
            ];

            // Build pure string conversation for Gemini (Filter out attachments for now)
            const conversationContext = updatedMessages.map(m => `${m.role === 'model' ? 'model' : 'user'}: ${m.content}`).join('\n\n');
            const systemInstructions = `You are the Gods Eye Studio OS Agent. You run directly on the user's laptop.
You have tools available to you. If the user asks for an image, DO NOT describe it, just call generate_image.
If you call generate_image, immediately answer the user by telling them you are generating it and adding it to their local folder.
Keep answers concise, confident, and professional.`;

            const fullPrompt = `System: ${systemInstructions}\n\n${conversationContext}\n\nmodel:`;

            const res = await fetch('/api/gemini/models/gemini-2.5-flash:generateContent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    tools: tools,
                    toolConfig: { functionCallingConfig: { mode: "AUTO" } }
                })
            });

            if (!res.ok) throw new Error("Agent disconnected.");

            const data = await res.json();
            const candidate = data.candidates?.[0];
            const parts = candidate?.content?.parts || [];

            let functionCall = null;
            let textResponse = "";

            // Check for Function Calls
            for (const part of parts) {
                if (part.functionCall) {
                    functionCall = part.functionCall;
                } else if (part.text) {
                    textResponse += part.text;
                }
            }

            // Execute Function Call if exists
            if (functionCall && functionCall.name === 'generate_image') {
                const args = functionCall.args;
                textResponse = `I am generating an image based on your request: "${args.prompt}". I'll save it to your local ${currentProjectTag} folder instantly.`;

                // Fire and forget image generator (AI takes action!)
                generateImage({
                    prompt: args.prompt,
                    model: ModelType.NANO_BANANA_PRO, // Using the valid GEMINI-3-PRO mapped enum
                    quality: '1K',
                    aspectRatio: '1:1',
                    userId: user?.id || 'anonymous'
                }).then(async (urls) => {
                    if (urls && urls[0]) {
                        await saveAssetToBrain(urls[0], args.prompt);
                        const confirmMsg: Message = {
                            role: 'model',
                            content: "✅ Image successfully generated and saved directly to your local OPFS /assets folder!",
                            timestamp: Date.now(),
                            attachments: [urls[0]]
                        };
                        saveAndCompressHistory([...updatedMessages, { role: 'model', content: textResponse, timestamp: Date.now() }, confirmMsg]);
                    }
                }).catch(e => console.error("Agent failed to generate:", e));
            }

            // Normal Text Response
            if (!textResponse && !functionCall) {
                textResponse = "I'm processing that, but didn't know exactly what to say.";
            }

            const modelMsg: Message = { role: 'model', content: textResponse, timestamp: Date.now() };
            await saveAndCompressHistory([...updatedMessages, modelMsg]);

        } catch (error) {
            console.error(error);
            const errorMsg: Message = { role: 'model', content: "Sorry, my neural link dropped. Can you try again?", timestamp: Date.now() };
            await saveAndCompressHistory([...updatedMessages, errorMsg]);
        } finally {
            setIsThinking(false);
        }
    };

    if (!isOpen) {
        return (
            <button
                ref={buttonRef}
                onPointerDown={onButtonPointerDown}
                onPointerMove={onButtonPointerMove}
                onPointerUp={onButtonPointerUp}
                style={{ left: pos.x, top: pos.y }}
                className="fixed w-14 h-14 bg-brand text-bg rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-all z-50 group touch-none select-none cursor-grab active:cursor-grabbing"
            >
                <Bot size={28} />
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-bg animate-pulse" />
                <div className="absolute left-16 px-3 py-1.5 bg-panel text-text-primary text-sm font-bold rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-border">
                    OpenClaw Agent
                </div>
            </button>
        );
    }

    return (
        <div
            ref={containerRef}
            style={{ left: pos.x, top: pos.y }}
            className={`fixed bg-panel border-2 border-brand/20 shadow-2xl rounded-2xl flex flex-col overflow-hidden transition-[width,height] duration-300 z-50 ${isExpanded ? 'w-[600px] h-[80vh]' : 'w-[390px] h-[620px]'}`}
        >
            {/* Header — drag handle via pointer capture */}
            <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className="flex items-center justify-between p-4 border-b border-border bg-black/40 backdrop-blur-md cursor-grab active:cursor-grabbing select-none touch-none"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand text-bg rounded-full flex items-center justify-center shadow-lg">
                        <Bot size={22} />
                    </div>
                    <div>
                        <h3 className="font-bold text-base text-white">AgentOS</h3>
                        <p className="text-xs text-brand font-mono flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
                            Connected to /{currentProjectTag}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <GripVertical size={16} className="text-text-secondary/40 mr-1" />
                    <button onClick={() => setIsExpanded(!isExpanded)} className="p-2 text-text-secondary hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                        {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                    </button>
                    <button onClick={() => setIsOpen(false)} className="p-2 text-text-secondary hover:text-white rounded-lg hover:bg-white/10 transition-colors">
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
                {messages.map((msg, i) => (
                    msg.role === 'system' ? (
                        <div key={i} className="flex justify-center my-4">
                            <span className="px-3 py-1 bg-brand/10 text-brand border border-brand/20 rounded-full text-[10px] font-mono uppercase font-bold text-center max-w-[80%] line-clamp-1 hover:line-clamp-none transition-all cursor-crosshair">
                                {msg.content}
                            </span>
                        </div>
                    ) : (
                        <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-surface border border-border' : 'bg-brand text-bg'}`}>
                                {msg.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                            </div>
                            <div className={`flex flex-col gap-2 max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-surface text-white border border-border rounded-tr-sm' : 'bg-brand/10 text-brand-light border border-brand/20 rounded-tl-sm'}`}>
                                    {msg.content}
                                </div>
                                {msg.attachments && msg.attachments.length > 0 && (
                                    <div className="flex gap-2 flex-wrap">
                                        {msg.attachments.map((url, j) => (
                                            <img key={j} src={url} alt="Agent Attachment" className="w-32 h-32 object-cover rounded-xl border-2 border-brand/20 shadow-lg" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                ))}

                {isThinking && (
                    <div className="flex gap-3 items-center">
                        <div className="w-8 h-8 rounded-full bg-brand/20 text-brand flex items-center justify-center animate-pulse">
                            <Loader2 size={16} className="animate-spin" />
                        </div>
                        <span className="text-xs text-brand font-mono uppercase tracking-widest animate-pulse">Running OS Cycle...</span>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 border-t border-border bg-black/40 backdrop-blur-md">
                <div className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Talk to OS... Try 'Generate a shoe'"
                        className="w-full bg-surface border border-border rounded-xl px-4 py-3.5 pr-14 text-sm text-white focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/50 transition-all shadow-inner"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="absolute right-2 p-2 bg-brand text-bg rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-md"
                    >
                        <Send size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
