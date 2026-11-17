import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { op: string; input: Record<string, unknown> }[] = [];
vi.mock("../../api/link", () => ({
  link: { call: vi.fn(async (op: string, input: Record<string, unknown>) => {
    calls.push({ op, input });
    if (op.endsWith(".create")) return { id: "p1", rev: 1, title: input.title, body: input.body, icon: input.icon ?? null, settings: {}, tags: [] };
    if (op.endsWith(".update")) return { id: "p1", rev: 2, title: "", body: { type: "doc", content: [{ type: "paragraph" }] }, settings: input.settings ?? {}, tags: input.tags ?? [] };
    return {};
  }) },
}));

import { DraftSession, hasContent, isBlank, isDraftId } from "./draft";

const doc = (...content: unknown[]) => ({ type: "doc" as const, content });
const empty = doc({ type: "paragraph" });
const text = (t: string) => doc({ type: "paragraph", content: [{ type: "text", text: t }] });

describe("what counts as content", () => {
  it("is nothing for an empty document or empty paragraphs, however many", () => {
    expect(isBlank(empty)).toBe(true);
    expect(isBlank(doc({ type: "paragraph" }, { type: "paragraph", attrs: { blockId: "x" } }))).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(text("   "))).toBe(true);
  });
  it("is anything else: a word, a block of another kind, something else on the document", () => {
    expect(isBlank(text("a"))).toBe(false);
    expect(isBlank(doc({ type: "image", attrs: { src: "/files/1" } }))).toBe(false);
    expect(isBlank(doc({ type: "heading", attrs: { level: 1 } }))).toBe(false);
    expect(isBlank({ ...empty, stickers: [{ id: 1 }] })).toBe(false);
  });
  it("counts a title as content", () => {
    expect(hasContent({ title: "", body: empty })).toBe(false);
    expect(hasContent({ title: "  ", body: empty })).toBe(false);
    expect(hasContent({ title: "A", body: empty })).toBe(true);
    expect(hasContent({ title: "", body: text("x") })).toBe(true);
  });
});

describe("a draft page", () => {
  beforeEach(() => { calls.length = 0; });
  const make = () => new DraftSession(new QueryClient(), { space: "default" }, undefined, "ann");

  it("is not on the server until something is written, whatever else is changed", async () => {
    const s = make();
    expect(isDraftId(s.id)).toBe(true);
    await s.saver.save({ settings: { preset: "paper" } });
    await s.saver.save({ icon: "📝" });
    await s.saver.save({ tags: ["a"] });
    await s.saver.save({ body: empty });
    await s.saver.save({ title: "   " });
    expect(calls).toEqual([]);
    expect(s.createdId).toBeNull();
    expect(s.page.settings).toEqual({ preset: "paper" });
  });

  it("is stored when a title or text arrives, with the style, icon and tags it already had, and says where it went", async () => {
    const s = make();
    const moved: string[] = [];
    s.onStored((id) => moved.push(id));
    await s.saver.save({ settings: { preset: "paper" } });
    await s.saver.save({ icon: "📝" });
    await s.saver.save({ tags: ["a"] });
    await s.saver.save({ body: text("hello") });
    expect(calls.map((c) => c.op)).toEqual(["pages.create", "pages.update"]);
    expect(calls[0]!.input).toMatchObject({ title: "", body: text("hello"), icon: "📝", space: "default" });
    expect(calls[1]!.input).toMatchObject({ id: "p1", expected_rev: 1, settings: { preset: "paper" }, tags: ["a"] });
    expect(s.createdId).toBe("p1");
    expect(moved).toEqual(["p1"]);
  });

  it("is stored once even when several changes arrive while it is being stored", async () => {
    const s = make();
    await Promise.all([s.saver.save({ title: "A" }), s.saver.save({ body: text("b") }), s.saver.save({ title: "AB" })]);
    expect(calls.filter((c) => c.op === "pages.create")).toHaveLength(1);
  });

  it("does not pull the person back to a page they left", async () => {
    const s = make();
    const moved: string[] = [];
    s.onStored((id) => moved.push(id));
    s.detach();
    await s.saver.save({ title: "Typed just before leaving" });
    expect(s.createdId).toBe("p1");
    expect(moved).toEqual([]);
  });

  it("can be stored on request, for a subpage to hang from", async () => {
    const s = make();
    expect(await s.saver.ensureStored()).toBe("p1");
    expect(await s.saver.ensureStored()).toBe("p1");
    expect(calls.filter((c) => c.op === "pages.create")).toHaveLength(1);
  });

  it("is made under a parent and in a project's knowledge when it should be", async () => {
    const s = new DraftSession(new QueryClient(), { project: "pr1" }, "par", "ann");
    await s.saver.save({ title: "x" });
    expect(calls[0]).toMatchObject({ op: "knowledge.create", input: { project: "pr1", parent: "par" } });
  });
});
