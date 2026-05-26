import "dotenv/config";
import { z } from "zod";
import { createAgent, tool } from "langchain";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
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

const SUPPORTED_EXTENSIONS = new Set([".md", ".txt", ".v"]);

const multiplyTool = tool(
  async ({ a, b }) => `${a} * ${b} = ${a * b}`,
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

function getProjectRoot(): string {
  const currentFileDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentFileDir, "..");
}

function getKnowledgeDir(): string {
  const customDir = process.env.KNOWLEDGE_DIR?.trim();
  if (customDir) {
    return path.isAbsolute(customDir)
      ? customDir
      : path.resolve(getProjectRoot(), customDir);
  }
  return path.resolve(getProjectRoot(), "knowledge");
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function loadLocalDocuments(knowledgeDir: string): Promise<Document[]> {
  const files = await walkFiles(knowledgeDir);
  if (files.length === 0) {
    throw new Error(
      `知识库目录为空：${knowledgeDir}。请先放入 .md/.txt/.v 文件后再运行。`,
    );
  }

  const docs = await Promise.all(
    files.map(async (filePath) => {
      const content = await fs.readFile(filePath, "utf-8");
      return new Document({
        pageContent: content,
        metadata: {
          source: path.relative(knowledgeDir, filePath).replaceAll("\\", "/"),
        },
      });
    }),
  );

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 800,
    chunkOverlap: 120,
  });
  return splitter.splitDocuments(docs);
}

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
  const stopThinking = startThinking("RAG 检索与思考中");
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
        beginStreamReply("RAG Agent");
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
    await printAgentReply("RAG Agent", fallback);
  }
  return fallback;
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

async function buildRagTool(knowledgeDir: string) {
  const splitDocs = await loadLocalDocuments(knowledgeDir);
  const embeddingApiKey =
    process.env.EMBEDDING_API_KEY ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY;
  if (!embeddingApiKey) {
    throw new Error(
      "缺少 Embedding API Key。请设置 EMBEDDING_API_KEY 或 DEEPSEEK_API_KEY。",
    );
  }

  const embeddings = new OpenAIEmbeddings({
    model: process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small",
    apiKey: embeddingApiKey,
    configuration: {
      baseURL:
        process.env.EMBEDDING_BASE_URL ||
        process.env.DEEPSEEK_BASE_URL ||
        "https://api.deepseek.com/v1",
    },
  });
  const vectorStore = await MemoryVectorStore.fromDocuments(splitDocs, embeddings);

  return tool(
    async ({ query, topK }) => {
      const matched = await vectorStore.similaritySearch(query, topK);
      if (matched.length === 0) {
        return "知识库中未检索到相关内容。";
      }

      return matched
        .map((doc: Document, index: number) => {
          const source = String(doc.metadata?.source ?? "unknown");
          return `【片段${index + 1} | 来源: ${source}】\n${doc.pageContent}`;
        })
        .join("\n\n");
    },
    {
      name: "local_doc_search",
      description:
        "Search local knowledge base and return relevant text snippets with source names.",
      schema: z.object({
        query: z.string().describe("Question or keywords for local document retrieval"),
        topK: z
          .number()
          .int()
          .min(1)
          .max(6)
          .default(3)
          .describe("How many chunks to retrieve"),
      }),
    },
  );
}

async function runSingleTurn(
  agent: ReturnType<typeof createAgent>,
  prompt: string,
) {
  const answer = await invokeWithLiveEffects(agent, [
    { role: "user", content: prompt },
  ]);
  if (answer === "(empty response)") infoLine("未获取到有效回复文本。");
}

async function runInteractiveChat(agent: ReturnType<typeof createAgent>) {
  const rl = readline.createInterface({ input, output });
  const history: { role: "user" | "assistant"; content: string }[] = [];

  printBanner("LangChain DeepSeek RAG Agent", "本地知识库问答已启动，输入 exit / quit / q 退出");

  try {
    while (true) {
      let question = "";
      try {
        question = (await rl.question(`\n${userPromptLabel()}`)).trim();
      } catch (error) {
        if (isAbortError(error)) {
          infoLine("\n已退出 RAG 对话。");
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
        console.error("本轮 RAG 请求失败:", error);
        continue;
      }

      history.push({ role: "user", content: question });
      history.push({ role: "assistant", content: answer });
    }
  } finally {
    rl.close();
  }
}

async function main() {
  const knowledgeDir = getKnowledgeDir();
  const ragTool = await buildRagTool(knowledgeDir);
  infoLine(`已加载本地知识库: ${knowledgeDir}`);

  const agent = createAgent({
    model: createDeepSeekModel(),
    tools: [multiplyTool, currentTimeTool, ragTool],
    systemPrompt:
      "You are a helpful assistant with local RAG. If the user asks about project/docs knowledge, call local_doc_search first and cite source names in your final answer.",
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
  console.error("RAG Agent 启动失败:", error);
  process.exit(1);
});
