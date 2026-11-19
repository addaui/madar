/* eslint-disable @typescript-eslint/no-explicit-any -- drives the untyped editor bundle */
// Two editors on one Live document edit the same paragraph apart (offline), then merge: the binding must not throw and both must agree (ADR 0093).
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../../../..");
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
document.elementFromPoint ??= () => null;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Range.prototype.getClientRects ??= () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as any;
await import(/* @vite-ignore */ resolve(root, "faces/editor-src/src/editor.ts"));

const M = () => (window as any).MadarEditor;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const editor = async (doc: any) => { const h = document.createElement("div"); document.body.append(h); const e = M().create(h, { editable: true, live: { doc } }); await tick(); return e; };
const text = (e: any) => e.json().content.map((p: any) => (p.content ?? []).map((t: any) => t.text ?? "").join("")).filter((s: string) => s);

describe("merging offline edits into open editors", () => {
  it("edits at both ends of one paragraph, and a split elsewhere, merge without an error", async () => {
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onErr);
    const a = new (M().loro.LoroDoc)();
    const ea = await editor(a);
    const ta = ea.tiptap();
    ta.commands.focus("end"); ta.commands.insertContent("Hello from the server.");
    ta.commands.insertContent({ type: "paragraph", content: [{ type: "text", text: "Second line" }] });
    const b = new (M().loro.LoroDoc)();
    b.import(a.export({ mode: "snapshot" }));
    const eb = await editor(b);
    const tb = eb.tiptap();
    const va = a.oplogVersion(), vb = b.oplogVersion();
    // a: text at the end of the first paragraph; b: text at its start, and a split of the second
    ta.commands.setTextSelection(1 + "Hello from the server".length); ta.commands.insertContent(" [A offline]");
    tb.commands.setTextSelection(1); tb.commands.insertContent("[B offline] ");
    tb.commands.setTextSelection(tb.state.doc.content.size - 5); tb.commands.splitBlock();
    await tick();
    const ua = a.export({ mode: "update", from: va }), ub = b.export({ mode: "update", from: vb });
    a.import(ub); b.import(ua);
    await tick(20);
    // and both keep typing afterwards
    ta.commands.focus("end"); ta.commands.insertContent("!");
    b.import(a.export({ mode: "update", from: b.oplogVersion() }));
    await tick(20);
    window.removeEventListener("error", onErr);
    expect(errors).toEqual([]);
    expect(text(ea)).toEqual(text(eb));
    expect(text(ea)[0]).toBe("[B offline] Hello from the server [A offline].");
    ea.destroy(); eb.destroy();
  });

  it("another person's cursor in text this copy does not have yet is not drawn, and typing goes on", async () => {
    const errors: unknown[] = [];
    const onErr = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
    window.addEventListener("error", onErr);
    const a = new (M().loro.LoroDoc)();
    const ea0 = await editor(a);
    ea0.tiptap().commands.focus("end"); ea0.tiptap().commands.insertContent("one");
    ea0.destroy();
    const b = new (M().loro.LoroDoc)();
    b.import(a.export({ mode: "snapshot" }));
    const eb = await editor(b);
    eb.tiptap().commands.focus("end"); eb.tiptap().commands.insertContent({ type: "paragraph", content: [{ type: "text", text: "only in b" }] });
    await tick();
    // b's cursor in its new paragraph, which a has not received
    const kids = b.getMap("doc").get("children");
    const para = kids.get(kids.length - 1);
    const t = para.get("children").get(0);
    const storeA = new (M().loro.CursorEphemeralStore)(a.peerIdStr), storeB = new (M().loro.CursorEphemeralStore)(b.peerIdStr);
    storeB.setLocal({ anchor: t.getCursor(2), focus: t.getCursor(4), user: { name: "B", color: "#00c" } });
    const host = document.createElement("div"); document.body.append(host);
    const ea = M().create(host, { editable: true, live: { doc: a, ephemeral: storeA, user: { name: "A", color: "#c00" } } });
    await tick();
    storeA.apply(storeB.encodeAll());
    await tick();
    ea.tiptap().commands.focus("end"); ea.tiptap().commands.insertContent(" two");
    await tick();
    window.removeEventListener("error", onErr);
    expect(errors).toEqual([]);
    expect(JSON.stringify(ea.json())).toContain("one two");
    ea.destroy(); eb.destroy();
  });
});

