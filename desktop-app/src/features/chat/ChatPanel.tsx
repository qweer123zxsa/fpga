import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "../../store/useAppStore";

type ToolTrace = {
  id: string;
  name: string;
  status: "start" | "done" | "error";
  detail: string;
  elapsedMs?: number;
};

type Props = {
  messages: ChatMessage[];
  toolTraces: ToolTrace[];
  loading: boolean;
  onSend: (text: string) => void;
  onClear: () => void;
};

export function ChatPanel({ messages, toolTraces, loading, onSend, onClear }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastToolEvent = useMemo(() => toolTraces.at(-1), [toolTraces]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, toolTraces]);

  return (
    <section className="chat-pane">
      <div className="chat-header">
        <strong>AI Assistant</strong>
        <button onClick={onClear}>清空会话</button>
      </div>

      <div className="chat-body" ref={scrollRef}>
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            <div className="message-role">{message.role}</div>
            <div className="message-content">{message.content}</div>
          </div>
        ))}

        {toolTraces.map((trace) => (
          <div className={`tool-trace ${trace.status}`} key={`${trace.id}-${trace.status}`}>
            <strong>Tool {trace.name}</strong>
            <span>{trace.status}</span>
            {trace.elapsedMs !== undefined && <span>{trace.elapsedMs}ms</span>}
            <pre>{trace.detail}</pre>
          </div>
        ))}
      </div>

      <div className="chat-footer">
        {loading && <div className="chat-status">模型处理中...</div>}
        {!loading && lastToolEvent && (
          <div className="chat-status">
            最近工具: {lastToolEvent.name} / {lastToolEvent.status}
          </div>
        )}
        <textarea
          value={input}
          placeholder="输入问题，支持让 AI 解释/搜索工程..."
          onChange={(event) => setInput(event.target.value)}
          rows={4}
        />
        <button
          onClick={() => {
            const text = input.trim();
            if (!text) return;
            onSend(text);
            setInput("");
          }}
          disabled={loading}
        >
          发送
        </button>
      </div>
    </section>
  );
}
