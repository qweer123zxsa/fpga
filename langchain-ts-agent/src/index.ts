import "dotenv/config";
import { z } from "zod";
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  beginStreamReply,
  endStreamReply,
  infoLine,
  printAgentReply,
  printToolEnd,
  printToolError,
  printToolStart,
  printBanner,
  startThinking,
  userPromptLabel,
  writeStreamToken,
} from "./ui.js";

const multiplyTool = tool(
  async ({ a, b }) => {
    return `${a} * ${b} = ${a * b}`;
  },
  {
    name: "multiply_numbers",
    description: "Multiply two numbers and return the equation result.",
    schema: z.object({
      a: z.number().describe("First number"),
      b: z.number().describe("Second number"),
    }),
  },
);

const currentTimeTool = tool(
  async ({ timezone }) => {
    const now = new Date();
    try {
      return new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      }).format(now);
    } catch {
      return `时区 ${timezone} 无效。请使用 IANA 时区名，比如 Asia/Shanghai。`;
    }
  },
  {
    name: "current_time",
    description:
      "Get the current local time in the specified IANA timezone, e.g. Asia/Shanghai.",
    schema: z.object({
      timezone: z
        .string()
        .describe("IANA timezone name, such as Asia/Shanghai or UTC"),
    }),
  },
);

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = String((error as { name?: unknown }).name ?? "");
  const code = String((error as { code?: unknown }).code ?? "");
  return name === "AbortError" || code === "ABORT_ERR";
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  const parts = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null) return "";
      if ("text" in part) return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.join("\n");
}

function getLastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as {
      role?: string;
      content?: unknown;
      type?: string;
      text?: unknown;
      _getType?: () => string;
    };

    const messageType = message.type || message._getType?.() || "";
    const isAssistant = message.role === "assistant" || messageType === "ai";
    if (!isAssistant) continue;

    const contentText = extractTextFromContent(message.content);
    if (contentText) return contentText;
    if (typeof message.text === "string" && message.text.trim()) {
      return message.text.trim();
    }
  }

  // Fallback: return any non-empty message text.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { content?: unknown; text?: unknown };
    const contentText = extractTextFromContent(message.content);
    if (contentText) return contentText;
    if (typeof message.text === "string" && message.text.trim()) {
      return message.text.trim();
    }
  }

  return "(empty response)";
}

function extractTokenFromChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  if (typeof chunk !== "object" || chunk === null) return "";

  const content = (chunk as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part !== "object" || part === null) return "";
      if ("text" in part) return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .join("");
}

async function invokeWithLiveEffects(
  agent: ReturnType<typeof createAgent>,
  messages: { role: "user" | "assistant"; content: string }[],
): Promise<string> {
  const stopThinking = startThinking("模型思考中");
  const toolStartedAt = new Map<string, number>();
  let streamedText = "";
  let streamOpened = false;
  let revealed = false;
  let finalMessages: unknown[] = [];

  const events = agent.streamEvents(
    { messages },
    { version: "v2" as const },
  ) as AsyncIterable<any>;

  for await (const event of events) {
    const eventName = String(event?.event ?? "");
    const runId = String(event?.run_id ?? event?.name ?? Math.random());

    if (eventName === "on_tool_start") {
      if (!revealed) {
        stopThinking();
        revealed = true;
      }
      toolStartedAt.set(runId, Date.now());
      printToolStart(String(event?.name ?? "tool"), event?.data?.input);
      continue;
    }

    if (eventName === "on_tool_end") {
      const start = toolStartedAt.get(runId) ?? Date.now();
      const elapsed = Math.max(1, Date.now() - start);
      printToolEnd(String(event?.name ?? "tool"), elapsed, event?.data?.output);
      continue;
    }

    if (eventName === "on_tool_error") {
      printToolError(String(event?.name ?? "tool"), event?.data?.error);
      continue;
    }

    if (eventName === "on_chat_model_stream") {
      const token = extractTokenFromChunk(event?.data?.chunk);
      if (!token) continue;
      if (!revealed) {
        stopThinking();
        revealed = true;
      }
      if (!streamOpened) {
        beginStreamReply("Agent");
        streamOpened = true;
      }
      streamedText += token;
      writeStreamToken(token);
      continue;
    }

    if (eventName === "on_chain_end") {
      const output = event?.data?.output;
      const maybeMessages = output?.messages;
      if (Array.isArray(maybeMessages)) finalMessages = maybeMessages;
    }
  }

  if (!revealed) stopThinking();
  if (streamOpened) endStreamReply();

  const normalized = streamedText.trim();
  if (normalized) return normalized;
  const fallback = getLastAssistantText(finalMessages);
  if (fallback && fallback !== "(empty response)") {
    await printAgentReply("Agent", fallback);
  }
  return fallback;
}

async function runSingleTurn(agent: ReturnType<typeof createAgent>, prompt: string) {
  const answer = await invokeWithLiveEffects(agent, [
    { role: "user", content: prompt },
  ]);
  if (answer === "(empty response)") infoLine("未获取到有效回复文本。");
}

async function runInteractiveChat(agent: ReturnType<typeof createAgent>) {
  const rl = readline.createInterface({ input, output });
  const history: { role: "user" | "assistant"; content: string }[] = [];

  printBanner("LangChain DeepSeek Agent", "连续对话已启动，输入 exit / quit / q 退出");

  try {
    while (true) {
      let question = "";
      try {
        question = (await rl.question(`\n${userPromptLabel()}`)).trim();
      } catch (error) {
        if (isAbortError(error)) {
          infoLine("\n已退出对话。");
          break;
        }
        throw error;
      }

      if (!question) continue;
      if (["exit", "quit", "q"].includes(question.toLowerCase())) break;

      let answer = "";
      try {
        answer = await invokeWithLiveEffects(agent, [
          ...history,
          { role: "user", content: question },
        ]);
      } catch (error) {
        console.error("本轮请求失败:", error);
        continue;
      }

      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: answer });
    }
  } finally {
    rl.close();
  }
}

function createDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "缺少 API Key。请在 .env 中设置 DEEPSEEK_API_KEY（或兼容使用 OPENAI_API_KEY）。",
    );
  }

  return new ChatOpenAI({
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    apiKey,
    temperature: 0.2,
    configuration: {
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    },
  });
}

async function main() {
  const agent = createAgent({
    model: createDeepSeekModel(),
    tools: [multiplyTool, currentTimeTool],
    systemPrompt:
      "You are a helpful assistant. Use tools for arithmetic and time requests whenever relevant.",
  });

  const cliInput = process.argv.slice(2).join(" ").trim();
  if (cliInput) {
    await runSingleTurn(agent, cliInput);
    return;
  }
  await runInteractiveChat(agent);
}

main().catch((error) => {
  if (isAbortError(error)) {
    infoLine("\n已退出。");
    process.exit(0);
  }
  console.error("Agent 启动失败:", error);
  process.exit(1);
});
