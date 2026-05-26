import { create } from "zustand";
import type { AppSettings, FileNode, SearchResult } from "../types/electron";

export type OpenFile = {
  path: string;
  content: string;
  dirty: boolean;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
};

type ToolTrace = {
  id: string;
  name: string;
  status: "start" | "done" | "error";
  detail: string;
  elapsedMs?: number;
};

type AppState = {
  workspacePath: string;
  tree: FileNode[];
  selectedFilePath: string;
  openFiles: Record<string, OpenFile>;
  activeTabPath: string;
  searchResults: SearchResult[];
  chatMessages: ChatMessage[];
  toolTraces: ToolTrace[];
  terminalOutput: string;
  terminalRunning: boolean;
  settings: AppSettings | null;
  patchPreview: string;
  patchTargetPath: string;
  patchVisible: boolean;
  setWorkspace: (workspacePath: string, tree: FileNode[]) => void;
  setTree: (tree: FileNode[]) => void;
  setSelectedFilePath: (path: string) => void;
  upsertOpenFile: (path: string, content: string, dirty?: boolean) => void;
  setActiveTabPath: (path: string) => void;
  setSearchResults: (results: SearchResult[]) => void;
  pushChatMessage: (message: ChatMessage) => void;
  updateChatMessage: (id: string, content: string) => void;
  clearChat: () => void;
  addToolTrace: (trace: ToolTrace) => void;
  clearToolTraces: () => void;
  setTerminalOutput: (text: string) => void;
  appendTerminalOutput: (text: string) => void;
  setTerminalRunning: (running: boolean) => void;
  setSettings: (settings: AppSettings) => void;
  openPatchPreview: (patch: string, targetPath: string) => void;
  closePatchPreview: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  workspacePath: "",
  tree: [],
  selectedFilePath: "",
  openFiles: {},
  activeTabPath: "",
  searchResults: [],
  chatMessages: [],
  toolTraces: [],
  terminalOutput: "",
  terminalRunning: false,
  settings: null,
  patchPreview: "",
  patchTargetPath: "",
  patchVisible: false,
  setWorkspace: (workspacePath, tree) =>
    set({
      workspacePath,
      tree,
      selectedFilePath: "",
      openFiles: {},
      activeTabPath: "",
      searchResults: [],
      terminalOutput: "",
    }),
  setTree: (tree) => set({ tree }),
  setSelectedFilePath: (selectedFilePath) => set({ selectedFilePath }),
  upsertOpenFile: (path, content, dirty = false) =>
    set((state) => ({
      openFiles: {
        ...state.openFiles,
        [path]: { path, content, dirty },
      },
    })),
  setActiveTabPath: (activeTabPath) => set({ activeTabPath }),
  setSearchResults: (searchResults) => set({ searchResults }),
  pushChatMessage: (message) =>
    set((state) => ({ chatMessages: [...state.chatMessages, message] })),
  updateChatMessage: (id, content) =>
    set((state) => ({
      chatMessages: state.chatMessages.map((message) =>
        message.id === id ? { ...message, content } : message,
      ),
    })),
  clearChat: () => set({ chatMessages: [], toolTraces: [] }),
  addToolTrace: (trace) => set((state) => ({ toolTraces: [...state.toolTraces, trace] })),
  clearToolTraces: () => set({ toolTraces: [] }),
  setTerminalOutput: (terminalOutput) => set({ terminalOutput }),
  appendTerminalOutput: (text) =>
    set((state) => ({ terminalOutput: `${state.terminalOutput}${text}` })),
  setTerminalRunning: (terminalRunning) => set({ terminalRunning }),
  setSettings: (settings) => set({ settings }),
  openPatchPreview: (patchPreview, patchTargetPath) =>
    set({ patchVisible: true, patchPreview, patchTargetPath }),
  closePatchPreview: () => set({ patchVisible: false, patchPreview: "", patchTargetPath: "" }),
}));
