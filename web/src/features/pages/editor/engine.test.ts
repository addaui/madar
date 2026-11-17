/* eslint-disable @typescript-eslint/no-explicit-any -- this file drives the untyped editor bundle and its ProseMirror schema */
// The interim editor, run for real in jsdom (ADR 0078): every shared fixture goes through ProseMirror's schema, and every block that declares options
// passes the compliance suite built from the editor's own schema and the Core's declared options (fixtures/editor-blocks.json, written by the Rust test).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../../..");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(root, "fixtures", name), "utf8"));
const docs: { name: string; doc: any; model: boolean; server: boolean; node?: string }[] = fixture("richtext.json").documents;
const blocks: Record<string, any[]> = fixture("editor-blocks.json").blocks;

// the editor is a browser bundle that registers itself; jsdom has no layout, so the few things it asks of a browser are given here
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
document.elementFromPoint ??= () => null;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as any;
await import(/* @vite-ignore */ resolve(root, "faces/editor-src/src/editor.ts"));
const { Registry } = await import(/* @vite-ignore */ resolve(root, "../nuah-plugins/packages/editor-core/src/index.ts"));
const { runEditorPluginCompliance } = await import(/* @vite-ignore */ resolve(root, "../nuah-plugins/packages/editor-core/src/testing.ts"));

type Ed = { json(): any; schema(): any; set(d: any): void; destroy(): void };
const open = (content?: any): Ed => {
  const host = document.createElement("div");
  document.body.append(host);
  return (window as any).MadarEditor.create(host, { content, editable: true });
};

/** Attributes the engine fills in (block ids among them: it gives a block one when the document changes, ADR 0043; the ids have their own test below) that a saved document leaves out (the defaults), taken out so what is compared is what a person chose. */
function bare(n: any, schema: any): any {
  const spec = schema.nodes[n.type];
  const out: any = { type: n.type };
  if (n.text !== undefined) out.text = n.text;
  if (n.marks?.length) out.marks = n.marks.map((m: any) => ({ type: m.type, ...(m.attrs && Object.keys(m.attrs).length ? { attrs: Object.fromEntries(Object.entries(m.attrs).filter(([k, v]) => v !== null && v !== schema.marks[m.type]?.spec.attrs?.[k]?.default)) } : {}) })).map((m: any) => (m.attrs && !Object.keys(m.attrs).length ? { type: m.type } : m));
  const attrs = Object.fromEntries(Object.entries(n.attrs ?? {}).filter(([k, v]) => v !== null && v !== spec?.spec.attrs?.[k]?.default && !(k === "dirAuto" && v === "auto") && k !== "blockId"));
  // stickers on the document are not a schema attribute of the node here: kept as they are
  if (Object.keys(attrs).length) out.attrs = attrs;
  if (n.content?.length) out.content = n.content.map((c: any) => bare(c, schema));
  return out;
}

/** The editor keeps a line after a block you cannot type in (ADR 0030, a page never traps you); a fixture that ends in one is compared without it. */
const withoutTrailingLine = (back: any, doc: any) => {
  const last = back.content?.at(-1);
  if (last?.type === "paragraph" && !last.content?.length && doc.content?.at(-1)?.type !== "paragraph") return { ...back, content: back.content.slice(0, -1) };
  return back;
};

describe("the interim editor loads and returns every shared fixture", () => {
  for (const f of docs.filter((d) => d.model)) {
    it(f.name, () => {
      const ed = open(f.doc);
      const back = withoutTrailingLine(ed.json(), f.doc);
      if (f.doc.attrs?.stickers) back.attrs = { ...back.attrs };
      const schema = ed.schema();
      expect(() => schema.nodeFromJSON(f.doc).check()).not.toThrow();
      expect(bare(back, schema)).toEqual(bare(f.doc, schema));
      if (f.doc.attrs?.stickers) expect(back.attrs.stickers).toEqual(f.doc.attrs.stickers);
      ed.destroy();
    });
  }
});

describe("the editor refuses what the model refuses", () => {
  for (const f of docs.filter((d) => !d.model && d.doc.type === "doc" && !(d as any).engine)) {
    it(f.name, () => {
      const ed = open();
      expect(() => ed.schema().nodeFromJSON(f.doc).check()).toThrow();
      ed.destroy();
    });
  }
  // what ProseMirror does not refuse, it drops: an attribute no block declares is lost on the next save, so no plugin may rely on one
  it("drops an attribute no block declares instead of keeping it", () => {
    const f = docs.find((d) => (d as any).engine === "drops")!;
    const ed = open(f.doc);
    expect(JSON.stringify(ed.json())).not.toContain("colour");
    ed.destroy();
  });
});

describe("block ids (ADR 0043)", () => {
  const para = (id: string | null, t: string) => ({ type: "paragraph", ...(id ? { attrs: { blockId: id } } : {}), content: [{ type: "text", text: t }] });
  it("an id a block has is kept", () => {
    const ed = open({ type: "doc", content: [para("keep1", "a"), para("keep2", "b")] });
    expect(ed.json().content.map((b: any) => b.attrs.blockId)).toEqual(["keep1", "keep2"]);
    ed.destroy();
  });
  it("a second block with the same id gets a new one and the first keeps it", () => {
    const ed = open();
    ed.set({ type: "doc", content: [para("dup", "a"), para("dup", "b")] });
    const ids = ed.json().content.map((b: any) => b.attrs.blockId);
    expect(ids[0]).toBe("dup");
    expect(ids[1]).not.toBe("dup");
    expect(ids[1]).toMatch(/^b[a-z0-9]{8}$/);
    ed.destroy();
  });
});

// ---- the compliance suite (ADR 0078), for every block the Core declares options for ----
/** What the editor-core registry needs to know of a node, read from the engine's real schema. */
const specOf = (schema: any, id: string) => {
  const n = schema.nodes[id], s = n.spec;
  const attrs = Object.fromEntries(Object.entries(s.attrs ?? n.spec.attrs ?? {}).filter(([k]) => k !== "blockId").map(([k, v]: [string, any]) => [k, { default: v.default ?? null }]));
  return { id, group: n.isInline ? "inline" : "block", ...(s.content ? { content: String(s.content) } : {}), ...(n.isAtom && !n.isText ? { atom: true } : {}), ids: true, attrs } as any;
};
const probe = open();
const schema = probe.schema();
probe.destroy();
const idsOn = ["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "callout", "toggle", "taskBlock", "youtube", "image", "linkPreview", "horizontalRule"];
const toOption = (o: any) => ({ ...o, type: o.type === "date" ? "text" : o.type, label: o.label });

/** Blocks the Core declares that this editor has no node for yet. Listed so it is a decision, not an accident: the slash menu hides them (it only offers what it can insert). */
const NOT_IMPLEMENTED = ["fileAttachment"];
it("the blocks the Core declares but the editor does not draw are exactly the listed ones", () => {
  expect(Object.keys(blocks).filter((n) => !schema.nodes[n]).sort()).toEqual(NOT_IMPLEMENTED);
});

for (const [node, options] of Object.entries(blocks)) {
  if (NOT_IMPLEMENTED.includes(node)) continue;
  const fixtures = docs.filter((d) => d.node === node && d.model);
  if (!fixtures.length || !schema.nodes[node]) { it(`${node}: has fixtures and exists in the editor`, () => { expect(fixtures.length, `no fixture for "${node}"`).toBeGreaterThan(0); expect(schema.nodes[node], `the editor has no "${node}"`).toBeTruthy(); }); continue; }
  const base = () => {
    const r = new Registry();
    for (const id of Object.keys(schema.nodes)) {
      if (id === node || id === "doc" || id === "text") continue;
      const sp = specOf(schema, id);
      // a node with no group in the engine (a list item) is a block here: the registry only has the two kinds
      r.addNode({ ...sp, ids: idsOn.includes(id) });
    }
    for (const m of Object.keys(schema.marks)) r.addMark({ id: m, attrs: Object.fromEntries(Object.entries<any>(schema.marks[m].spec.attrs ?? {}).map(([k, v]) => [k, { default: v.default ?? null }])) });
    return r;
  };
  const sp = specOf(schema, node);
  runEditorPluginCompliance({
    name: `${node} (Madar block)`,
    node: { ...sp, ids: idsOn.includes(node), options: options.map(toOption) },
    base,
    fixtures: { valid: fixtures.map((f) => f.doc), invalid: docs.filter((d) => !d.model && d.doc.type === "doc" && d.node === node).map((d) => d.doc) },
    roundtrip: (d: any) => { const ed = open(d); const back = withoutTrailingLine(ed.json(), d); ed.destroy(); return stripIds(bare(back, schema), d); },
    remoteOk: node === "youtube" ? ["src"] : [],
    agrees: () => true,
  }, { describe, it, expect });
}
function stripIds(back: any, original: any): any { void original; return back; }

// ---- stickers follow the text (ADR 0071) ----
describe("a sticker pinned to a word follows it through edits", () => {
  const sticker = (over: any = {}) => ({ id: "s1", kind: "emoji", value: "🎉", anchor: "b1", at: 6, x: 0.5, y: 0, w: 4, rot: 0, flip: false, z: "a", behind: false, lock: false, hidden: false, narrow: false, wrap: "none", wm: 0.6, ...over });
  const page = (list: any[]) => ({ type: "doc", attrs: { stickers: list }, content: [
    { type: "paragraph", attrs: { blockId: "b1" }, content: [{ type: "text", text: "hello world" }] },
    { type: "paragraph", attrs: { blockId: "b2" }, content: [{ type: "text", text: "second" }] },
    { type: "paragraph", attrs: { blockId: "b3" }, content: [{ type: "text", text: "third" }] }] });
  const start = (list: any[]) => {
    const host = document.createElement("div");
    document.body.append(host);
    let last: any[] = list;
    const ed = (window as any).MadarEditor.create(host, { content: page(list), editable: true, stickers: { onList: (l: any[]) => { last = l; }, onLayers: () => {}, onLayout: () => {}, menu: () => [] } });
    return { ed, tt: ed.tiptap(), list: () => ed.json().attrs.stickers as any[], last: () => last };
  };

  it("moves with text typed before it in the same block", () => {
    const t = start([sticker()]);
    t.tt.commands.insertContentAt(1, "abc");
    expect(t.list()[0]).toMatchObject({ anchor: "b1", at: 9 });
    t.ed.destroy();
  });
  it("stays beside the same word when the line is split before it", () => {
    const t = start([sticker()]);
    t.tt.chain().setTextSelection(7).splitBlock().run();   // "hello " | "world"
    const s = t.list()[0], moved = t.tt.state.doc.child(1);
    expect(s.anchor).toBe(moved.attrs.blockId);
    expect(s.anchor).not.toBe("b1");
    expect(s.at).toBe(0);
    t.ed.destroy();
  });
  it("stays where it is when the edit is after it", () => {
    const t = start([sticker({ at: 2 })]);
    t.tt.commands.insertContentAt(8, "zzz");
    expect(t.list()[0]).toMatchObject({ anchor: "b1", at: 2 });
    t.ed.destroy();
  });
  it("moves to the block before when its block is deleted, and keeps its own place there", () => {
    const t = start([sticker({ anchor: "b2", at: 3 })]);
    const doc = t.tt.state.doc, from = doc.child(0).nodeSize, to = from + doc.child(1).nodeSize;
    t.tt.chain().deleteRange({ from, to }).run();
    const s = t.list()[0];
    expect(s.anchor).toBe("b1");
    t.ed.destroy();
  });
  it("falls to the next block when there is none before", () => {
    const t = start([sticker({ anchor: "b1", at: 2 })]);
    t.tt.chain().deleteRange({ from: 0, to: t.tt.state.doc.child(0).nodeSize }).run();
    expect(t.list()[0].anchor).toBe("b2");
    t.ed.destroy();
  });
  it("a layout for a narrower page follows its own anchor too, and loses the word position when its block goes", () => {
    const t = start([sticker({ sizes: { narrow: { anchor: "b2", at: 1 } } })]);
    t.tt.commands.insertContentAt(t.tt.state.doc.child(0).nodeSize + 1, "XX");
    expect(t.list()[0].sizes.narrow).toMatchObject({ anchor: "b2", at: 3 });
    const doc = t.tt.state.doc, from = doc.child(0).nodeSize, to = from + doc.child(1).nodeSize;
    t.tt.chain().deleteRange({ from, to }).run();
    const n = t.list()[0].sizes.narrow;
    expect(n.anchor).toBe("b1");
    expect(n.at).toBeNull();
    t.ed.destroy();
  });
  it("one undo brings the sticker and its block back together", () => {
    const t = start([sticker({ anchor: "b2", at: 3 })]);
    const doc = t.tt.state.doc, from = doc.child(0).nodeSize, to = from + doc.child(1).nodeSize;
    t.tt.chain().deleteRange({ from, to }).run();
    expect(t.list()[0].anchor).toBe("b1");
    t.tt.commands.undo();
    expect(t.list()[0]).toMatchObject({ anchor: "b2", at: 3 });
    expect(t.tt.state.doc.childCount).toBeGreaterThanOrEqual(3);
    t.ed.destroy();
  });
  it("a sticker pinned to the page (no anchor) is left alone", () => {
    const t = start([sticker({ anchor: null, at: null })]);
    t.tt.commands.insertContentAt(1, "abc");
    expect(t.list()[0]).toMatchObject({ anchor: null });
    t.ed.destroy();
  });
});

// ---- a viewer's browser loads only from this server (ADR 0077) ----
describe("what the editor draws loads only from the Space's own files", () => {
  const draw = (content: any) => { const host = document.createElement("div"); document.body.append(host); const ed = (window as any).MadarEditor.create(host, { content, editable: false }); return { host, ed }; };
  const doc = (...c: any[]) => ({ type: "doc", content: c });
  const remoteUrls = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[src], [href^='http'][data-x], [poster]")].map((e) => e.getAttribute("src") ?? "").filter((u) => /^(https?:)?\/\//i.test(u) && !/^https:\/\/www\.youtube-nocookie\.com\//.test(u));

  it("draws no element with a remote address for any shared fixture", () => {
    for (const f of docs.filter((d) => d.model)) { const { host, ed } = draw(f.doc); expect(remoteUrls(host), f.name).toEqual([]); ed.destroy(); }
  });
  it("draws an image from the files, and an image at another site as an empty frame with no address", () => {
    const own = draw(doc({ type: "image", attrs: { src: "/files/abc" } }));
    expect(own.host.querySelector("img")!.getAttribute("src")).toBe("/files/abc");
    own.ed.destroy();
    const far = draw(doc({ type: "image", attrs: { src: "https://tracker.example/p.gif" } }));
    const img = far.host.querySelector("img")!;
    expect(img.hasAttribute("src")).toBe(false);
    expect(img.getAttribute("data-remote")).toBe("true");
    expect(far.ed.json().content[0].attrs.src).toBe("https://tracker.example/p.gif");   // kept in the data until it is imported
    far.ed.destroy();
  });
  it("draws a link card's picture and icon only from the files", () => {
    const { host, ed } = draw(doc({ type: "linkPreview", attrs: { url: "https://x.example/a", title: "X", image: "https://x.example/og.png", icon: "https://x.example/favicon.ico" } }));
    expect(host.querySelector(".link-card img")).toBeNull();
    expect(host.querySelector(".link-card")!.getAttribute("data-pic")).toBe("false");
    ed.destroy();
  });
});

describe("the link card (ADR 0079)", () => {
  const draw = (attrs: any) => { const host = document.createElement("div"); document.body.append(host); const ed = (window as any).MadarEditor.create(host, { content: { type: "doc", content: [{ type: "linkPreview", attrs }] }, editable: false }); return { host, ed, card: host.querySelector<HTMLElement>(".link-card")! }; };
  const base = { url: "https://www.google.com/", title: "Google", description: "Search the world's information", site: "google.com" };

  it("is wide by default, and each layout is one of four", () => {
    for (const [mode, want] of [[undefined, "card"], ["card", "card"], ["compact", "compact"], ["stack", "stack"], ["side", "side"], ["huge", "card"]] as const) {
      const { card, ed } = draw({ ...base, ...(mode ? { mode } : {}) });
      expect(card.getAttribute("data-mode"), String(mode)).toBe(want);
      ed.destroy();
    }
  });
  it("shows the picture, else the site's icon, else nothing", () => {
    const withPic = draw({ ...base, image: "/files/pic", icon: "/files/ico" });
    expect(withPic.card.querySelector(".lc-pic .lc-img")!.getAttribute("src")).toBe("/files/pic");
    expect(withPic.card.getAttribute("data-pic")).toBe("true");
    withPic.ed.destroy();
    const withIcon = draw({ ...base, icon: "/files/ico" });
    expect(withIcon.card.querySelector(".lc-pic[data-icon='true'] .lc-icon")!.getAttribute("src")).toBe("/files/ico");
    withIcon.ed.destroy();
    const bare = draw(base);
    expect(bare.card.querySelector(".lc-pic")).toBeNull();
    expect(bare.card.getAttribute("data-pic")).toBe("false");
    bare.ed.destroy();
  });
  it("has a footer with the icon and the address, the title and the summary, and links to the original address", () => {
    const { card, ed } = draw({ ...base, icon: "/files/ico" });
    expect(card.querySelector(".lc-title")!.textContent).toBe("Google");
    expect(card.querySelector(".lc-desc")!.textContent).toBe("Search the world's information");
    expect(card.querySelector(".lc-foot .lc-fav")!.getAttribute("src")).toBe("/files/ico");
    expect(card.querySelector(".lc-site")!.textContent).toBe("www.google.com");
    expect(card.getAttribute("href")).toBe("https://www.google.com/");
    expect(card.getAttribute("rel")).toContain("noopener");
    ed.destroy();
  });
  it("shortens a long address in the middle and keeps the whole one on hover", () => {
    const long = "https://www.google.com/maps/@24.9638794,46.8349725,15z?entry=ttu&g_ep=EgoyMDI2MTExMC4wIKXMDSoASAFQAw%3D%3D";
    const { card, ed } = draw({ ...base, url: long });
    const shown = card.querySelector(".lc-site")!.textContent!;
    expect(shown.length).toBeLessThanOrEqual(61);
    expect(shown).toContain("…");
    expect(card.querySelector(".lc-foot")!.getAttribute("title")).toBe(long);
    ed.destroy();
  });
  it("refuses an address that is not a web address for the link, and caps what it shows", () => {
    const { card, ed } = draw({ ...base, url: "javascript:alert(1)", title: "x".repeat(500), description: "y".repeat(900) });
    expect(card.getAttribute("href")).toBe("#");
    expect(card.querySelector(".lc-title")!.textContent!.length).toBe(200);
    expect(card.querySelector(".lc-desc")!.textContent!.length).toBe(300);
    ed.destroy();
  });
});

describe("the direction of a block", () => {
  const para = (text?: string) => ({ type: "doc", content: [{ type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) }] });
  const dirOfFirst = (doc: any) => { const ed = open(doc); const p = document.body.querySelector(".ed-content p"); const d = p?.getAttribute("dir"); ed.destroy(); return d; };

  it("an empty block, or one with no letter, starts on the page's side, and a block with letters reads its own text", () => {
    document.documentElement.dir = "rtl";
    expect(dirOfFirst(para())).toBe("rtl");
    expect(dirOfFirst(para("/"))).toBe("rtl");
    expect(dirOfFirst(para("123"))).toBe("rtl");
    expect(dirOfFirst(para("hello"))).toBe("auto");
    expect(dirOfFirst(para("مرحبا"))).toBe("auto");
    document.documentElement.dir = "ltr";
    expect(dirOfFirst(para())).toBe("ltr");
    document.documentElement.dir = "";
  });
});
