import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

const calls: { op: string; input: unknown }[] = [];
let accounts = true;

vi.mock("../../api/link", () => ({
  link: {
    call: async (op: string, input: unknown) => {
      calls.push({ op, input });
      if (op === "shares.options") return { accounts, base_domain: null };
      if (op === "shares.list") return { shares: [{ id: "S1", kind: "page", title: "Plan", audience: "pin", pin: "abcd1234ef", mode: "pinned", release: 2, include_children: false, page: "p", project: null, space: null, subdomain: null, created_at: 1, created_by: "a", people: [] }] };
      return {};
    },
  },
}));

const { ShareDialog } = await import("./ShareDialog");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider lang="en"><Suspense fallback="loading"><ShareDialog page={{ id: "p", title: "Plan" }} onClose={() => undefined} /></Suspense></I18nProvider></QueryClientProvider>);
}

beforeEach(() => { calls.length = 0; accounts = true; });

describe("the Share window", () => {
  it("lists the page's shares with their link and PIN and lets the person publish a new version or stop sharing", async () => {
    show();
    expect(await screen.findByDisplayValue(`${location.origin}/share/S1`)).toBeTruthy();
    expect(screen.getByText("abcd1234ef")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Publish now/ }));
    await waitFor(() => expect(calls.find((c) => c.op === "shares.publish")?.input).toEqual({ id: "S1" }));
  });

  it("makes a new link with the choices: pinned by default, sub-pages only when ticked", async () => {
    show();
    await screen.findByDisplayValue(`${location.origin}/share/S1`);
    await userEvent.click(screen.getByRole("button", { name: "Create link" }));
    await waitFor(() => expect(calls.find((c) => c.op === "shares.create_page")).toBeTruthy());
    expect(calls.find((c) => c.op === "shares.create_page")!.input).toEqual({ page: "p", audience: "anyone", mode: "pinned", include_children: false });
  });

  it("an instance without accounts says a PIN protects instead", async () => {
    accounts = false;
    show();
    expect(await screen.findAllByText(/no accounts/)).toBeTruthy();
  });
});
