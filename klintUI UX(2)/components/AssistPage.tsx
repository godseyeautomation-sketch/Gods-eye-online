
import React, { useState, useRef, useEffect } from 'react';
import { 
  Sparkles, 
  Camera, 
  Box, 
  Share2, 
  ShoppingBag, 
  Upload, 
  Type, 
  ArrowRight, 
  Building2, 
  Trees, 
  Sofa, 
  Palette, 
  ChevronLeft
} from 'lucide-react';

// --- TYPES & DATA ---

type Step = 'init' | 'subject' | 'items' | 'scene' | 'style' | 'camera' | 'lighting' | 'output' | 'generating';

interface AssistState {
  goal: string;
  subjectType: 'upload' | 'describe' | null;
  uploadedSubject?: File | null;
  uploadedItems?: File | null;
  sceneType: string;
  sceneProps: string;
  envEffects: string;
  hairStyle: string;
  makeupStyle: string;
  itemStyling: string;
  shotType: string;
  cameraAngle: string;
  focalLength: string;
  lightingType: string;
  lightDirection: string;
  aspectRatio: string;
  numImages: number;
  quality: string;
  instructions: string;
}

const INITIAL_STATE: AssistState = {
  goal: '',
  subjectType: null,
  sceneType: '',
  sceneProps: '',
  envEffects: '',
  hairStyle: '',
  makeupStyle: '',
  itemStyling: '',
  shotType: '',
  cameraAngle: '',
  focalLength: '50mm (Standard)',
  lightingType: '',
  lightDirection: '',
  aspectRatio: 'Portrait (4:5)',
  numImages: 1,
  quality: 'Standard',
  instructions: ''
};

// --- COMPONENTS ---

const ChatBubble: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex gap-4 animate-fade-in w-full">
        <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center flex-shrink-0 mt-2">
            <Sparkles size={14} className="text-brand" />
        </div>
        <div className="bg-surface border border-border-base rounded-2xl rounded-tl-sm px-6 py-4 text-text-primary text-sm leading-relaxed shadow-lg max-w-xl">
            {children}
        </div>
    </div>
);

const OptionCard: React.FC<{ 
    icon?: React.ReactNode; 
    title: string; 
    description?: string; 
    selected?: boolean; 
    onClick: () => void 
}> = ({ icon, title, description, selected, onClick }) => (
    <button 
        onClick={onClick}
        className={`group text-left p-4 rounded-xl border transition-all duration-200 flex flex-col gap-3 h-full
            ${selected 
                ? 'bg-brand/10 border-brand ring-1 ring-brand' 
                : 'bg-surface border-border-base hover:border-text-secondary hover:bg-black/5 dark:hover:bg-white/5'
            }
        `}
    >
        {icon && (
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${selected ? 'bg-brand text-bg' : 'bg-black/5 dark:bg-white/10 text-text-secondary group-hover:text-text-primary'}`}>
                {icon}
            </div>
        )}
        <div>
            <div className={`font-medium text-sm mb-1 ${selected ? 'text-text-primary' : 'text-text-primary'}`}>{title}</div>
            {description && <div className="text-[10px] text-text-secondary leading-tight">{description}</div>}
        </div>
    </button>
);

const InputField: React.FC<{
    label: string;
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    icon?: React.ReactNode;
}> = ({ label, value, onChange, placeholder, icon }) => (
    <div className="space-y-1.5">
        <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
            {icon} {label}
        </label>
        <input 
            type="text" 
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full bg-surface border border-border-base rounded-lg px-3 py-2.5 text-sm text-text-primary focus:border-brand outline-none transition-colors placeholder-neutral-500"
        />
    </div>
);

const SelectableChip: React.FC<{ label: string; selected: boolean; onClick: () => void }> = ({ label, selected, onClick }) => (
    <button
        onClick={onClick}
        className={`px-4 py-2.5 rounded-lg text-xs font-medium border transition-all text-center
            ${selected
                ? 'bg-brand border-brand text-bg shadow-md'
                : 'bg-surface border-border-base text-text-secondary hover:border-text-secondary hover:text-text-primary'
            }
        `}
    >
        {label}
    </button>
);


export const AssistPage: React.FC = () => {
  const [step, setStep] = useState<Step>('init');
  const [data, setData] = useState<AssistState>(INITIAL_STATE);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flow: Step[] = ['init', 'subject', 'items', 'scene', 'style', 'camera', 'lighting', 'output', 'generating'];

  useEffect(() => {
      if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
  }, [step]);

  const updateData = (key: keyof AssistState, value: any) => {
      setData(prev => ({ ...prev, [key]: value }));
  };

  const handleNext = () => {
      const currentIndex = flow.indexOf(step);
      if (currentIndex < flow.length - 1) {
          setStep(flow[currentIndex + 1]);
      }
  };

  const handleBack = () => {
      const currentIndex = flow.indexOf(step);
      if (currentIndex > 0) {
          setStep(flow[currentIndex - 1]);
      }
  };

  const handleSkip = () => {
      handleNext();
  };

  const renderContent = () => {
      switch (step) {
        case 'init':
            return (
                <div className="space-y-6 animate-fade-in w-full">
                    <ChatBubble>
                        <p className="font-medium mb-1">Welcome to the studio. I'm Chason, your Design AGI.</p>
                        <p className="text-neutral-500">What would you like to create today?</p>
                    </ChatBubble>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                        <OptionCard icon={<Camera size={18}/>} title="Virtual Photoshoot" description="Get your custom model photoshoot done" onClick={() => { updateData('goal', 'Virtual Photoshoot'); handleNext(); }} />
                        <OptionCard icon={<Box size={18}/>} title="Stage an Object" description="Get your custom product photoshoot done" onClick={() => { updateData('goal', 'Stage an Object'); handleNext(); }} />
                        <OptionCard icon={<Share2 size={18}/>} title="Social Media Graphics" description="Create engaging posts & stories" onClick={() => { updateData('goal', 'Social Media'); handleNext(); }} />
                        <OptionCard icon={<ShoppingBag size={18}/>} title="Product Mockups" description="Place your designs on real products" onClick={() => { updateData('goal', 'Product Mockups'); handleNext(); }} />
                    </div>
                </div>
            );
        case 'subject':
            return (
                <div className="space-y-6 animate-fade-in w-full">
                    <div className="text-xs text-text-secondary uppercase tracking-widest font-bold mb-8">Design AGI • Person</div>
                    <ChatBubble>Great choice. Now, who is the subject of this photoshoot?</ChatBubble>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                        <OptionCard icon={<Upload size={18}/>} title="Upload Model" selected={data.subjectType === 'upload'} onClick={() => { updateData('subjectType', 'upload'); }} />
                        <OptionCard icon={<Type size={18}/>} title="Describe Model" selected={data.subjectType === 'describe'} onClick={() => { updateData('subjectType', 'describe'); }} />
                    </div>
                    {data.subjectType === 'upload' && (
                         <div className="w-full bg-surface border border-dashed border-border-base rounded-xl p-8 flex flex-col items-center justify-center text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:border-brand transition-colors cursor-pointer">
                            <Upload size={24} className="mb-2 opacity-50"/>
                            <span className="text-sm">Click to upload photo of subject</span>
                         </div>
                    )}
                    {data.subjectType === 'describe' && (
                         <div className="w-full">
                            <InputField label="Description" value={data.instructions} onChange={(v) => updateData('instructions', v)} placeholder="E.g., A 25-year-old woman with curly red hair..." />
                         </div>
                    )}
                    <div className="flex justify-between items-center w-full pt-4">
                         <button onClick={handleBack} className="text-text-secondary hover:text-text-primary text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"><ChevronLeft size={16}/> Back</button>
                         <button onClick={handleNext} className="bg-brand hover:bg-brand-hover text-bg font-bold py-2.5 px-6 rounded-lg text-sm flex items-center gap-2 transition-colors">Next Step <ArrowRight size={16}/></button>
                    </div>
                </div>
            );
         case 'items':
             return (
                 <div className="space-y-6 animate-fade-in w-full">
                    <div className="text-xs text-text-secondary uppercase tracking-widest font-bold mb-8">Design AGI • Items</div>
                    <ChatBubble>Please upload the apparel and accessories you want your model to wear.</ChatBubble>
                    <div className="max-w-md">
                        <div className="bg-surface border border-dashed border-border-base rounded-xl h-48 flex flex-col items-center justify-center text-text-secondary hover:bg-black/5 dark:hover:bg-white/5 hover:border-brand transition-colors cursor-pointer group">
                            <div className="w-12 h-12 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                <Upload size={20} className="text-text-secondary"/>
                            </div>
                            <span className="text-sm font-medium text-text-primary mb-1">Add Item</span>
                        </div>
                    </div>
                    <div className="flex justify-between items-center w-full pt-4">
                         <button onClick={handleBack} className="text-text-secondary hover:text-text-primary text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"><ChevronLeft size={16}/> Back</button>
                         <button onClick={handleNext} className="bg-brand hover:bg-brand-hover text-bg font-bold py-2.5 px-6 rounded-lg text-sm flex items-center gap-2 transition-colors">Next Step <ArrowRight size={16}/></button>
                    </div>
                 </div>
             );
         case 'scene':
            return (
                 <div className="space-y-6 animate-fade-in w-full">
                    <div className="text-xs text-text-secondary uppercase tracking-widest font-bold mb-8">Design AGI • Scene</div>
                    <ChatBubble>Let's set the scene. Where should this take place?</ChatBubble>
                    <div className="space-y-4 w-full">
                        <div className="text-xs font-medium text-text-secondary mb-2">Background</div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                             {[{ id: 'Studio', icon: <Box size={16}/> }, { id: 'Urban', icon: <Building2 size={16}/> }, { id: 'Nature', icon: <Trees size={16}/> }, { id: 'Interior', icon: <Sofa size={16}/> }, { id: 'Custom', icon: <Palette size={16}/> }].map(opt => (
                                 <OptionCard key={opt.id} icon={opt.icon} title={opt.id} selected={data.sceneType === opt.id} onClick={() => updateData('sceneType', opt.id)} />
                             ))}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                             <InputField label="Scene Props" value={data.sceneProps} onChange={(v) => updateData('sceneProps', v)} placeholder="e.g., holding a coffee cup" />
                             <InputField label="Environmental Effects" value={data.envEffects} onChange={(v) => updateData('envEffects', v)} placeholder="e.g., fog, rain" />
                        </div>
                    </div>
                    <div className="flex justify-between items-center w-full pt-4">
                         <button onClick={handleBack} className="text-text-secondary hover:text-text-primary text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-2"><ChevronLeft size={16}/> Back</button>
                         <div className="flex gap-3">
                            <button onClick={handleSkip} className="px-6 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary transition-colors border border-transparent hover:border-border-base">Skip</button>
                            <button onClick={handleNext} className="bg-brand hover:bg-brand-hover text-bg font-bold py-2.5 px-6 rounded-lg text-sm flex items-center gap-2 transition-colors">Next Step <ArrowRight size={16}/></button>
                         </div>
                    </div>
                 </div>
            );
         case 'style': return (<div className="space-y-6 animate-fade-in w-full"><ChatBubble>How should it be styled?</ChatBubble><InputField label="Hair Style" value={data.hairStyle} onChange={v => updateData('hairStyle', v)} placeholder="e.g. ponytail"/><div className="flex justify-between pt-4"><button onClick={handleBack} className="text-text-secondary flex gap-1 items-center"><ChevronLeft size={16}/> Back</button><button onClick={handleNext} className="bg-brand text-bg font-bold px-6 py-2 rounded-lg hover:bg-brand-hover">Next</button></div></div>);
         case 'camera': return (<div className="space-y-6 animate-fade-in w-full"><ChatBubble>Camera specs?</ChatBubble><div className="grid grid-cols-2 gap-3">{['Eye Level', 'Low Angle'].map(t => <SelectableChip key={t} label={t} selected={data.cameraAngle === t} onClick={() => updateData('cameraAngle', t)}/>)}</div><div className="flex justify-between pt-4"><button onClick={handleBack} className="text-text-secondary flex gap-1 items-center"><ChevronLeft size={16}/> Back</button><button onClick={handleNext} className="bg-brand text-bg font-bold px-6 py-2 rounded-lg hover:bg-brand-hover">Next</button></div></div>);
         case 'lighting': return (<div className="space-y-6 animate-fade-in w-full"><ChatBubble>Lighting?</ChatBubble><div className="grid grid-cols-2 gap-3">{['Soft', 'Cinematic'].map(t => <SelectableChip key={t} label={t} selected={data.lightingType === t} onClick={() => updateData('lightingType', t)}/>)}</div><div className="flex justify-between pt-4"><button onClick={handleBack} className="text-text-secondary flex gap-1 items-center"><ChevronLeft size={16}/> Back</button><button onClick={handleNext} className="bg-brand text-bg font-bold px-6 py-2 rounded-lg hover:bg-brand-hover">Next</button></div></div>);
         case 'output': return (<div className="space-y-6 animate-fade-in w-full"><ChatBubble>Final details.</ChatBubble><div className="flex justify-between pt-4"><button onClick={handleBack} className="text-text-secondary flex gap-1 items-center"><ChevronLeft size={16}/> Back</button><button onClick={() => setStep('generating')} className="bg-brand hover:bg-brand-hover text-bg font-bold px-6 py-2 rounded-lg flex items-center gap-2 shadow-lg"><Sparkles size={16}/> Generate</button></div></div>);
         case 'generating': return (<div className="flex flex-col items-center justify-center py-20"><div className="w-16 h-16 border-4 border-brand rounded-full border-t-transparent animate-spin mb-4"></div><h2 className="text-xl font-bold">Generating...</h2></div>);
         default: return null;
      }
  };

  return (
    <div className="w-full min-h-screen flex justify-center pt-8 pb-32 text-text-primary">
        {/* Floating "Stage" for Assist */}
        <div className="w-full max-w-2xl bg-panel border border-border-base rounded-3xl p-8 shadow-2xl relative overflow-hidden" ref={scrollRef}>
             <div className="absolute inset-0 bg-grid-pattern opacity-5 pointer-events-none"></div>
             
             {/* Header Identity */}
            <div className="mb-8 flex items-center gap-3 relative z-10">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand to-brand-hover flex items-center justify-center text-bg font-bold shadow-lg shadow-brand/20">
                    C
                </div>
                <div>
                    <h1 className="text-lg font-bold text-text-primary">Chason</h1>
                    <div className="text-xs text-text-secondary">Design AGI • {step === 'init' ? 'Goal' : step.charAt(0).toUpperCase() + step.slice(1)}</div>
                </div>
            </div>

            <div className="relative z-10">
                {renderContent()}
            </div>
        </div>
    </div>
  );
};
