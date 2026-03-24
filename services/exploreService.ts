import { supabase } from './supabaseClient';
import { ExploreItem, ExploreItemType } from '../types';

export const getExploreItems = async (type?: ExploreItemType): Promise<ExploreItem[]> => {
    let query = supabase
        .from('explore_items')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

    if (type) {
        query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error fetching explore items:', error);
        return [];
    }
    return data || [];
};
