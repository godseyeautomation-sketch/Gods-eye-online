import { createClient } from '@supabase/supabase-js';

// Root Cure: Read directly from the server-injected script
// No placeholders allowed - we use real credentials or nothing.
const getRuntimeConfig = () => {
    if (typeof window === 'undefined') return {};
    return (window as any).__RUNTIME_CONFIG__ || {};
};

const config = getRuntimeConfig();

// If the server-injected script has them, use them. 
// Otherwise fallback to build-time vars (which are likely empty in prod)
// @ts-ignore
const supabaseUrl = config.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
// @ts-ignore
const supabaseAnonKey = config.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Supabase] CRITICAL: Missing Supabase URL or Anon Key in runtime configuration!');
}

// We provide dummy values if empty to prevent createClient from throwing a synchronous error 
// that crashes the entire React application before the trapdoor can be reached.
export const supabase = createClient(
    supabaseUrl || 'https://dummy.supabase.co',
    supabaseAnonKey || 'dummy-key'
);

export const initSupabaseRuntime = async () => {
    // This is now purely for logging as the injection is synchronous
    console.log('[Supabase] Initializing with URL:', supabaseUrl);
};
