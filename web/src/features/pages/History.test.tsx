import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

const calls: { op: string; input: Record<string, unknown> }[] = [];
let named: string | null = null;
const p = (id: string, text: string) => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });

vi.mock("../../api/link", () => ({
  link: {
    call: async (op: string, input: Record<string, unknown>) => {
      calls.push({ op, input });
      if (op === "pages.versions") return { versions: [{ id: "v2", at: 2000, by: "alice", title: "Plan", name: named, text: "second" }, { id: "v1", at: 1000, by: "alice", title: "Plan", name: null, text: "first" }] };
      if (op === "pages.version") return { id: input.version, at: 1, by: "alice", title: "Plan", name: null, body: { type: "doc", content: [p("a", "old words here")] } };
      if (op === "pages.version_name") { named = input.name as string; return { id: input.version, title: "Plan", name: named, text: "" }; }
      if (op === "pages.restore") return { id: "p1", rev: 9, title: "Plan", body: { type: "doc", content: [] } };
      return {};
    },
  },
}));
vi.mock("../../api/session", async (orig) => ({ ...(await orig<object>()), useDescribe: () => ({ who: { subject: "alice", display: "Alice" } }) }));
vi.mock("../../ui/overlays", () => ({ askConfirm: async () => true, askText: async () => "Before the rewrite", toast: () => undefined }));

const { default: History } = await import("./History");
const page = { id: "p1", rev: 3, title: "Plan", body: { type: "doc", content: [p("a", "new words here"), p("b", "added later")] } };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider lang="en"><History page={page as never} scope={{} as never} writer onClose={() => undefined} /></I18nProvider></QueryClientProvider>);
}

beforeEach(() => { calls.length = 0; named = null; });

describe("the page history window (ADR 0093)", () => {
  it("names a version and shows its name in the list", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Name this version" }));
    await waitFor(() => expect(calls.find((c) => c.op === "pages.version_name")?.input).toEqual({ id: "p1", version: "v2", name: "Before the rewrite" }));
    expect(await screen.findByText("Before the rewrite")).toBeTruthy();
  });

  it("compares a version with the page as it is now", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Compare with now" }));
    expect(await screen.findByText("added later")).toBeTruthy();
    expect(screen.getByText(/old/).closest("del")).toBeTruthy();
    expect(screen.getByText(/new/).closest("ins")).toBeTruthy();
  });

  it("restores a version", async () => {
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Restore this version" }));
    await waitFor(() => expect(calls.find((c) => c.op === "pages.restore")?.input).toEqual({ id: "p1", version: "v2" }));
  });
});
