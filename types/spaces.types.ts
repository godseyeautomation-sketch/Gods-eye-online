import { Node, Edge } from '@xyflow/react';

export type SpaceNodeType =
  | 'prompt'
  | 'assistant'
  | 'imageGenerator'
  | 'videoGenerator'
  | 'editNode'
  | 'upscaler'
  | 'outputExport'
  | 'imageUpload';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

// --- Prompt Node ---
export interface PromptNodeData {
  nodeType: 'prompt';
  status: NodeStatus;
  prompt: string;
  enhanceEnabled: boolean;
  outputPrompt?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Assistant Node ---
export interface AssistantNodeData {
  nodeType: 'assistant';
  status: NodeStatus;
  idea: string;
  outputPrompt?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Image Generator Node ---
export interface ImageGeneratorNodeData {
  nodeType: 'imageGenerator';
  status: NodeStatus;
  model: string;
  aspectRatio: string;
  quality: '1K' | '2K' | '4K';
  outputImages?: string[];
  error?: string;
  [key: string]: unknown;
}

// --- Video Generator Node ---
export interface VideoGeneratorNodeData {
  nodeType: 'videoGenerator';
  status: NodeStatus;
  model: string;
  resolution: string;
  aspectRatio: string;
  outputVideoUrl?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Edit Node ---
export interface EditNodeData {
  nodeType: 'editNode';
  status: NodeStatus;
  model: string;
  aspectRatio: string;
  outputImage?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Upscaler Node ---
export interface UpscalerNodeData {
  nodeType: 'upscaler';
  status: NodeStatus;
  upscalePrompt: string;
  outputImage?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Image Upload Node ---
export interface ImageUploadNodeData {
  nodeType: 'imageUpload';
  status: NodeStatus;
  outputImage?: string;  // base64 data URL of the uploaded image
  fileName?: string;
  error?: string;
  [key: string]: unknown;
}

// --- Output Export Node ---
export interface OutputExportNodeData {
  nodeType: 'outputExport';
  status: NodeStatus;
  saveToGallery: boolean;
  label: string;
  error?: string;
  [key: string]: unknown;
}

export type SpaceNodeData =
  | PromptNodeData
  | AssistantNodeData
  | ImageGeneratorNodeData
  | VideoGeneratorNodeData
  | EditNodeData
  | UpscalerNodeData
  | OutputExportNodeData
  | ImageUploadNodeData;

export type SpaceNode = Node<SpaceNodeData, SpaceNodeType>;
export type SpaceEdge = Edge;

// Persisted versions (for Supabase JSONB)
export interface PersistedNode {
  id: string;
  type: SpaceNodeType;
  position: { x: number; y: number };
  data: SpaceNodeData;
}

export interface PersistedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

// Supabase workflow record
export interface WorkflowRecord {
  id: string;
  user_id: string;
  name: string;
  nodes: PersistedNode[];
  edges: PersistedEdge[];
  created_at: string;
  updated_at: string;
}
