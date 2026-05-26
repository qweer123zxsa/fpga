import { useState } from "react";

type Props = {
  output: string;
  running: boolean;
  onRun: (command: string) => void;
  onStop: () => void;
  onClear: () => void;
};

export function TerminalPanel({ output, running, onRun, onStop, onClear }: Props) {
  const [command, setCommand] = useState("npm run build");

  return (
    <section className="terminal-pane">
      <div className="terminal-header">
        <strong>Terminal</strong>
        <div className="terminal-actions">
          <button onClick={onClear}>清空</button>
          {running ? (
            <button onClick={onStop}>停止</button>
          ) : (
            <button onClick={() => onRun(command)}>运行</button>
          )}
        </div>
      </div>
      <div className="terminal-input-row">
        <input
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="输入命令后运行"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !running) onRun(command);
          }}
        />
      </div>
      <pre className="terminal-output">{output || "终端输出将显示在这里..."}</pre>
    </section>
  );
}
