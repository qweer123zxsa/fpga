export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type WorkspaceState = {
  workspacePath: string;
  tree: FileNode[];
};

export type SearchResult = {
  filePath: string;
  line: number;
  preview: string;
};

export type AppSettings = {
  modelProvider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
};

export type TerminalDataPayload = {
  terminalId: string;
  type: "stdout" | "stderr";
  text: string;
};

export type TerminalExitPayload = {
  terminalId: string;
  code: number | null;
};

declare global {
  interface Window {
    desktopApi: {
      openWorkspace: () => Promise<WorkspaceState | null>;
      getRecentWorkspace: () => Promise<WorkspaceState | null>;
      listWorkspace: (workspacePath: string) => Promise<FileNode[]>;
      readFile: (filePath: string, workspacePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string, workspacePath: string) => Promise<{ success: boolean }>;
      searchWorkspace: (workspacePath: string, query: string) => Promise<SearchResult[]>;
      getSettings: () => Promise<AppSettings>;
      saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
      startTerminal: (terminalId: string, command: string, cwd: string) => Promise<{ started: boolean }>;
      stopTerminal: (terminalId: string) => Promise<{ success: boolean }>;
      onTerminalData: (handler: (payload: TerminalDataPayload) => void) => () => void;
      onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => () => void;
    };
  }
}

export {};
