const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function printBanner(title: string, subtitle: string) {
  const line = "=".repeat(56);
  console.log(`\n${colorize(line, DIM)}`);
  console.log(`${colorize("  " + title, MAGENTA)}`);
  console.log(`${colorize("  " + subtitle, DIM)}`);
  console.log(`${colorize(line, DIM)}\n`);
}

export function userPromptLabel(): string {
  return `${colorize("你", CYAN)} > `;
}

export function infoLine(message: string) {
  console.log(colorize(message, DIM));
}

export async function withSpinner<T>(
  label: string,
  task: () => Promise<T>,
): Promise<T> {
  if (!process.stdout.isTTY) return task();

  const frames = ["-", "\\", "|", "/"];
  let i = 0;
  process.stdout.write(`${colorize(frames[i] ?? "-", YELLOW)} ${label}`);

  const timer = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${colorize(frames[i] ?? "-", YELLOW)} ${label}`);
  }, 90);

  try {
    const result = await task();
    clearInterval(timer);
    process.stdout.write(
      `\r${colorize("OK", GREEN)} ${label}${" ".repeat(12)}\n`,
    );
    return result;
  } catch (error) {
    clearInterval(timer);
    process.stdout.write(
      `\r${colorize("ERR", YELLOW)} ${label}${" ".repeat(12)}\n`,
    );
    throw error;
  }
}

export async function printAgentReply(label: string, text: string) {
  const finalText = text.trim() || "(empty response)";
  const prefix = `\n${colorize(label, GREEN)} > `;

  if (!process.stdout.isTTY || finalText.length > 700) {
    console.log(`${prefix}${finalText}`);
    return;
  }

  process.stdout.write(prefix);
  for (const char of finalText) {
    process.stdout.write(char);
    await sleep(6);
  }
  process.stdout.write("\n");
}

function shortenText(value: unknown, maxLength = 120): string {
  let normalized: unknown = value;

  if (typeof normalized === "object" && normalized !== null) {
    const maybeInput = (normalized as { input?: unknown }).input;
    if (typeof maybeInput === "string") {
      try {
        normalized = JSON.parse(maybeInput);
      } catch {
        normalized = maybeInput;
      }
    }

    const maybeContent = (normalized as { kwargs?: { content?: unknown } }).kwargs
      ?.content;
    if (typeof maybeContent === "string" && maybeContent.trim()) {
      normalized = maybeContent;
    }
  }

  const text =
    typeof normalized === "string"
      ? normalized
      : JSON.stringify(normalized, null, 0) || String(normalized);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function beginStreamReply(label: string) {
  process.stdout.write(`\n${colorize(label, GREEN)} > `);
}

export function writeStreamToken(token: string) {
  process.stdout.write(token);
}

export function endStreamReply() {
  process.stdout.write("\n");
}

export function printToolStart(toolName: string, inputValue: unknown) {
  const payload = shortenText(inputValue);
  console.log(
    `${colorize("TOOL", CYAN)} ${toolName} ${colorize("start", YELLOW)} ${colorize(payload, DIM)}`,
  );
}

export function printToolEnd(
  toolName: string,
  durationMs: number,
  outputValue: unknown,
) {
  const payload = shortenText(outputValue);
  console.log(
    `${colorize("TOOL", CYAN)} ${toolName} ${colorize(`done ${durationMs}ms`, GREEN)} ${colorize(payload, DIM)}`,
  );
}

export function printToolError(toolName: string, errorValue: unknown) {
  const payload = shortenText(errorValue);
  console.log(
    `${colorize("TOOL", CYAN)} ${toolName} ${colorize("error", RED)} ${colorize(payload, DIM)}`,
  );
}

export function startThinking(label = "思考中"): () => void {
  if (!process.stdout.isTTY) return () => {};

  const frames = ["-", "\\", "|", "/"];
  let i = 0;
  process.stdout.write(`\r${colorize(frames[i] ?? "-", YELLOW)} ${label}`);

  const timer = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${colorize(frames[i] ?? "-", YELLOW)} ${label}`);
  }, 90);

  return () => {
    clearInterval(timer);
    process.stdout.write(`\r${" ".repeat(label.length + 8)}\r`);
  };
}
