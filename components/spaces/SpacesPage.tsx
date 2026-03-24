import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  useReactFlow,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { SpaceNodeType, SpaceNodeData, WorkflowRecord } from '../../types/spaces.types';
import { PromptNode } from './nodes/PromptNode';
import { AssistantNode } from './nodes/AssistantNode';
import { ImageGeneratorNode } from './nodes/ImageGeneratorNode';
import { VideoGeneratorNode } from './nodes/VideoGeneratorNode';
import { EditNodeComponent } from './nodes/EditNodeComponent';
import { UpscalerNode } from './nodes/UpscalerNode';
import { OutputExportNode } from './nodes/OutputExportNode';
import { ImageUploadNode } from './nodes/ImageUploadNode';
import { SpacesToolbar } from './SpacesToolbar';
import { SpacesNodePanel } from './SpacesNodePanel';
import { SpacesWorkflowList } from './SpacesWorkflowList';
import { useSpaceExecutor } from './useSpaceExecutor';
import { saveWorkflow } from '../../services/workflowsService';
import { useAuth } from '../../context/AuthContext';
import { LayoutGrid } from 'lucide-react';

// nodeTypes MUST be defined outside the component to prevent React Flow re-render loops
const nodeTypes = {
  prompt: PromptNode,
  assistant: AssistantNode,
  imageGenerator: ImageGeneratorNode,
  videoGenerator: VideoGeneratorNode,
  editNode: EditNodeComponent,
  upscaler: UpscalerNode,
  outputExport: OutputExportNode,
  imageUpload: ImageUploadNode,
} as const;

function buildDefaultNodeData(type: SpaceNodeType): SpaceNodeData {
  switch (type) {
    case 'prompt':
      return { nodeType: 'prompt', status: 'idle', prompt: '', enhanceEnabled: false };
    case 'assistant':
      return { nodeType: 'assistant', status: 'idle', idea: '' };
    case 'imageGenerator':
      return { nodeType: 'imageGenerator', status: 'idle', model: 'gemini-3-pro-image-preview', aspectRatio: '1:1', quality: '1K' };
    case 'videoGenerator':
      return { nodeType: 'videoGenerator', status: 'idle', model: 'fal-ai/kling-video/v3/standard/text-to-video', resolution: '720p', aspectRatio: '16:9' };
    case 'editNode':
      return { nodeType: 'editNode', status: 'idle', model: 'gemini-3-pro-image-preview', aspectRatio: '1:1' };
    case 'upscaler':
      return { nodeType: 'upscaler', status: 'idle', upscalePrompt: '' };
    case 'outputExport':
      return { nodeType: 'outputExport', status: 'idle', saveToGallery: true, label: 'Output' };
    case 'imageUpload':
      return { nodeType: 'imageUpload', status: 'idle' };
  }
}

// Inner canvas component — must be inside ReactFlowProvider to use hooks
const SpacesCanvas: React.FC = () => {
  const { session } = useAuth();
  const userId = session?.user?.id || '';
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [workflowName, setWorkflowName] = useState('Untitled Space');
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | undefined>();
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showWorkflowList, setShowWorkflowList] = useState(false);

  const { execute } = useSpaceExecutor(userId);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge(params, eds)),
    [setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow') as SpaceNodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode = {
        id: crypto.randomUUID(),
        type,
        position,
        data: buildDefaultNodeData(type),
      };

      setNodes(nds => [...nds, newNode as any]);
    },
    [screenToFlowPosition, setNodes]
  );

  const handleSave = async () => {
    if (!userId) return;
    setIsSaving(true);
    try {
      const persistedNodes = nodes.map(n => ({
        id: n.id,
        type: n.type as SpaceNodeType,
        position: n.position,
        data: n.data as SpaceNodeData,
      }));
      const persistedEdges = edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));

      const result = await saveWorkflow(userId, workflowName, persistedNodes, persistedEdges, currentWorkflowId);
      if (result) {
        setCurrentWorkflowId(result.id);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async () => {
    setIsRunning(true);
    try {
      await execute();
    } finally {
      setIsRunning(false);
    }
  };

  const handleLoadWorkflow = (workflow: WorkflowRecord) => {
    setWorkflowName(workflow.name);
    setCurrentWorkflowId(workflow.id);
    setNodes(workflow.nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })) as any);
    setEdges(workflow.edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })));
    setShowWorkflowList(false);
  };

  return (
    <div className="w-full h-full relative">
      {/* Node Palette */}
      <SpacesNodePanel />

      {/* Top Toolbar */}
      <SpacesToolbar
        workflowName={workflowName}
        onNameChange={setWorkflowName}
        onSave={handleSave}
        onRun={handleRun}
        isRunning={isRunning}
        isSaving={isSaving}
      />

      {/* My Spaces Button */}
      <button
        onClick={() => setShowWorkflowList(v => !v)}
        className="absolute top-28 right-4 z-[60] flex items-center gap-2 px-4 py-2.5 bg-white/[0.03] backdrop-blur-xl border border-white/5 rounded-full text-xs font-bold text-text-secondary hover:text-text-primary hover:border-brand/50 hover:bg-white/[0.06] transition-all shadow-xl"
      >
        <LayoutGrid size={14} />
        My Spaces
      </button>

      {/* Saved Workflows Panel */}
      <SpacesWorkflowList
        userId={userId}
        isOpen={showWorkflowList}
        onClose={() => setShowWorkflowList(false)}
        onLoad={handleLoadWorkflow}
        currentWorkflowId={currentWorkflowId}
      />

      {/* React Flow Canvas */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        fitView
        className="spaces-canvas"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="var(--dot-color)"
        />
        <Controls className="spaces-controls" />
        <MiniMap
          className="spaces-minimap"
          nodeColor="var(--brand)"
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
};

// Root export — wraps in ReactFlowProvider
export const SpacesPage: React.FC = () => {
  return (
    <ReactFlowProvider>
      <SpacesCanvas />
    </ReactFlowProvider>
  );
};
