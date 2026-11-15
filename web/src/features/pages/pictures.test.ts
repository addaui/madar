import { describe, expect, it } from "vitest";
import { importPicture, importRemote, isOwnPicture, isRemote, remotePictures, withPictures } from "./pictures";
import type { EditorJson } from "./LegacyEditor";

const doc = (...c: unknown[]) => ({ type: "doc", content: c }) as unknown as EditorJson;
const img = (src: string) => ({ type: "image", attrs: { src } });
const card = (image: string, icon = "") => ({ type: "linkPreview", attrs: { url: "https://x.example/a", title: "x", image, icon } });
const io = (over: Partial<Parameters<typeof importPicture>[1]> = {}) => ({
  fetch: async (u: string) => ({ data: btoa(u), name: "p.png", content_type: "image/png" }),
  upload: async (f: File) => ({ url: "/files/" + f.size }),
  ...over,
});

describe("which pictures are the Space's own", () => {
  it("only an address in this server's files is", () => {
    expect(isOwnPicture("/files/abc-1.png")).toBe(true);
    for (const u of ["https://x.example/a.png", "//x.example/a.png", "/files/../etc", "/other/abc", "data:image/png;base64,AAAA", "", null, 3]) expect(isOwnPicture(u)).toBe(false);
  });
  it("another site's is remote", () => {
    expect(isRemote("https://x.example/a.png")).toBe(true);
    expect(isRemote("HTTP://x.example/a.png")).toBe(true);
    expect(isRemote("/files/abc")).toBe(false);
  });
});

describe("finding remote pictures", () => {
  it("lists images and link-card pictures and icons, with where they are, and not the Space's own", () => {
    const d = doc(img("https://a.example/1.png"), img("/files/own"), { type: "callout", content: [card("https://b.example/2.png", "https://b.example/f.ico")] });
    expect(remotePictures(d)).toEqual([
      { path: [0], attr: "src", url: "https://a.example/1.png" },
      { path: [2, 0], attr: "image", url: "https://b.example/2.png" },
      { path: [2, 0], attr: "icon", url: "https://b.example/f.ico" },
    ]);
  });
  it("does not count a video embed", () => { expect(remotePictures(doc({ type: "youtube", attrs: { src: "https://youtu.be/abc" } }))).toEqual([]); });
  it("finds none in an empty or missing document", () => { expect(remotePictures(null)).toEqual([]); expect(remotePictures(doc())).toEqual([]); });
});

describe("rewriting", () => {
  it("replaces each remote address by its copy and leaves everything else as it was", () => {
    const d = doc(img("https://a.example/1.png"), img("https://a.example/1.png"), img("https://c.example/3.png"), card("https://b.example/2.png"));
    const out = withPictures(d, { "https://a.example/1.png": "/files/one", "https://b.example/2.png": "" });
    expect(JSON.stringify(out)).toContain('"/files/one"');
    expect((out as unknown as { content: { attrs: Record<string, string> }[] }).content.map((n) => n.attrs.src ?? n.attrs.image)).toEqual(["/files/one", "/files/one", "https://c.example/3.png", ""]);
    expect(JSON.stringify(d)).not.toContain("/files/one");   // the original is not touched
  });
});

describe("importing", () => {
  it("stores a picture and answers with its own address", async () => { expect(await importPicture("https://a.example/1.png", io())).toMatch(/^\/files\//); });
  it("answers null, never the remote address, when the Core refuses or the upload fails", async () => {
    expect(await importPicture("https://a.example/1.png", io({ fetch: async () => { throw new Error("blocked"); } }))).toBeNull();
    expect(await importPicture("https://a.example/1.png", io({ upload: async () => { throw new Error("full"); } }))).toBeNull();
    expect(await importPicture("https://a.example/1.png", io({ upload: async () => ({ url: "https://elsewhere.example/x" }) }))).toBeNull();
  });
  it("imports each address once, counts what failed, and keeps what failed as it was", async () => {
    let calls = 0;
    const d = doc(img("https://a.example/1.png"), img("https://a.example/1.png"), img("https://bad.example/2.png"));
    const r = await importRemote(d, io({ fetch: async (u: string) => { calls++; if (u.includes("bad")) throw new Error("no"); return { data: btoa("xyz"), name: "p.png", content_type: "image/png" }; } }));
    expect(calls).toBe(2);
    expect(r).toMatchObject({ imported: 1, failed: 1 });
    expect(remotePictures(r.doc).map((x) => x.url)).toEqual(["https://bad.example/2.png"]);
  });
  it("changes nothing when there is nothing to import", async () => {
    const d = doc(img("/files/own"));
    expect(await importRemote(d, io())).toEqual({ doc: d, imported: 0, failed: 0 });
  });
  it("imports only the addresses it is told to, and leaves the others", async () => {
    const d = doc(img("https://a.example/1.png"), img("https://b.example/2.png"));
    const r = await importRemote(d, io(), { only: ["https://b.example/2.png"] });
    expect(remotePictures(r.doc).map((x) => x.url)).toEqual(["https://a.example/1.png"]);
  });
  it("does at most `parallel` at once", async () => {
    let now = 0, peak = 0;
    const slow = io({ fetch: async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 5)); now--; return { data: btoa("x"), name: "p.png", content_type: "image/png" }; } });
    await importRemote(doc(...[1, 2, 3, 4, 5, 6].map((i) => img(`https://a.example/${i}.png`))), slow, { parallel: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
