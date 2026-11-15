/**
 * The GIF client (ADR 0072): runs the descriptor a provider plugin gave (`gifs.provider`) directly from the browser, as the provider's terms ask. It knows
 * nothing about any one provider: the descriptor says which address to call, with which parameters, and where in the answer the results are.
 */
export interface GifRequest { url: string; query: Record<string, string>; max_limit?: number; max_query?: number }
export interface GifMap { list: string; total?: string; id: string; title?: string; preview: string | string[]; url: string | string[]; width?: string | string[]; height?: string | string[]; sent?: string }
export interface Descriptor {
  configured: boolean; id?: string; name?: string; mode?: "client";
  attribution?: { text: string; url: string };
  search?: GifRequest; trending?: GifRequest; sticker_search?: GifRequest; sticker_trending?: GifRequest; results?: GifMap;
}
export interface Gif { id: string; title: string; preview: string; url: string; width: number; height: number; sent?: string }

/** The value at a dotted path (`images.fixed_width.url`), or the first of a list of paths that has one. */
export function pick(obj: unknown, path: string | string[] | undefined): unknown {
  for (const p of Array.isArray(path) ? path : path ? [path] : []) {
    let v: unknown = obj;
    for (const k of p.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const https = (u: unknown): string | null => (typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u) && u.length <= 500 ? u : null);

export interface Vars { q?: string; limit: number; offset: number; lang: string }

/** The address to call: placeholders filled, a parameter whose placeholder has no value (a trending call has no `{q}`) left out, the length limits kept. */
export function buildUrl(req: GifRequest, v: Vars): string {
  const u = new URL(req.url);
  const vals: Record<string, string> = { q: (v.q ?? "").slice(0, req.max_query ?? 100), limit: String(Math.min(v.limit, req.max_limit ?? v.limit)), offset: String(Math.max(0, v.offset)), lang: v.lang };
  for (const [k, raw] of Object.entries(req.query)) {
    const m = /^\{(\w+)\}$/.exec(raw);
    const val = m ? vals[m[1]!] : raw;
    if (val !== undefined && val !== "") u.searchParams.set(k, val);
  }
  return u.toString();
}

/** The results of an answer as GIFs. One whose picture is not an https address, or that lacks an id, is left out. */
export function mapResults(d: Descriptor, body: unknown): { items: Gif[]; total: number } {
  const m = d.results;
  if (!m) return { items: [], total: 0 };
  const list = pick(body, m.list);
  const items: Gif[] = [];
  for (const r of Array.isArray(list) ? list : []) {
    const id = pick(r, m.id), preview = https(pick(r, m.preview)), url = https(pick(r, m.url)) ?? preview;
    if (typeof id !== "string" && typeof id !== "number") continue;
    if (!preview || !url) continue;
    items.push({ id: String(id), title: String(pick(r, m.title) ?? ""), preview, url, width: Number(pick(r, m.width)) || 200, height: Number(pick(r, m.height)) || 200, sent: https(pick(r, m.sent)) ?? undefined });
  }
  return { items, total: Number(pick(body, m.total)) || items.length };
}

export type GifCall = "search" | "trending" | "sticker_search" | "sticker_trending";

export async function fetchGifs(d: Descriptor, kind: GifCall, v: Vars, signal?: AbortSignal): Promise<{ items: Gif[]; total: number }> {
  const req = d[kind];
  if (!req) return { items: [], total: 0 };
  const res = await fetch(buildUrl(req, v), { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error("gifs " + res.status);
  return mapResults(d, await res.json());
}

/** Tells the provider a GIF was used, by asking for the one-pixel address the result carried (a picture request, which the browser's policy already allows). */
export function reportSent(g: Gif) {
  if (!g.sent) return;
  const u = new URL(g.sent);
  u.searchParams.set("ts", String(Date.now()));
  new Image().src = u.toString();
}
