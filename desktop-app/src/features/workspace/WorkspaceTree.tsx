import { useMemo, useState } from "react";
import type { FileNode } from "../../types/electron";
import { ChevronRight, FolderOpen, Search } from "lucide-react";

type Props = {
  tree: FileNode[];
  workspacePath: string;
  selectedFilePath: string;
  searchResults: Array<{ filePath: string; line: number; preview: string }>;
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onFileClick: (filePath: string) => void;
  onSearch: (query: string) => void;
};

type TreeNodeProps = {
  node: FileNode;
  depth: number;
  selectedFilePath: string;
  onFileClick: (filePath: string) => void;
};

function TreeNode({ node, depth, selectedFilePath, onFileClick }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isSelected = selectedFilePath === node.path;

  if (node.type === "file") {
    return (
      <button
        className={`tree-item file ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onFileClick(node.path)}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div className="tree-group">
      <button
        className="tree-item folder"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => setExpanded((value) => !value)}
      >
        <ChevronRight size={14} className={expanded ? "expanded" : ""} />
        <FolderOpen size={14} />
        {node.name}
      </button>
      {expanded &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFilePath={selectedFilePath}
            onFileClick={onFileClick}
          />
        ))}
    </div>
  );
}

export function WorkspaceTree({
  tree,
  workspacePath,
  selectedFilePath,
  searchResults,
  onOpenWorkspace,
  onRefresh,
  onFileClick,
  onSearch,
}: Props) {
  const [searchText, setSearchText] = useState("");
  const hasWorkspace = Boolean(workspacePath);
  const fileCount = useMemo(() => searchResults.length, [searchResults.length]);

  return (
    <section className="workspace-pane">
      <div className="workspace-header">
        <strong>Workspace</strong>
        <div className="workspace-actions">
          <button onClick={onOpenWorkspace}>Open</button>
          <button onClick={onRefresh} disabled={!hasWorkspace}>
            Refresh
          </button>
        </div>
      </div>

      <div className="workspace-path">{workspacePath || "未打开项目目录"}</div>

      <label className="search-box">
        <Search size={14} />
        <input
          value={searchText}
          placeholder="rg 搜索..."
          onChange={(event) => {
            const value = event.target.value;
            setSearchText(value);
            if (value.trim().length >= 2) onSearch(value);
            if (!value.trim()) onSearch("");
          }}
        />
      </label>

      {searchText.trim().length >= 2 && (
        <div className="search-results">
          <div className="search-title">匹配结果 {fileCount}</div>
          {searchResults.slice(0, 30).map((result) => (
            <button
              key={`${result.filePath}-${result.line}-${result.preview}`}
              className="search-item"
              onClick={() => onFileClick(result.filePath)}
            >
              <div className="search-file">{result.filePath}</div>
              <div className="search-preview">
                {result.line}: {result.preview}
              </div>
            </button>
          ))}
        </div>
      )}

      {searchText.trim().length < 2 && (
        <div className="tree-scroll">
          {tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </section>
  );
}
