
import React, { useState, useRef, useEffect } from 'react';
import { AppMode } from '../types';
import { Waves, Sun, Moon, Command, UserCircle2, Bell, Menu, ShieldCheck, Settings, CreditCard, LogOut, Layout, Lock } from 'lucide-react';

interface HeaderProps {
    currentMode: AppMode;
    setMode: (mode: AppMode) => void;
    theme: 'light' | 'dark';
    toggleTheme: () => void;
    isAdmin: boolean;
}

import { useAuth } from '../context/AuthContext';

export const Header: React.FC<HeaderProps> = ({ currentMode, setMode, theme, toggleTheme, isAdmin }) => {
    const { user, signOut, profile } = useAuth();
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const profileRef = useRef<HTMLDivElement>(null);

    interface NavItem {
        id: AppMode | string;
        label: string;
        badge?: string;
    }

    // Brand tab consolidated INTO the Agents tab (item #2). Brand remains
    // a routable mode for deep-links / legacy chats, but the top nav surfaces
    // a single entry: "Agents" — which is now the home for brand profile,
    // calendar, agent runners, approvals, and activity (one-stop UX).
    const navItems: NavItem[] = [
        { id: AppMode.EXPLORE, label: 'Home' },
        { id: AppMode.IMAGE, label: 'Image' },
        { id: AppMode.VIDEO, label: 'Video' },
        { id: AppMode.EDIT, label: 'Edit' },
        { id: AppMode.CHARACTER, label: 'Character' },
        { id: AppMode.SPACES, label: 'Spaces', badge: 'NEW' },
        { id: AppMode.AUTOPILOT, label: 'Agents', badge: 'NEW' },
        { id: AppMode.ADMIN, label: 'Admin' }, // Only visible to admins
        { id: AppMode.APPS, label: 'Apps', badge: 'NEW' },
        { id: AppMode.CONNECTORS, label: 'Connectors' },
    ];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
                setIsProfileOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <>
            {/* Desktop: Soft gradient fade-out behind the floating islands.
                Lets page content (e.g. a zoomed-in image in the Edit tab) fade
                into darkness before it reaches the header area, so the glass
                islands never clash with bright imagery. */}
            <div
                aria-hidden="true"
                className="hidden lg:block fixed top-0 left-0 right-0 h-32 z-40 pointer-events-none bg-gradient-to-b from-black via-black/60 to-transparent"
            />

            {/* Desktop: Modular Floating Islands */}
            <div className="hidden lg:flex fixed top-0 left-0 right-0 z-50 p-6 justify-between items-start pointer-events-none">

                {/* Module 1: Branding */}
                <div
                    onClick={() => setMode(AppMode.EXPLORE)}
                    className="pointer-events-auto bg-panel backdrop-blur-2xl backdrop-saturate-150 border border-border-base rounded-full pl-2 pr-6 py-2 flex items-center gap-3 shadow-lg shadow-black/5 hover:shadow-xl hover:shadow-brand/5 transition-all cursor-pointer group"
                >
                    <div className="w-10 h-10 bg-brand rounded-full flex items-center justify-center text-bg shadow-inner group-hover:scale-105 transition-transform">
                        <Waves size={20} strokeWidth={3} />
                    </div>
                    <div className="flex flex-col">
                        <span className="font-bold text-sm tracking-tight leading-none text-text-primary">Gods Eye</span>
                        <span className="text-[10px] text-text-secondary font-mono tracking-widest uppercase">Studio v2.1</span>
                    </div>
                </div>

                {/* Module 2: Navigation Pill */}
                <nav className="pointer-events-auto absolute inset-x-0 top-6 flex justify-center z-50 pointer-events-none">
                    <div className="bg-panel backdrop-blur-2xl backdrop-saturate-150 border border-border-base rounded-full p-1.5 flex items-center gap-1 shadow-lg shadow-black/5 pointer-events-auto">
                        {navItems
                            .filter(item => item.id !== AppMode.ADMIN || isAdmin) // Only show Admin for admins
                            .map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => {
                                        setMode(item.id as AppMode);
                                    }}
                                    className={`relative px-5 py-2.5 rounded-full text-xs font-bold transition-all duration-300 flex items-center gap-2 overflow-hidden ${currentMode === item.id
                                        ? 'text-bg shadow-md'
                                        : 'text-neutral-300 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    {/* Active Background Animation */}
                                    {currentMode === item.id && (
                                        <div className="absolute inset-0 bg-brand w-full h-full -z-10 animate-fade-in" />
                                    )}

                                    {item.label}

                                    {item.badge && (
                                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-wide leading-none ${currentMode === item.id ? 'bg-bg text-brand' : 'bg-brand text-bg'}`}>
                                            {item.badge}
                                        </span>
                                    )}
                                </button>
                            ))}
                    </div>
                </nav>

                {/* Module 3: System Status */}
                <div className="pointer-events-auto bg-panel backdrop-blur-2xl backdrop-saturate-150 border border-border-base rounded-full p-2 flex items-center gap-2 shadow-lg shadow-black/5 relative z-50" ref={profileRef}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleTheme();
                        }}
                        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-surface text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
                    >
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>

                    <div className="w-px h-4 bg-border-base"></div>

                    <button className="h-10 px-4 rounded-full bg-surface/50 hover:bg-surface border border-transparent hover:border-border-base text-xs font-bold text-text-primary flex items-center gap-2 transition-all group">
                        <Command size={14} className="text-text-secondary group-hover:text-brand" />
                        <span className="hidden xl:inline">Credits:</span>
                        <span className="font-mono">{isAdmin ? 'Unlimited' : (profile?.credits || 0)}</span>
                    </button>

                    <div className="relative">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setMode('PROFILE' as AppMode);
                                setIsProfileOpen(!isProfileOpen);
                            }}
                            className="w-10 h-10 rounded-full overflow-hidden border border-border-base hover:border-brand transition-colors relative group cursor-pointer"
                        >
                            <img src={user?.user_metadata?.avatar_url || "https://picsum.photos/100/100?random=avatar"} alt="User" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-brand/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            {isAdmin && <div className="absolute -top-1 -right-1 w-3 h-3 bg-brand rounded-full border-2 border-[#030303]"></div>}
                        </button>

                        {/* Dropdown Menu */}
                        {isProfileOpen && (
                            <div className="absolute top-full right-0 mt-3 w-72 bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden animate-scale-in origin-top-right z-50">
                                {/* Header Section */}
                                <div className="p-4 border-b border-[#27272a]">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-10 h-10 rounded-full bg-brand flex items-center justify-center text-bg font-bold">
                                            B
                                        </div>
                                        <div>
                                            <div className="font-bold text-white text-sm">{user?.email}</div>
                                            <div className="text-xs text-neutral-400">{isAdmin ? 'ADMINISTRATOR' : 'ADVANCE Plan'}</div>
                                        </div>
                                    </div>

                                    {/* Usage Bar */}
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between text-[10px] text-neutral-400 font-medium">
                                            <span>Daily Limit</span>
                                            <span>{isAdmin ? 'Unlimited' : `${profile?.credits || 0} / 200 Images`}</span>
                                        </div>
                                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                                            <div className="h-full bg-green-500 w-[7.5%] rounded-full"></div>
                                        </div>
                                    </div>
                                </div>

                                {/* Menu Options */}
                                <div className="p-2 space-y-0.5">
                                    {/* ADMIN STATUS INDICATOR */}
                                    <div className="px-3 py-2.5 flex items-center justify-between">
                                        <div className="flex items-center gap-3 text-sm text-neutral-300">
                                            <ShieldCheck size={16} className={isAdmin ? 'text-brand' : 'text-neutral-500'} />
                                            <span>Admin Status</span>
                                        </div>
                                        <div className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${isAdmin ? 'bg-brand text-bg' : 'bg-neutral-800 text-neutral-500'}`}>
                                            {isAdmin ? 'Active' : 'Customer'}
                                        </div>
                                    </div>

                                    <div className="h-px bg-[#27272a] mx-2 my-1"></div>

                                    <button
                                        onClick={() => { setMode(AppMode.ADMIN); setIsProfileOpen(false); }}
                                        className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-neutral-300 hover:text-white hover:bg-white/5 flex items-center gap-3 transition-colors"
                                    >
                                        <Lock size={16} /> Control Panel
                                    </button>
                                    <button className="w-full text-left px-3 py-2.5 rounded-lg text-sm text-neutral-300 hover:text-white hover:bg-white/5 flex items-center gap-3 transition-colors">
                                        <Settings size={16} /> Settings
                                    </button>
                                </div>

                                {/* Logout */}
                                <div className="p-4 border-t border-[#27272a]">
                                    <button
                                        onClick={() => { signOut(); setIsProfileOpen(false); }}
                                        className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-lg text-sm transition-colors shadow-lg shadow-red-900/20"
                                    >
                                        Logout
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Mobile: Unified Header (Below LG breakpoint) */}
            <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex flex-col pointer-events-none">
                {/* Top Bar */}
                <div className="bg-panel/95 backdrop-blur-xl border-b border-border-base px-4 py-3 flex items-center justify-between pointer-events-auto shadow-sm">
                    <div onClick={() => setMode(AppMode.EXPLORE)} className="flex items-center gap-2">
                        <div className="w-9 h-9 bg-brand rounded-xl flex items-center justify-center text-bg shadow-sm">
                            <Waves size={18} strokeWidth={3} />
                        </div>
                        <div>
                            <span className="font-bold text-text-primary block leading-none">Gods Eye</span>
                            <span className="text-[9px] text-text-secondary font-mono uppercase tracking-wider">Studio v2.1</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={toggleTheme} className="w-9 h-9 flex items-center justify-center rounded-full bg-surface border border-border-base text-text-secondary hover:text-text-primary">
                            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                        </button>
                        <button onClick={() => setMode(AppMode.ADMIN)} className="w-9 h-9 rounded-full bg-surface border border-border-base overflow-hidden">
                            <img src="https://picsum.photos/100/100?random=avatar" alt="User" className="w-full h-full object-cover" />
                        </button>
                    </div>
                </div>

                {/* Scrollable Nav Bar */}
                <div className="bg-panel/95 backdrop-blur-xl border-b border-border-base py-2 overflow-x-auto scrollbar-hide pointer-events-auto">
                    <div className="flex px-4 gap-2">
                        {navItems
                            .filter(item => item.id !== AppMode.ADMIN || isAdmin) // Filter for Mobile too
                            .map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => setMode(item.id as AppMode)}
                                    className={`flex-shrink-0 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${currentMode === item.id
                                        ? 'bg-brand text-bg border-brand shadow-sm'
                                        : 'bg-surface text-text-secondary border-border-base hover:border-text-secondary'
                                        }`}
                                >
                                    {item.label}
                                    {item.badge && <span className="ml-1 text-[8px] bg-brand text-bg px-1 rounded-full">{item.badge}</span>}
                                </button>
                            ))}
                    </div>
                </div>
            </div>
        </>
    );
};
