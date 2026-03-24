
export enum AppMode {
  EXPLORE = 'explore',
  IMAGE = 'image',
  VIDEO = 'video',
  ADMIN = 'admin',
  DRAW = 'draw',
  EDIT = 'edit',
  CHARACTER = 'character',
  ASSIST = 'assist',
  STUDIO = 'studio'
}

export enum ModelType {
  NANO_BANANA_PRO = 'gemini-3-pro-image-preview', // Flagship
  NANO_BANANA = 'gemini-2.5-flash-image', // Standard
  SEEDREAM = 'imagen-3.0-generate-001', // Placeholder
}

export interface VideoEffect {
  id: string;
  name: string;
  category: string;
  thumbnail: string;
  promptTemplate: string;
  modelCompatibility: string[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  usage: number;
  limit: number;
  status: 'active' | 'banned';
  lastActive: string;
}

export interface GeneratedAsset {
  id: string;
  url: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  createdAt: number;
}

export interface GenerationConfig {
  model: ModelType;
  aspectRatio: string;
  quality: '1K' | '2K' | '4K';
  batchSize: number;
  prompt: string;
}

export interface Character {
  id: string;
  name: string;
  thumbnail: string;
  images: string[];
}

export interface RefinementMessage {
  role: 'user' | 'model';
  content: string;
  imageUrl?: string;
}

export interface StudioElement {
  id: string;
  type: 'text' | 'heading' | 'image' | 'button';
  content: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  style: {
    fontSize?: number;
    color?: string;
    borderRadius?: number;
    opacity?: number;
    textAlign?: 'left' | 'center' | 'right';
    backgroundColor?: string;
  };
}
