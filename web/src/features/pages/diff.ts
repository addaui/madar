// SPDX-License-Identifier: Apache-2.0
/** Comparing two versions of a page (ADR 0093): blocks are matched by their id (else by their text), and inside a block that changed, words are. */
type Node = { type?: string; text?: string; attrs?: { blockId?: string }; content?: Node[] };
export type Word = { op: "same" | "added" | "removed"; text: string };
export type BlockDiff = { kind: "same" | "added" | "removed" | "changed"; text: string; words?: Word[] };

const textOf = (n: Node): string => (n.type === "text" ? n.text ?? "" : n.type === "hardBreak" ? "\n" : (n.content ?? []).map(textOf).join(n.type === "doc" || n.content?.some((c) => c.type !== "text" && c.type !== "hardBreak") ? "\n" : ""));

/** The longest common subsequence of two lists, as pairs of indexes. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length, m = b.length, t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = eq(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
  }
  return out;
}

export function compareWords(a: string, b: string): Word[] {
  const ta = a.match(/\s*\S+/g) ?? [], tb = b.match(/\s*\S+/g) ?? [];
  const same = lcs(ta, tb, (x, y) => x.trim() === y.trim());
  const out: Word[] = [];
  let i = 0, j = 0;
  for (const [x, y] of [...same, [ta.length, tb.length] as [number, number]]) {
    while (i < x) out.push({ op: "removed", text: ta[i++] });
    while (j < y) out.push({ op: "added", text: tb[j++] });
    if (x < ta.length) { out.push({ op: "same", text: tb[y] }); i++; j++; }
  }
  return out;
}

/** The blocks of `after` against those of `before`, in reading order. */
export function compareDocs(before: unknown, after: unknown): BlockDiff[] {
  const a = ((before as Node)?.content ?? []).map((n) => ({ id: n.attrs?.blockId, text: textOf(n) }));
  const b = ((after as Node)?.content ?? []).map((n) => ({ id: n.attrs?.blockId, text: textOf(n) }));
  const key = (x: { id?: string; text: string }) => (x.id ? "#" + x.id : x.text);
  const pairs = lcs(a, b, (x, y) => key(x) === key(y));
  const out: BlockDiff[] = [];
  let i = 0, j = 0;
  const flush = (x: number, y: number) => {
    const gone = a.slice(i, x), fresh = b.slice(j, y);
    // blocks without ids that were edited: removed then added in the same place reads as one changed block
    const n = Math.min(gone.length, fresh.length);
    for (let k = 0; k < n && !gone[k].id && !fresh[k].id; k++) { out.push({ kind: "changed", text: fresh[k].text, words: compareWords(gone[k].text, fresh[k].text) }); gone[k] = null as never; fresh[k] = null as never; }
    for (const g of gone) if (g) out.push({ kind: "removed", text: g.text });
    for (const f of fresh) if (f) out.push({ kind: "added", text: f.text });
    i = x; j = y;
  };
  for (const [x, y] of pairs) {
    flush(x, y);
    out.push(a[x].text === b[y].text ? { kind: "same", text: b[y].text } : { kind: "changed", text: b[y].text, words: compareWords(a[x].text, b[y].text) });
    i = x + 1; j = y + 1;
  }
  flush(a.length, b.length);
  return out;
}
