import { describe, expect, it } from "vitest";
import { forShare } from "./rewrite";

describe("a shared page's pictures go through the share", () => {
  it("changes an uploaded file's address wherever it is in the body and the style, and nothing else", () => {
    const body = { type: "doc", content: [{ type: "image", attrs: { src: "/files/abc123", alt: "/files/not-an-address-alone-x y" } }, { type: "linkPreview", attrs: { image: "/files/img9", url: "https://x.example/files/q" } }] };
    const out = forShare(body, "S1");
    expect(out.content[0]!.attrs).toEqual({ src: "/share-files/S1/abc123", alt: "/files/not-an-address-alone-x y" });
    expect(out.content[1]!.attrs).toEqual({ image: "/share-files/S1/img9", url: "https://x.example/files/q" });
    expect(body.content[0]!.attrs!.src).toBe("/files/abc123");
  });
  it("carries the PIN, escaped, when there is one", () => {
    expect(forShare({ bg_image: "/files/b" }, "S", "a b&c")).toEqual({ bg_image: "/share-files/S/b?pin=a%20b%26c" });
  });
  it("leaves other addresses and non-text values alone", () => {
    const v = { a: "https://other.example/files/x", b: 3, c: null, d: ["/files/ok", "/elsewhere/files/no"] };
    expect(forShare(v, "S")).toEqual({ a: "https://other.example/files/x", b: 3, c: null, d: ["/share-files/S/ok", "/elsewhere/files/no"] });
  });
});
