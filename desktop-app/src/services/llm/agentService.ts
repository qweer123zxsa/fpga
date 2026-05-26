import type { AppSettings } from "../../types/electron";

export type AgentInputMessage = { role: "system" | "user" | "assistant"; content: string };

type ToolEvent =
  | { type: "tool_start"; name: string; detail: string; id: string }
  | { type: "tool_end"; name: string; detail: string; id: string; elapsedMs: number }
  | { type: "tool_error"; name: string; detail: string; id: string };

export type AgentEvent =
  | { type: "token"; text: string }
  | { type: "done"; text: string }
  | ToolEvent;

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | { role: "tool"; content: string; tool_call_id: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

const tools = [
  {
    type: "function" as const,
    function: {
      name: "current_time",
      description: "获取指定时区当前时间",
      parameters: {
        type: "object",
        properties: {
          timezone: { type: "string", description: "IANA timezone like Asia/Shanghai" },
        },
        required: ["timezone"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "multiply_numbers",
      description: "计算两个数字相乘",
      parameters: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["a", "b"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_workspace",
      description: "在当前工程中全文检索关键词，返回匹配列表",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
];

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function runTool(
  call: ToolCall,
  workspacePath: string,
): Promise<{ output: string; event: ToolEvent }> {
  const started = Date.now();
  const args = parseArgs(call.function.arguments);

  try {
    if (call.function.name === "current_time") {
      const timezone = String(args.timezone ?? "Asia/Shanghai");
      const text = new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      }).format(new Date());
      return {
        output: text,
        event: {
          type: "tool_end",
          name: call.function.name,
          detail: text,
          id: call.id,
          elapsedMs: Date.now() - started,
        },
      };
    }

    if (call.function.name === "multiply_numbers") {
      const a = Number(args.a ?? 0);
      const b = Number(args.b ?? 0);
      const text = `${a} * ${b} = ${a * b}`;
      return {
        output: text,
        event: {
          type: "tool_end",
          name: call.function.name,
          detail: text,
          id: call.id,
          elapsedMs: Date.now() - started,
        },
      };
    }

    if (call.function.name === "search_workspace") {
      if (!workspacePath) throw new Error("workspace is not opened");
      const query = String(args.query ?? "");
      const results = await window.desktopApi.searchWorkspace(workspacePath, query);
      const text =
        results.length === 0
          ? "未找到匹配"
          : results
              .slice(0, 20)
              .map((item) => `${item.filePath}:${item.line}: ${item.preview}`)
              .join("\n");
      return {
        output: text,
        event: {
          type: "tool_end",
          name: call.function.name,
          detail: text,
          id: call.id,
          elapsedMs: Date.now() - started,
        },
      };
    }

    throw new Error(`unknown tool: ${call.function.name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: `tool error: ${message}`,
      event: {
        type: "tool_error",
        name: call.function.name,
        detail: message,
        id: call.id,
      },
    };
  }
}

async function requestChatCompletion(
  settings: AppSettings,
  messages: ChatMessage[],
  stream = false,
) {
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
      stream,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM request failed: ${response.status} ${text}`);
  }

  return response;
}

async function* streamResponse(
  response: Response,
): AsyncGenerator<{ token: string; done?: boolean }, string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8");
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return fullText;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const token = parsed.choices?.[0]?.delta?.content ?? "";
        if (!token) continue;
        fullText += token;
        yield { token };
      } catch {
        // ignore malformed chunks
      }
    }
  }

  return fullText;
}

export async function* runAgentConversation(
  settings: AppSettings,
  history: AgentInputMessage[],
  workspacePath: string,
): AsyncGenerator<AgentEvent> {
  const systemPrompt =
    "You are a coding assistant inside a desktop IDE. Be concise and helpful. " +
    "When a workspace query is needed, use search_workspace tool.";
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...history];

  for (let round = 0; round < 3; round += 1) {
    const response = await requestChatCompletion(settings, messages, false);
    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: ToolCall[];
        };
      }>;
    };

    const message = data.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    const textContent = message?.content ?? "";
    messages.push({ role: "assistant", content: textContent });

    if (toolCalls.length === 0) {
      const streamRes = await requestChatCompletion(settings, messages, true);
      let fullText = "";
      for await (const chunk of streamResponse(streamRes)) {
        fullText += chunk.token;
        yield { type: "token", text: chunk.token };
      }
      yield { type: "done", text: fullText };
      return;
    }

    for (const call of toolCalls) {
      yield { type: "tool_start", name: call.function.name, detail: call.function.arguments, id: call.id };
      const result = await runTool(call, workspacePath);
      yield result.event;
      messages.push({ role: "tool", content: result.output, tool_call_id: call.id });
    }
  }

  yield { type: "done", text: "工具调用轮次已达上限，请尝试更明确的问题。" };
}
