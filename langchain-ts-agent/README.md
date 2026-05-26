# LangChain TypeScript Simple Agent

这是一个可运行的 TypeScript + LangChain Agent 升级示例，支持：

- 命令行提问 + 连续对话记忆
- 查时间工具
- 本地文档问答（RAG）版本

## 1. 安装依赖

```bash
npm install
```

## 2. 配置密钥

复制环境变量模板并填写 DeepSeek Key：

```bash
copy .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=your_deepseek_key
```

## 3. 基础 Agent（聊天 + 工具）

### 方式 A：连续对话模式（推荐）

```bash
npm run dev
```

启动后可连续提问，输入 `exit` 退出。

### 方式 B：单轮命令模式

```bash
npm run dev -- "请计算 88 * 13，并说明过程"
```

## 4. RAG Agent（本地文档问答）

默认会读取 `knowledge/` 目录中的 `.md/.txt/.v` 文件构建本地向量检索。

### 方式 A：连续对话模式

```bash
npm run dev:rag
```

### 方式 B：单轮命令模式

```bash
npm run dev:rag -- "这个项目默认模型是什么？请给出来源"
```

## 5. 环境变量

`.env` 可配置：

```env
DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
OPENAI_EMBED_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=
EMBEDDING_BASE_URL=
KNOWLEDGE_DIR=knowledge
```

说明：
- 聊天模型默认使用 DeepSeek。
- RAG 的 embedding 默认也会复用 DeepSeek Key（如需单独供应商，可填 `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL`）。

## 6. 功能说明

- `multiply_numbers`：数学乘法工具，Agent 会优先调用它完成计算。
- `current_time`：时区时间工具，例如 `Asia/Shanghai`、`UTC`。
- 连续对话：默认进入交互式聊天，会保存本轮会话历史用于上下文回答。
- 单轮模式：通过命令行参数传入问题后，执行一次并退出。
- `local_doc_search`：RAG 检索工具，从本地文档中召回相关片段并返回来源文件名。

## 7. 示例问题

```bash
npm run dev -- "请计算 17 * 29 并解释过程"
npm run dev -- "现在 UTC 时间是多少？"
npm run dev:rag -- "这个项目默认模型是什么？来源是哪个文件？"
```
