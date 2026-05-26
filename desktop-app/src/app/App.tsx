import { useEffect, useMemo, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { WorkspaceTree } from "../features/workspace/WorkspaceTree";
import { EditorPane } from "../features/editor/EditorPane";
import { ChatPanel } from "../features/chat/ChatPanel";
import { TerminalPanel } from "../features/terminal/TerminalPanel";
import { SettingsModal } from "../features/settings/SettingsModal";
import { PatchPreviewModal } from "../components/PatchPreviewModal";
import { useAppStore } from "../store/useAppStore";
import type { ChatMessage } from "../store/useAppStore";
import { runAgentConversation } from "../services/llm/agentService";
import { applySimplePatch, parsePatchFromText } from "../services/patch/patchUtils";
import "../index.css";

const TERMINAL_ID = "main-terminal";

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export default function App() {
  const desktopApi = window.desktopApi;
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);

  const {
    workspacePath,
    tree,
    selectedFilePath,
    openFiles,
    activeTabPath,
    searchResults,
    chatMessages,
    toolTraces,
    terminalOutput,
    terminalRunning,
    settings,
    patchVisible,
    patchPreview,
    patchTargetPath,
    setWorkspace,
    setTree,
    setSelectedFilePath,
    upsertOpenFile,
    setActiveTabPath,
    setSearchResults,
    pushChatMessage,
    updateChatMessage,
    clearChat,
    addToolTrace,
    clearToolTraces,
    setTerminalOutput,
    appendTerminalOutput,
    setTerminalRunning,
    setSettings,
    openPatchPreview,
    closePatchPreview,
  } = useAppStore();

  const activeFile = useMemo(() => {
    if (!activeTabPath) return null;
    return openFiles[activeTabPath] ?? null;
  }, [activeTabPath, openFiles]);
  const openFileList = useMemo(() => Object.values(openFiles), [openFiles]);

  if (!desktopApi) {
    return (
      <div className="app-shell browser-fallback-shell">
        <div className="browser-fallback-card">
          <h2>请从 Electron 窗口打开应用</h2>
          <p>当前是普通浏览器环境，未注入 `desktopApi`。</p>
          <p>请运行 `npm run dev`，等待 Electron 窗口弹出。</p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    desktopApi.getSettings().then(setSettings).catch(console.error);
    desktopApi
      .getRecentWorkspace()
      .then((recent) => {
        if (recent) setWorkspace(recent.workspacePath, recent.tree);
      })
      .catch(console.error);

    const offData = desktopApi.onTerminalData((payload) => {
      if (payload.terminalId !== TERMINAL_ID) return;
      appendTerminalOutput(payload.text);
    });
    const offExit = desktopApi.onTerminalExit((payload) => {
      if (payload.terminalId !== TERMINAL_ID) return;
      appendTerminalOutput(`\n[exit ${payload.code ?? -1}]\n`);
      setTerminalRunning(false);
    });
    return () => {
      offData();
      offExit();
    };
  }, [appendTerminalOutput, setSettings, setTerminalRunning, setWorkspace]);

  async function openWorkspace() {
    const result = await desktopApi.openWorkspace();
    if (!result) return;
    setWorkspace(result.workspacePath, result.tree);
  }

  async function refreshTree() {
    if (!workspacePath) return;
    const newTree = await desktopApi.listWorkspace(workspacePath);
    setTree(newTree);
  }

  async function openFile(filePath: string) {
    if (!workspacePath) return;
    const content = await desktopApi.readFile(filePath, workspacePath);
    setSelectedFilePath(filePath);
    upsertOpenFile(filePath, content);
    setActiveTabPath(filePath);
  }

  async function saveActiveFile() {
    if (!workspacePath || !activeFile) return;
    await desktopApi.writeFile(activeFile.path, activeFile.content, workspacePath);
    upsertOpenFile(activeFile.path, activeFile.content, false);
    await refreshTree();
  }

  async function runSearch(query: string) {
    if (!workspacePath || !query.trim()) {
      setSearchResults([]);
      return;
    }
    const results = await desktopApi.searchWorkspace(workspacePath, query);
    setSearchResults(results);
  }

  async function runTerminal(command: string) {
    if (!workspacePath || !command.trim()) return;
    setTerminalOutput(`> ${command}\n`);
    setTerminalRunning(true);
    await desktopApi.startTerminal(TERMINAL_ID, command, workspacePath);
  }

  async function sendChat(text: string) {
    if (!settings?.apiKey) {
      pushChatMessage({
        id: uid(),
        role: "system",
        content: "请先在设置里配置 API Key。",
        createdAt: Date.now(),
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    const history: ChatMessage[] = [...chatMessages, userMessage];
    pushChatMessage(userMessage);
    clearToolTraces();
    setChatLoading(true);

    const assistantId = uid();
    let assistantText = "";
    pushChatMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    });

    try {
      for await (const event of runAgentConversation(
        settings,
        history.map((item) => ({ role: item.role === "system" ? "assistant" : item.role, content: item.content })) as Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }>,
        workspacePath,
      )) {
        if (event.type === "token") {
          assistantText += event.text;
          updateChatMessage(assistantId, assistantText);
        }
        if (event.type === "done") assistantText = event.text || assistantText;
        if (event.type === "tool_start") {
          addToolTrace({
            id: event.id,
            name: event.name,
            status: "start",
            detail: event.detail,
          });
        }
        if (event.type === "tool_end") {
          addToolTrace({
            id: event.id,
            name: event.name,
            status: "done",
            detail: event.detail,
            elapsedMs: event.elapsedMs,
          });
        }
        if (event.type === "tool_error") {
          addToolTrace({
            id: event.id,
            name: event.name,
            status: "error",
            detail: event.detail,
          });
        }
      }
    } catch (error) {
      assistantText = error instanceof Error ? error.message : String(error);
    } finally {
      updateChatMessage(assistantId, assistantText || "(empty response)");
      setChatLoading(false);
    }
  }

  async function applyPatchPreview() {
    if (!activeFile) return;
    const patch = parsePatchFromText(patchPreview);
    if (!patch) return;
    const next = applySimplePatch(activeFile.content, patch);
    upsertOpenFile(activeFile.path, next, true);
    closePatchPreview();
  }

  async function askAction(prompt: string) {
    if (!activeFile) return;
    await sendChat(`${prompt}\n\n文件路径: ${activeFile.path}\n\n内容:\n${activeFile.content}`);
  }

  async function askPatch() {
    if (!activeFile) return;
    await sendChat(
      [
        "请基于下面代码返回 JSON patch（search/replace）.",
        "格式: {\"search\":\"...\",\"replace\":\"...\"}",
        `路径: ${activeFile.path}`,
        "```",
        activeFile.content,
        "```",
      ].join("\n"),
    );

    const latest = useAppStore.getState().chatMessages.at(-1);
    if (!latest) return;
    const patch = parsePatchFromText(latest.content);
    if (patch) {
      openPatchPreview(JSON.stringify(patch, null, 2), activeFile.path);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="title">CursorLite (Windows MVP)</div>
        <div className="topbar-actions">
          <button onClick={() => setSettingsVisible(true)}>模型设置</button>
          <button onClick={openWorkspace}>打开项目</button>
        </div>
      </header>

      <Group orientation="horizontal">
        <Panel defaultSize={22} minSize={14}>
          <WorkspaceTree
            tree={tree}
            workspacePath={workspacePath}
            selectedFilePath={selectedFilePath}
            searchResults={searchResults}
            onOpenWorkspace={openWorkspace}
            onRefresh={refreshTree}
            onFileClick={openFile}
            onSearch={runSearch}
          />
        </Panel>
        <Separator className="resize-handle" />
        <Panel defaultSize={50} minSize={35}>
          <Group orientation="vertical">
            <Panel defaultSize={72} minSize={50}>
              <EditorPane
                openFiles={openFileList}
                activeTabPath={activeTabPath}
                activeFile={activeFile}
                onTabSelect={setActiveTabPath}
                onChange={(value) => {
                  if (!activeFile) return;
                  upsertOpenFile(activeFile.path, value, true);
                }}
                onSave={saveActiveFile}
                onActionExplain={() => askAction("请解释这段代码的作用和潜在风险。")}
                onActionRefactor={() => askAction("请给出这段代码的重构建议，包含收益和风险。")}
                onActionPatch={askPatch}
              />
            </Panel>
            <Separator className="resize-handle horizontal" />
            <Panel defaultSize={28} minSize={20}>
              <TerminalPanel
                output={terminalOutput}
                running={terminalRunning}
                onRun={runTerminal}
                onStop={() => desktopApi.stopTerminal(TERMINAL_ID)}
                onClear={() => setTerminalOutput("")}
              />
            </Panel>
          </Group>
        </Panel>
        <Separator className="resize-handle" />
        <Panel defaultSize={28} minSize={18}>
          <ChatPanel messages={chatMessages} toolTraces={toolTraces} loading={chatLoading} onSend={sendChat} onClear={clearChat} />
        </Panel>
      </Group>

      <SettingsModal
        visible={settingsVisible}
        initialSettings={settings}
        onClose={() => setSettingsVisible(false)}
        onSave={(next) => {
          setSettings(next);
          void desktopApi.saveSettings(next);
        }}
      />
      <PatchPreviewModal
        visible={patchVisible}
        patchText={patchPreview}
        targetPath={patchTargetPath}
        onCancel={closePatchPreview}
        onApply={applyPatchPreview}
      />
    </div>
  );
}
