import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  VideoProject,
  StoredVideo,
  saveVideoProject,
  getVideoProjects,
  deleteVideoProject as deleteProjectDB,
  getVideosByProject,
  getUnorganizedVideos,
} from '../services/localStorageService';

interface VideoProjectContextType {
  projects: VideoProject[];
  activeProject: VideoProject | null;
  projectVideos: StoredVideo[];
  unorganizedVideos: StoredVideo[];
  createProject: (name: string) => Promise<VideoProject>;
  openProject: (id: string) => void;
  closeProject: () => void;
  deleteProject: (id: string) => Promise<void>;
  refreshProjectVideos: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshUnorganized: () => Promise<void>;
}

const VideoProjectContext = createContext<VideoProjectContextType | null>(null);

export const useVideoProjects = () => {
  const ctx = useContext(VideoProjectContext);
  if (!ctx) throw new Error('useVideoProjects must be used within VideoProjectProvider');
  return ctx;
};

export const VideoProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [activeProject, setActiveProject] = useState<VideoProject | null>(null);
  const [projectVideos, setProjectVideos] = useState<StoredVideo[]>([]);
  const [unorganizedVideos, setUnorganizedVideos] = useState<StoredVideo[]>([]);

  const refreshProjects = useCallback(async () => {
    const p = await getVideoProjects();
    setProjects(p);
  }, []);

  const refreshUnorganized = useCallback(async () => {
    const v = await getUnorganizedVideos();
    setUnorganizedVideos(v);
  }, []);

  const refreshProjectVideos = useCallback(async () => {
    if (!activeProject) { setProjectVideos([]); return; }
    const v = await getVideosByProject(activeProject.id);
    setProjectVideos(v);
  }, [activeProject]);

  // Load projects + unorganized on mount
  useEffect(() => {
    refreshProjects();
    refreshUnorganized();
  }, [refreshProjects, refreshUnorganized]);

  // Reload project videos when active project changes
  useEffect(() => {
    refreshProjectVideos();
  }, [refreshProjectVideos]);

  const createProject = useCallback(async (name: string): Promise<VideoProject> => {
    const project: VideoProject = {
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveVideoProject(project);
    setProjects(prev => [project, ...prev]);
    return project;
  }, []);

  const openProject = useCallback((id: string) => {
    const p = projects.find(x => x.id === id);
    if (p) setActiveProject(p);
  }, [projects]);

  const closeProject = useCallback(() => {
    setActiveProject(null);
    setProjectVideos([]);
    refreshUnorganized();
  }, [refreshUnorganized]);

  const deleteProject = useCallback(async (id: string) => {
    await deleteProjectDB(id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (activeProject?.id === id) {
      setActiveProject(null);
      setProjectVideos([]);
    }
    refreshUnorganized();
  }, [activeProject, refreshUnorganized]);

  return (
    <VideoProjectContext.Provider value={{
      projects, activeProject, projectVideos, unorganizedVideos,
      createProject, openProject, closeProject, deleteProject,
      refreshProjectVideos, refreshProjects, refreshUnorganized,
    }}>
      {children}
    </VideoProjectContext.Provider>
  );
};
