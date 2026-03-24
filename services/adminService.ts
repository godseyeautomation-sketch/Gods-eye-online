import { supabase } from './supabaseClient';

// Cost constants (in INR)
export const COSTS = {
    image: {
        '1K': 3.33,
        '2K': 6.66,
        '4K': 13.32
    },
    video: {
        '4s': 66.64,
        '8s': 133.28
    }
};

// ========== USER MANAGEMENT ==========

export const getAllUsers = async () => {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error: any) {
        console.error('Get all users error:', error);
        return [];
    }
};

export const updateUserCredits = async (userId: string, credits: number) => {
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ credits })
            .eq('id', userId);

        if (error) throw error;
        return true;
    } catch (error: any) {
        console.error('Update credits error:', error);
        return false;
    }
};

export const toggleUserBan = async (userId: string, isBanned: boolean) => {
    try {
        const { error } = await supabase
            .from('profiles')
            .update({ is_banned: isBanned })
            .eq('id', userId);

        if (error) throw error;
        return true;
    } catch (error: any) {
        console.error('Toggle ban error:', error);
        return false;
    }

};

export const toggleUserByok = async (userId: string, canUse: boolean) => {
    const { error } = await supabase
        .from('profiles')
        .update({ can_use_byok: canUse })
        .eq('id', userId);

    if (error) {
        console.error('Error updating BYOK:', error);
        return false;
    }
    return true;
};

export const updateUserTier = async (userId: string, tier: string) => {
    const { error } = await supabase
        .from('profiles')
        .update({ tier: tier }) // Assumes 'tier' column exists in 'profiles'
        .eq('id', userId);

    if (error) {
        console.error('Error updating Tier:', error);
        return false;
    }
    return true;
};

export const toggleVideoAccess = async (userId: string, canAccess: boolean) => {
    const { error } = await supabase
        .from('profiles')
        .update({ can_use_video: canAccess })
        .eq('id', userId);
    if (error) { console.error('Error updating video access:', error); return false; }
    return true;
};

export const toggleSpacesAccess = async (userId: string, canAccess: boolean) => {
    const { error } = await supabase
        .from('profiles')
        .update({ can_use_spaces: canAccess })
        .eq('id', userId);
    if (error) { console.error('Error updating spaces access:', error); return false; }
    return true;
};


// ========== VIDEO EFFECTS ==========

export const getVideoEffects = async () => {
    try {
        const { data, error } = await supabase
            .from('video_effects')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data || [];
    } catch (error: any) {
        console.error('Get video effects error:', error);
        return [];
    }
};

export const addVideoEffect = async (effect: {
    name: string;
    category: string;
    thumbnail_url?: string;
    prompt_template: string;
}) => {
    try {
        const { data, error } = await supabase
            .from('video_effects')
            .insert(effect)
            .select()
            .single();

        if (error) throw error;
        return data;
    } catch (error: any) {
        console.error('Add video effect error:', error);
        return null;
    }
};

export const deleteVideoEffect = async (id: string) => {
    try {
        const { error } = await supabase
            .from('video_effects')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    } catch (error: any) {
        console.error('Delete video effect error:', error);
        return false;
    }
};

// ========== ANALYTICS ==========

export const getWeeklyAnalytics = async () => {
    try {
        const { data, error } = await supabase
            .rpc('get_daily_costs', { days_back: 7 });

        if (error) throw error;
        return data || [];
    } catch (error: any) {
        console.error('Get weekly analytics error:', error);
        return [];
    }
};

export const getSystemHealth = async () => {
    try {
        // Use count-only query — no row data needed
        const { count } = await supabase
            .from('usage_analytics')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        return {
            apiStatus: 'operational',
            errorRate: '0.0',
            activeSessions: count || 0
        };
    } catch (error: any) {
        console.error('Get system health error:', error);
        return { apiStatus: 'unknown', errorRate: '0.0', activeSessions: 0 };
    }
};

// ========== API CONFIG ==========

export const getApiConfig = async () => {
    try {
        const { data, error } = await supabase
            .from('api_config')
            .select('*');

        if (error) throw error;

        // Convert to key-value object
        const config: any = {};
        data?.forEach((item) => {
            config[item.config_key] = item.config_value;
        });

        return config;
    } catch (error: any) {
        console.error('Get API config error:', error);
        return {};
    }
};

export const updateApiConfig = async (configKey: string, configValue: any) => {
    try {
        const { error } = await supabase
            .from('api_config')
            .upsert({
                config_key: configKey,
                config_value: configValue,
                updated_at: new Date().toISOString()
            });

        if (error) throw error;
        return true;
    } catch (error: any) {
        console.error('Update API config error:', error);
        return false;
    }
};

// ========== USAGE TRACKING ==========

export const logUsage = async (
    userId: string,
    actionType: 'image' | 'video' | 'character' | 'edit',
    modelUsed: string,
    quality?: string
) => {
    try {
        let costInr = 0;

        // Calculate cost
        if (actionType === 'image' && quality) {
            costInr = COSTS.image[quality as keyof typeof COSTS.image] || 0;
        } else if (actionType === 'video' && quality) {
            costInr = COSTS.video[quality as keyof typeof COSTS.video] || 0;
        }

        const { error } = await supabase
            .from('usage_analytics')
            .insert({
                user_id: userId,
                action_type: actionType,
                model_used: modelUsed,
                quality,
                cost_inr: costInr
            });

        if (error) throw error;
        return true;
    } catch (error: any) {
        console.error('Log usage error:', error);
        return false;
    }
};
