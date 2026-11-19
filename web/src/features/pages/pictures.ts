import type { EditorJson } from "./PageEditor";

/**
 * Pictures in a page come from this server's files, never from another site (ADR 0077): a viewer's browser must not contact a stranger because a page said so.
 * A picture at another address is fetched once by the Core, stored in the Space's files, and the page points at that copy. These are the pure parts; the
 * network parts (`links.fetch`, `files.upload`) are handed in.
 */

/** An address in this Space's files: `/files/<id>`. */
export const isOwnPicture = (u: unknown): u is string => typeof u === "string" && /^\/files\/[\w.-]+$/.test(u);
/** An `http(s)` address on another site. */
export const isRemote = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

export interface Remote { path: number[]; attr: "src" | "image" | "icon"; url: string }

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[] };
const PICTURE_ATTRS: Record<string, ("src" | "image" | "icon")[]> = { image: ["src"], linkPreview: ["image", "icon"] };

/** Every picture in a document that is at another site, with where it is. (A video embed's address is an embed, not a picture: ADR 0077 point 8.) */
export function remotePictures(doc: EditorJson | null | undefined): Remote[] {
  const out: Remote[] = [];
  const go = (n: Node, path: number[]) => {
    for (const attr of PICTURE_ATTRS[n.type] ?? []) { const v = n.attrs?.[attr]; if (isRemote(v)) out.push({ path, attr, url: v }); }
    (n.content ?? []).forEach((c, i) => go(c, [...path, i]));
  };
  if (doc) go(doc as unknown as Node, []);
  return out;
}

/** The document with each remote picture replaced by what `to` says for its address (a new address, or `""` to drop a card's picture); one `to` has no entry for stays. */
export function withPictures(doc: EditorJson, to: Record<string, string>): EditorJson {
  const go = (n: Node): Node => {
    let out = n;
    for (const attr of PICTURE_ATTRS[n.type] ?? []) {
      const v = n.attrs?.[attr];
      if (isRemote(v) && v in to) out = { ...out, attrs: { ...out.attrs, [attr]: to[v] } };
    }
    return out.content ? { ...out, content: out.content.map(go) } : out;
  };
  return go(doc as unknown as Node) as unknown as EditorJson;
}

export interface Importer { fetch(url: string): Promise<{ data: string; name: string; content_type: string }>; upload(file: File): Promise<{ url: string }> }
const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Fetches a picture through the Core and stores it in the files; resolves with its `/files/<id>` address, or `null` when it could not be (never the remote address). */
export async function importPicture(url: string, io: Importer): Promise<string | null> {
  try {
    const f = await io.fetch(url);
    const stored = await io.upload(new File([bytesOf(f.data)], f.name, { type: f.content_type }));
    return isOwnPicture(stored.url) ? stored.url : null;
  } catch { return null; }
}

/**
 * Imports every remote picture of a document, a few at a time, each address once. Resolves with the rewritten document and how many were imported and how many could not
 * be (those keep their address in the data, so nothing is lost, and the editor does not draw them).
 */
export async function importRemote(doc: EditorJson, io: Importer, { parallel = 3, only }: { parallel?: number; only?: string[] } = {}): Promise<{ doc: EditorJson; imported: number; failed: number }> {
  const urls = [...new Set(remotePictures(doc).map((r) => r.url))].filter((u) => !only || only.includes(u));
  const to: Record<string, string> = {};
  let failed = 0, next = 0;
  await Promise.all(Array.from({ length: Math.min(parallel, urls.length) }, async () => {
    while (next < urls.length) {
      const url = urls[next++]!;
      const got = await importPicture(url, io);
      if (got) to[url] = got; else failed++;
    }
  }));
  return { doc: Object.keys(to).length ? withPictures(doc, to) : doc, imported: Object.keys(to).length, failed };
}
