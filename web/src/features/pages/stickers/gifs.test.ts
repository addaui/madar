import { describe, expect, it } from "vitest";
import { buildUrl, mapResults, pick, type Descriptor } from "./gifs";

const giphy: Descriptor = {
  configured: true, name: "GIPHY", mode: "client",
  search: { url: "https://api.giphy.com/v1/gifs/search", max_limit: 50, max_query: 50, query: { api_key: "K", q: "{q}", limit: "{limit}", offset: "{offset}", rating: "pg", lang: "{lang}" } },
  trending: { url: "https://api.giphy.com/v1/gifs/trending", max_limit: 50, query: { api_key: "K", limit: "{limit}", offset: "{offset}", rating: "pg" } },
  results: { list: "data", total: "pagination.total_count", id: "id", title: "title", preview: ["images.fixed_width.url"], url: ["images.downsized_medium.url", "images.original.url"], width: ["images.fixed_width.width"], height: ["images.fixed_width.height"], sent: "analytics.onsent.url" },
};

describe("pick", () => {
  it("follows a dotted path and tries a list in order", () => {
    expect(pick({ a: { b: 3 } }, "a.b")).toBe(3);
    expect(pick({ a: { c: 4 } }, ["a.b", "a.c"])).toBe(4);
    expect(pick({}, "a.b")).toBeUndefined();
    expect(pick({ a: "" }, ["a"])).toBeUndefined();
  });
});

describe("buildUrl", () => {
  it("fills the placeholders and keeps the fixed parameters", () => {
    const u = new URL(buildUrl(giphy.search!, { q: "happy cat", limit: 24, offset: 24, lang: "en" }));
    expect(u.origin + u.pathname).toBe("https://api.giphy.com/v1/gifs/search");
    expect(Object.fromEntries(u.searchParams)).toEqual({ api_key: "K", q: "happy cat", limit: "24", offset: "24", rating: "pg", lang: "en" });
  });
  it("cuts the query and the page size to the provider's limits", () => {
    const u = new URL(buildUrl(giphy.search!, { q: "x".repeat(80), limit: 500, offset: 0, lang: "en" }));
    expect(u.searchParams.get("q")!.length).toBe(50);
    expect(u.searchParams.get("limit")).toBe("50");
  });
  it("leaves out a parameter with no value", () => {
    const u = new URL(buildUrl({ ...giphy.search!, query: { q: "{q}", api_key: "K" } }, { limit: 5, offset: 0, lang: "en" }));
    expect(u.searchParams.has("q")).toBe(false);
  });
});

describe("mapResults", () => {
  const body = { pagination: { total_count: 99 }, data: [
    { id: "a", title: "A", images: { fixed_width: { url: "https://m.giphy.com/a200.gif", width: "200", height: "150" }, downsized_medium: { url: "https://m.giphy.com/a.gif" } }, analytics: { onsent: { url: "https://x.giphy.com/s?e=1" } } },
    { id: "b", title: "B", images: { fixed_width: { url: "https://m.giphy.com/b200.gif" }, original: { url: "https://m.giphy.com/b.gif" } } },
    { id: "evil", images: { fixed_width: { url: "javascript:alert(1)" } } },
    { images: { fixed_width: { url: "https://m.giphy.com/noid.gif" } } },
  ] };
  it("maps what is there and drops what is unsafe or unusable", () => {
    const r = mapResults(giphy, body);
    expect(r.total).toBe(99);
    expect(r.items.map((g) => g.id)).toEqual(["a", "b"]);
    expect(r.items[0]).toMatchObject({ preview: "https://m.giphy.com/a200.gif", url: "https://m.giphy.com/a.gif", width: 200, height: 150, sent: "https://x.giphy.com/s?e=1" });
    expect(r.items[1]!.url).toBe("https://m.giphy.com/b.gif");
  });
  it("copes with an answer that is not what was described", () => {
    expect(mapResults(giphy, null)).toEqual({ items: [], total: 0 });
    expect(mapResults({ configured: false }, body)).toEqual({ items: [], total: 0 });
  });
});
