import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  openWorkspace: () => ipcRenderer.invoke("workspace:open"),
  getRecentWorkspace: () => ipcRenderer.invoke("workspace:recent"),
  listWorkspace: (workspacePath: string) =>
    ipcRenderer.invoke("workspace:list", workspacePath),
  readFile: (filePath: string, workspacePath: string) =>
    ipcRenderer.invoke("file:read", filePath, workspacePath),
  writeFile: (filePath: string, content: string, workspacePath: string) =>
    ipcRenderer.invoke("file:write", filePath, content, workspacePath),
  searchWorkspace: (workspacePath: string, query: string) =>
    ipcRenderer.invoke("search:run", workspacePath, query),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("settings:set", settings),
  startTerminal: (terminalId: string, command: string, cwd: string) =>
    ipcRenderer.invoke("terminal:start", terminalId, command, cwd),
  stopTerminal: (terminalId: string) => ipcRenderer.invoke("terminal:stop", terminalId),
  onTerminalData: (handler: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("terminal:data", listener);
    return () => ipcRenderer.removeListener("terminal:data", listener);
  },
  onTerminalExit: (handler: (payload: unknown) => void) => {
    const listener = (_event: unknown, payload: unknown) => handler(payload);
    ipcRenderer.on("terminal:exit", listener);
    return () => ipcRenderer.removeListener("terminal:exit", listener);
  },
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);
