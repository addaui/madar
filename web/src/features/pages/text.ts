/** The plain text of a page body (ProseMirror JSON): blocks on their own lines; an element gives its Fallback's text (ADR 0094). */
export function textOf(doc: unknown): string {
  const out: string[] = [];
  const go = (n: { type?: string; text?: string; content?: unknown[]; attrs?: { fallback?: { text?: string } | null } } | null | undefined) => {
    if (!n || typeof n !== "object") return;
    if (n.text) out.push(n.text);
    if ((n.type === "element" || n.type === "elementInline") && n.attrs?.fallback?.text) out.push(n.attrs.fallback.text);
    (n.content ?? []).forEach((c) => go(c as never));
    if (n.type && n.type !== "text" && n.type !== "doc" && n.type !== "elementInline" && n.type !== "hardBreak") out.push("\n");
  };
  go(doc as never);
  return out.join("").replace(/\n{2,}/g, "\n").trim();
}
