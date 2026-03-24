import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBrain } from '../../context/BrainContext';
import { Send, Bot, User, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { generateImage } from '../../services/geminiService';
import { ModelType } from '../../types';

interface Message {
    role: 'user' | 'model' | 'system';
    content: string;
    timestamp: number;
    attachments?: string[];
}

interface Props {
    brandName: string;
    onCalendarRequest: (theme: string, postCount: number) => void;
}

export const BrandCampaignChat: React.FC<Props> = ({ brandName, onCalendarRequest }) => {
    const { user } = useAuth();
    const { dirHandle, isConnected, projectTag, setProjectTag, saveAssetToBrain } = useBrain();
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isThinking, setIsThinking] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Sync BrainContext to brand if not already synced
    useEffect(() => {
        if (projectTag !== brandName && brandName) {
            setProjectTag(brandName);
        }
    }, [brandName, projectTag, setProjectTag]);

    // Load Chat History from OPFS (Shared with AgentChat)
    useEffect(() => {
        const loadHistory = async () => {
            if (!dirHandle || !isConnected || !brandName) return;
            try {
                const projectDir = await dirHandle.getDirectoryHandle(brandName, { create: true });
                const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });
                const fileHandle = await memoryDir.getFileHandle('chat_history.json', { create: true });
                const file = await fileHandle.getFile();
                const text = await file.text();

                if (text) {
                    const parsed = JSON.parse(text);
                    setMessages(parsed);
                } else {
                    // Initial Greeting for Campaign specifically
                    setMessages([{
                        role: 'model',
                        content: `Hey! I'm your top-league Social Media Manager. I'm taking over campaigns for **${brandName}**. To make our content go viral, I need to know the 'soul' of this brand. What kind of energy are we bringing? (Playful? Authoritative? Gen-Z?) and what's your preferred language?`,
                        timestamp: Date.now()
                    }]);
                }
            } catch (err) {
                console.error("Failed to load chat history:", err);
            }
        };

        loadHistory();
    }, [dirHandle, isConnected, brandName]);

    // Save Chat History to OPFS (with Compression Rule)
    const saveAndCompressHistory = async (newMessages: Message[]) => {
        setMessages(newMessages); // Update UI immediately

        if (!dirHandle || !isConnected || !brandName) return;
        try {
            const projectDir = await dirHandle.getDirectoryHandle(brandName, { create: true });
            const memoryDir = await projectDir.getDirectoryHandle('memory', { create: true });

            let finalMessagesToSave = [...newMessages];
            if (newMessages.length >= 25) {
                console.log("Memory Compactor Triggered: Compressing 25 messages...");
                const messagesToSummarize = newMessages.slice(0, newMessages.length - 5);
                const keptMessages = newMessages.slice(newMessages.length - 5);

                const summaryPrompt = `
Summarize the following conversation history into a dense, bulleted "Context Core". Focus ONLY on established preferences, the brand's 'soul', and campaign details.
History to compress:
${messagesToSummarize.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n')}
`;
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
                        setMessages(finalMessagesToSave);
                    }
                }
            }

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
            const tools = [
                {
                    functionDeclarations: [
                        {
                            name: "generate_concept_images",
                            description: "Generates 2 concept images for a campaign before building the calendar and auto-saves them. ALWAYS use this to show concepts to the user.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    prompt: {
                                        type: "STRING",
                                        description: "A highly detailed, visually descriptive prompt for the concept images."
                                    }
                                },
                                required: ["prompt"]
                            }
                        },
                        {
                            name: "build_campaign_calendar",
                            description: "Triggers the creation of a 30-day content calendar grid. Use this ONLY after the user explicitly approves a campaign idea or image concept.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    theme: {
                                        type: "STRING",
                                        description: "The core theme or title of the approved campaign."
                                    },
                                    postCount: {
                                        type: "INTEGER",
                                        description: "The number of posts to schedule. Default to 30."
                                    }
                                },
                                required: ["theme", "postCount"]
                            }
                        }
                    ]
                }
            ];

            const conversationContext = updatedMessages.map(m => `${m.role === 'model' ? 'model' : 'user'}: ${m.content}`).join('\n\n');
            const systemInstructions = `You are an elite, top-league social media manager for the brand ${brandName}. You are playful, highly intelligent, and proactive.
You are running within Gods Eye Studio, a supreme AI workspace. 
Your goal is to learn the brand's 'soul' and automatically plan stunning campaigns.
IMPORTANT INSTRUCTIONS:
1. Always ask questions to dig deeper into the brand's true identity ("soul") until you are confident. Let the user guide the tone.
2. NEVER generate a calendar blindly. If asked to make a campaign, ALWAYS call the 'generate_concept_images' tool first to show them 2 visual concepts. Ask them if they like the vibe.
3. If they approve the vibe/concept, call the 'build_campaign_calendar' tool.
4. Keep answers concise, witty, and extremely professional.`;

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

            for (const part of parts) {
                if (part.functionCall) {
                    functionCall = part.functionCall;
                } else if (part.text) {
                    textResponse += part.text;
                }
            }

            if (functionCall && functionCall.name === 'generate_concept_images') {
                const args = functionCall.args;
                textResponse = `I'm whipping up some incredibly visual concepts for: "${args.prompt}". Hang tight, let's see if you love this vibe...`;

                generateImage({
                    prompt: args.prompt,
                    model: ModelType.NANO_BANANA_PRO, // Mapped to gemini-3-pro-image-preview
                    quality: '1K',
                    aspectRatio: '1:1',
                    batchSize: 2, // Generate 2 concepts
                    userId: user?.id || 'anonymous'
                }).then(async (urls) => {
                    if (urls && urls.length > 0) {
                        for (const url of urls) {
                            await saveAssetToBrain(url, args.prompt);
                        }
                        const confirmMsg: Message = {
                            role: 'model',
                            content: "Here are the raw concepts! Do these visual directions align with the campaign's soul? Like these, or should we twist the style?",
                            timestamp: Date.now(),
                            attachments: urls
                        };
                        saveAndCompressHistory([...updatedMessages, { role: 'model', content: textResponse, timestamp: Date.now() }, confirmMsg]);
                    }
                }).catch(e => console.error("Agent failed to generate concepts:", e));
            } else if (functionCall && functionCall.name === 'build_campaign_calendar') {
                const args = functionCall.args;
                textResponse = `Brilliant. I'm taking that approved DNA and mapping out a killer ${args.postCount}-post calendar for the "${args.theme}" campaign right now. Check the Calendar tab!`;

                // Add message to chat before triggering parent callback
                await saveAndCompressHistory([...updatedMessages, { role: 'model', content: textResponse, timestamp: Date.now() }]);

                // Trigger parent component to actually build out the grid
                onCalendarRequest(args.theme, args.postCount || 30);
            } else {
                if (!textResponse && !functionCall) {
                    textResponse = "Hmm, let me think about that.";
                }
                const modelMsg: Message = { role: 'model', content: textResponse, timestamp: Date.now() };
                await saveAndCompressHistory([...updatedMessages, modelMsg]);
            }

        } catch (error) {
            console.error(error);
            const errorMsg: Message = { role: 'model', content: "My connection to the mainframe flickered. Can you repeat that?", timestamp: Date.now() };
            await saveAndCompressHistory([...updatedMessages, errorMsg]);
        } finally {
            setIsThinking(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-panel/60 backdrop-blur-xl border-l border-white/5">
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-white/5 bg-panel/60 backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand text-bg rounded-xl flex items-center justify-center shadow-lg shadow-brand/20">
                        <Wand2 size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-base text-text-primary tracking-tight">Campaign Strategist</h3>
                        <p className="text-xs text-brand font-mono flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-brand animate-pulse inline-block" />
                            {brandName} · Top-League Creative AI
                        </p>
                    </div>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 scrollbar-hide">
                <div className="max-w-3xl mx-auto w-full space-y-6">
                    {messages.map((msg, i) => (
                        msg.role === 'system' ? (
                            <div key={i} className="flex justify-center">
                                <span className="px-3 py-1 bg-brand/10 text-brand border border-brand/20 rounded-full text-[10px] font-mono uppercase font-bold max-w-[80%] line-clamp-1">
                                    Memory Synced
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
                                    {msg.attachments && msg.attachments.length > 0 && (
                                        <div className="flex gap-3 flex-wrap">
                                            {msg.attachments.map((url, j) => (
                                                <div key={j} className="relative group cursor-pointer">
                                                    <img src={url} alt="Concept" className="w-40 h-40 object-cover rounded-xl border-2 border-brand/20 shadow-lg hover:border-brand/40 transition-all" />
                                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl backdrop-blur-[2px]">
                                                        <span className="text-white text-xs font-bold font-mono tracking-widest uppercase bg-brand/90 px-3 py-1.5 rounded-full shadow-xl">Concept {j + 1}</span>
                                                    </div>
                                                </div>
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
                            <span className="text-xs text-brand font-mono uppercase tracking-widest animate-pulse">Strategizing…</span>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input Area */}
            <div className="flex-shrink-0 border-t border-white/5 bg-panel/60 backdrop-blur-xl px-4 md:px-8 py-4">
                <div className="max-w-3xl mx-auto relative flex items-end gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="E.g. Let's do a Summer Launch campaign..."
                        className="flex-1 bg-panel/60 backdrop-blur-xl border border-white/5 rounded-full px-5 py-3.5 pr-14 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-brand/30 focus:ring-1 focus:ring-brand/20 transition-all"
                    />
                    <button
                        onClick={handleSend}
                        disabled={!input.trim() || isThinking}
                        className="absolute right-3 bottom-2.5 p-2.5 bg-brand text-bg rounded-full disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 transition-all shadow-lg shadow-brand/20 hover:shadow-brand/30"
                    >
                        <Send size={16} />
                    </button>
                </div>
                <p className="max-w-3xl mx-auto text-[10px] text-text-secondary/40 mt-2 px-1">Enter to send</p>
            </div>
        </div>
    );
};
