import "fake-indexeddb/auto";
import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { forgetThisDevice, persister, restoreQueries, saveQueries } from "./offline";

/** The service worker's own choice of what to do with a request, read from public/sw.js as the browser runs it. */
function swRoute(): (url: string, method: string, mode?: string) => string {
  const self: Record<string, unknown> = { addEventListener: () => undefined, location: { origin: "https://m.example", pathname: "/faces/web-react/sw.js" } };
  runInNewContext(readFileSync(resolve(__dirname, "../../public/sw.js"), "utf8"), { self, URL, caches: {}, fetch: () => undefined, Response, console });
  return self.route as never;
}

describe("the service worker (ADR 0093)", () => {
  const route = swRoute();
  it("never caches the Link, Pulse, sign-in or uploads", () => {
    expect(route("https://m.example/link/call/pages.get", "POST")).toBe("network");
    expect(route("https://m.example/link/describe", "GET")).toBe("network");
    expect(route("https://m.example/pulse", "GET")).toBe("network");
    expect(route("https://m.example/files/abc", "GET")).toBe("network");
    expect(route("https://other.example/faces/web-react/assets/app-1234.js", "GET")).toBe("network");
  });
  it("keeps hashed files for good, and takes the rest of the app from the server while it answers (a new release never meets an old editor)", () => {
    expect(route("https://m.example/faces/web-react/assets/app-3f9a1c.js", "GET")).toBe("cache-first");
    expect(route("https://m.example/faces/web-react/loro.wasm", "GET")).toBe("network-first");
    expect(route("https://m.example/faces/web-react/vendor-editor.js", "GET")).toBe("network-first");
    expect(route("https://m.example/faces/web-react/", "GET", "navigate")).toBe("app-shell");
  });
});

describe("the reads kept on this device", () => {
  it("load without the server, and are gone after sign-out", async () => {
    const a = new QueryClient();
    a.setQueryData(["pages.list", {}], { pages: [{ id: "p1", title: "Plan" }] });
    await saveQueries(a);
    const b = new QueryClient();
    await restoreQueries(b);
    expect(b.getQueryData(["pages.list", {}])).toEqual({ pages: [{ id: "p1", title: "Plan" }] });
    await forgetThisDevice(b);
    const c = new QueryClient();
    await restoreQueries(c);
    expect(c.getQueryData(["pages.list", {}])).toBeUndefined();
    expect(await persister.restoreClient()).toBeUndefined();
  });
});
