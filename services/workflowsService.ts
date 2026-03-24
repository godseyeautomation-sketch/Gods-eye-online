import { supabase } from './supabaseClient';
import { WorkflowRecord, PersistedNode, PersistedEdge } from '../types/spaces.types';

/**
 * Save or update a workflow for the current user
 */
export const saveWorkflow = async (
  userId: string,
  name: string,
  nodes: PersistedNode[],
  edges: PersistedEdge[],
  existingId?: string
): Promise<WorkflowRecord | null> => {
  try {
    if (existingId) {
      const { data, error } = await supabase
        .from('workflows')
        .update({ name, nodes, edges })
        .eq('id', existingId)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await supabase
        .from('workflows')
        .insert({ user_id: userId, name, nodes, edges })
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  } catch (error: any) {
    console.error('[Workflows] Save error:', error);
    return null;
  }
};

/**
 * Get all workflows for a user
 */
export const getUserWorkflows = async (userId: string): Promise<WorkflowRecord[]> => {
  try {
    const { data, error } = await supabase
      .from('workflows')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error: any) {
    console.error('[Workflows] Fetch error:', error);
    return [];
  }
};

/**
 * Delete a workflow
 */
export const deleteWorkflow = async (id: string, userId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('workflows')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
    return true;
  } catch (error: any) {
    console.error('[Workflows] Delete error:', error);
    return false;
  }
};
