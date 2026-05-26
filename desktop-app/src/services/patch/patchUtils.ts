export type SimplePatch = {
  search: string;
  replace: string;
};

export function applySimplePatch(original: string, patch: SimplePatch): string {
  if (!patch.search) return original;
  return original.replace(patch.search, patch.replace);
}

export function parsePatchFromText(raw: string): SimplePatch | null {
  const match = raw.match(/```json([\s\S]*?)```/i);
  const payload = match ? match[1] : raw;
  try {
    const parsed = JSON.parse(payload) as Partial<SimplePatch>;
    if (typeof parsed.search !== "string" || typeof parsed.replace !== "string") return null;
    return { search: parsed.search, replace: parsed.replace };
  } catch {
    return null;
  }
}
