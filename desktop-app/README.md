# CursorLite Desktop (Windows MVP)

简化版 Cursor 桌面应用（Electron + React + TypeScript），当前实现如下核心能力：

- 打开本地工程目录，显示文件树并可刷新
- Monaco 代码编辑器 + 多标签切换 + 文件保存
- 右侧 AI 聊天面板（流式回复 + 工具调用轨迹）
- AI 编辑器动作（解释选区 / 重构建议 / 生成补丁预览并应用）
- 工程内全文搜索（ripgrep）
- 内置终端执行命令并查看输出
- 本地模型设置持久化（API Key / model / baseURL）

## 开发启动

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动：
- Vite 前端开发服务（5173）
- Electron 桌面窗口

## 构建

```bash
npm run build
```

产物：
- Web: `dist/`
- Electron main/preload: `dist-electron/`

## 打包 Windows 安装包

```bash
npm run dist
```

默认使用 `electron-builder` 产出 NSIS 安装包。

## 关键目录

- `electron/main.ts`: Electron 主进程、IPC、文件系统与终端能力
- `electron/preload.ts`: 安全桥接 API（`window.desktopApi`）
- `src/app/App.tsx`: 主布局与业务流编排
- `src/features/*`: 工作区/编辑器/聊天/终端/设置 UI 模块
- `src/services/llm/agentService.ts`: LLM 调用、流式处理、工具调用
- `src/services/patch/patchUtils.ts`: 补丁解析和应用
- `src/store/useAppStore.ts`: 全局状态管理

## 手工回归清单

1. 打开任意项目目录，确认文件树可展开
2. 打开并编辑文件，点击保存后磁盘内容更新
3. 在聊天面板发送问题，确认流式输出可见
4. 触发工具调用类问题（例如“17*29，顺便查上海时间”），确认工具轨迹显示
5. 运行编辑器动作“生成补丁”，确认补丁预览并能应用
6. 终端输入 `npm run build`，确认输出和退出码展示
