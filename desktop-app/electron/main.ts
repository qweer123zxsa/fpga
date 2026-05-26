import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import fssync from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import Store from "electron-store";

type AppSettings = {
  modelProvider: "deepseek" | "openai";
  apiKey: string;
  model: string;
  baseUrl: string;
};

type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const terminalProcesses = new Map<string, ChildProcessWithoutNullStreams>();

const settingsStore = new Store<{ settings: AppSettings; recentWorkspace?: string }>({
  name: "cursor-lite-settings",
  defaults: {
    settings: {
      modelProvider: "deepseek",
      apiKey: "",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    },
  },
});

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-electron",
  ".cursor",
]);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "CursorLite",
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function isPathInsideWorkspace(candidatePath: string, workspacePath: string): boolean {
  const normalizedWorkspace = path.resolve(workspacePath);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate.startsWith(normalizedWorkspace);
}

async function buildFileTree(targetPath: string): Promise<FileNode[]> {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .map(async (entry) => {
        const absolutePath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: absolutePath,
            type: "directory" as const,
            children: await buildFileTree(absolutePath),
          };
        }
        return {
          name: entry.name,
          path: absolutePath,
          type: "file" as const,
        };
      }),
  );

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function setupIpcHandlers() {
  ipcMain.handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open Workspace",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const workspacePath = result.filePaths[0];
    settingsStore.set("recentWorkspace", workspacePath);
    const tree = await buildFileTree(workspacePath);
    return { workspacePath, tree };
  });

  ipcMain.handle("workspace:list", async (_event, workspacePath: string) => {
    return buildFileTree(workspacePath);
  });

  ipcMain.handle("file:read", async (_event, filePath: string, workspacePath: string) => {
    if (!isPathInsideWorkspace(filePath, workspacePath)) {
      throw new Error("非法路径访问");
    }
    return fs.readFile(filePath, "utf-8");
  });

  ipcMain.handle(
    "file:write",
    async (_event, filePath: string, content: string, workspacePath: string) => {
      if (!isPathInsideWorkspace(filePath, workspacePath)) {
        throw new Error("非法路径访问");
      }
      await fs.writeFile(filePath, content, "utf-8");
      return { success: true };
    },
  );

  ipcMain.handle("search:run", async (_event, workspacePath: string, query: string) => {
    const command = spawn(
      "rg",
      ["--line-number", "--ignore-case", "--glob", "!node_modules/**", query, workspacePath],
      { windowsHide: true },
    );

    const output = await new Promise<string>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      command.stdout.on("data", (chunk) => (stdout += chunk.toString()));
      command.stderr.on("data", (chunk) => (stderr += chunk.toString()));
      command.on("close", (code) => {
        if (code === 0 || code === 1) resolve(stdout);
        else reject(new Error(stderr || "search failed"));
      });
      command.on("error", reject);
    });

    return output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.+):(\d+):(.*)$/);
        if (!match) return null;
        return {
          filePath: match[1],
          line: Number(match[2]),
          preview: match[3]?.trim() ?? "",
        };
      })
      .filter(Boolean);
  });

  ipcMain.handle("settings:get", async () => settingsStore.get("settings"));
  ipcMain.handle("settings:set", async (_event, settings: AppSettings) => {
    settingsStore.set("settings", settings);
    return { success: true };
  });

  ipcMain.handle("workspace:recent", async () => {
    const recent = settingsStore.get("recentWorkspace");
    if (!recent || !fssync.existsSync(recent)) return null;
    const tree = await buildFileTree(recent);
    return { workspacePath: recent, tree };
  });

  ipcMain.handle(
    "terminal:start",
    async (_event, terminalId: string, command: string, cwd: string) => {
      const shell = process.platform === "win32" ? "powershell.exe" : "bash";
      const args =
        process.platform === "win32"
          ? ["-NoLogo", "-NoProfile", "-Command", command]
          : ["-lc", command];

      const child = spawn(shell, args, {
        cwd,
        windowsHide: true,
      });
      terminalProcesses.set(terminalId, child);

      child.stdout.on("data", (chunk) => {
        mainWindow?.webContents.send("terminal:data", {
          terminalId,
          type: "stdout",
          text: chunk.toString(),
        });
      });

      child.stderr.on("data", (chunk) => {
        mainWindow?.webContents.send("terminal:data", {
          terminalId,
          type: "stderr",
          text: chunk.toString(),
        });
      });

      child.on("close", (code) => {
        mainWindow?.webContents.send("terminal:exit", { terminalId, code });
        terminalProcesses.delete(terminalId);
      });

      return { started: true };
    },
  );

  ipcMain.handle("terminal:stop", async (_event, terminalId: string) => {
    const processRef = terminalProcesses.get(terminalId);
    if (processRef) {
      processRef.kill();
      terminalProcesses.delete(terminalId);
    }
    return { success: true };
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const processRef of terminalProcesses.values()) processRef.kill();
  terminalProcesses.clear();
  if (process.platform !== "darwin") app.quit();
});
