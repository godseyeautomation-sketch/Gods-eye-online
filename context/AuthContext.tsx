
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { Session, User } from '@supabase/supabase-js';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
    login: (e: string, p: string) => Promise<void>;
    signOut: () => Promise<void>;
    refreshProfile: () => Promise<void>;
    isAdmin: boolean;
    profile: any;
    canUseVideo: boolean;
    canUseSpaces: boolean;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    user: null,
    loading: true,
    login: async () => { },
    signOut: async () => { },
    refreshProfile: async () => { },
    isAdmin: false,
    profile: null,
    canUseVideo: false,
    canUseSpaces: false,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
    const [profile, setProfile] = useState<any>(null);
    const [canUseVideo, setCanUseVideo] = useState(false);
    const [canUseSpaces, setCanUseSpaces] = useState(false);

    const fetchProfile = async (currentUser: User | null) => {
        if (!currentUser) {
            setProfile(null);
            setIsAdmin(false);
            setCanUseVideo(false);
            setCanUseSpaces(false);
            return;
        }

        const isSuperAdmin = currentUser.email === 'bitan@outreachpro.io';
        if (isSuperAdmin) {
            setIsAdmin(true);
            setCanUseVideo(true);
            setCanUseSpaces(true);
        }

        try {
            const { data } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', currentUser.id)
                .single();

            setProfile(data);

            if (data?.tier === 'admin') {
                setIsAdmin(true);
            }

            if (!isSuperAdmin) {
                setCanUseVideo(data?.can_use_video === true);
                setCanUseSpaces(data?.can_use_spaces === true);
            }
        } catch (err) {
            console.error("Profile fetch error:", err);
        }
    };

    useEffect(() => {
        let isMounted = true;
        const timeoutId = setTimeout(() => {
            if (isMounted) {
                console.warn("Supabase getSession timeout - forcing load state to false. Check CORS.");
                setLoading(false);
            }
        }, 3000);

        supabase.auth.getSession()
            .then(({ data: { session }, error }) => {
                clearTimeout(timeoutId);
                if (error) {
                    console.error("Supabase getSession error:", error);
                }
                if (isMounted) {
                    setSession(session);
                    setUser(session?.user ?? null);
                    fetchProfile(session?.user ?? null);
                    setLoading(false);
                }
            })
            .catch((err) => {
                clearTimeout(timeoutId);
                console.error("Supabase getSession rejected:", err);
                if (isMounted) setLoading(false);
            });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, supabaseSession) => {
            if (isMounted) {
                setSession(currentSession => {
                    if (currentSession?.access_token === 'mock-token') return currentSession;
                    setUser(supabaseSession?.user ?? null);
                    fetchProfile(supabaseSession?.user ?? null);
                    setLoading(false);
                    return supabaseSession;
                });
            }
        });

        return () => {
            isMounted = false;
            clearTimeout(timeoutId);
            subscription.unsubscribe();
        };
    }, []);

    const login = async (e: string, p: string) => {
        const cleanEmail = e.trim().toLowerCase();

        // Mock Bypass Trapdoor
        if (cleanEmail === 'admin@godseye.studio' && p === 'godseye123') {
            const mockUser = {
                id: 'mock-admin-123',
                email: 'admin@godseye.studio',
                app_metadata: {},
                user_metadata: {},
                aud: 'authenticated',
                created_at: new Date().toISOString()
            } as User;

            setSession({
                access_token: 'mock-token',
                refresh_token: 'mock-refresh',
                expires_in: 3600,
                expires_at: Math.floor(Date.now() / 1000) + 3600,
                token_type: 'bearer',
                user: mockUser
            });

            setUser(mockUser);
            setIsAdmin(true);
            setCanUseVideo(true);
            setCanUseSpaces(true);
            setProfile({ tier: 'admin', can_use_video: true, can_use_spaces: true });
            return;
        }

        // Standard Login
        const { error } = await supabase.auth.signInWithPassword({
            email: e,
            password: p,
        });
        if (error) throw error;
    };

    const signOut = async () => {
        setSession(currentSession => {
            if (currentSession?.access_token === 'mock-token') {
                setUser(null);
                setIsAdmin(false);
                setProfile(null);
                setCanUseVideo(false);
                setCanUseSpaces(false);
                return null;
            } else {
                supabase.auth.signOut().then(() => {
                    setUser(null);
                    setIsAdmin(false);
                    setProfile(null);
                    setCanUseVideo(false);
                    setCanUseSpaces(false);
                });
                return null;
            }
        });
    };

    return (
        <AuthContext.Provider value={{ session, user, loading, login, signOut, refreshProfile: () => fetchProfile(user), isAdmin, profile, canUseVideo, canUseSpaces }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
