export function stripFormatting(s: string): string {
  return s.replace(/§[0-9a-fk-or]/gi, '');
}

export function isValidUsername(name: string | undefined | null): name is string {
  if (!name) return false;
  return /^[A-Za-z0-9_]{1,16}$/.test(name);
}

/** Flattens a chat component tree into plain text (`text`, `translate`+`with`, `extra`). */
export function readText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return stripFormatting(node);
  if (Array.isArray(node)) return node.map((n) => readText(n)).join('');
  if (typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    let text = rec.text ? readText(rec.text) : '';
    if (rec.translate && typeof rec.translate === 'string') {
      text += stripFormatting(rec.translate);
    }
    if (Array.isArray(rec.with)) {
      text += rec.with.map((n: unknown) => readText(n)).join('');
    }
    if (rec.extra) {
      text += readText(rec.extra);
    }
    return text;
  }
  return '';
}

export function extractTextFromChatJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return readText(parsed);
  } catch {
    return stripFormatting(raw);
  }
}
