import MonacoEditor from "@monaco-editor/react";
import { useMemo } from "react";
import type { OpenFile } from "../../store/useAppStore";

type Props = {
  openFiles: OpenFile[];
  activeTabPath: string;
  activeFile: OpenFile | null;
  onTabSelect: (path: string) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onActionExplain: () => void;
  onActionRefactor: () => void;
  onActionPatch: () => void;
};

function getLanguageByPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "typescript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".v")) return "verilog";
  if (lower.endsWith(".py")) return "python";
  return "plaintext";
}

export function EditorPane({
  openFiles,
  activeTabPath,
  activeFile,
  onTabSelect,
  onChange,
  onSave,
  onActionExplain,
  onActionRefactor,
  onActionPatch,
}: Props) {
  const language = useMemo(
    () => (activeFile ? getLanguageByPath(activeFile.path) : "plaintext"),
    [activeFile],
  );

  if (!activeFile) {
    return (
      <section className="editor-pane empty">
        <div>请选择左侧文件开始编辑</div>
      </section>
    );
  }

  return (
    <section className="editor-pane">
      <div className="editor-tabs">
        {openFiles.map((file) => (
          <button
            key={file.path}
            className={`editor-tab ${file.path === activeTabPath ? "active" : ""}`}
            onClick={() => onTabSelect(file.path)}
          >
            {file.path.split(/[\\/]/).at(-1)}
            {file.dirty ? " *" : ""}
          </button>
        ))}
      </div>
      <div className="editor-toolbar">
        <div className="file-name">{activeFile.path}</div>
        <div className="editor-actions">
          <button onClick={onActionExplain}>解释选区</button>
          <button onClick={onActionRefactor}>重构建议</button>
          <button onClick={onActionPatch}>生成补丁</button>
          <button onClick={onSave}>保存</button>
        </div>
      </div>
      <div className="editor-body">
        <MonacoEditor
          height="100%"
          language={language}
          value={activeFile.content}
          onChange={(value) => onChange(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
          }}
          theme="vs-dark"
        />
      </div>
    </section>
  );
}
