import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

const calls: { op: string; input: unknown }[] = [];
let accounts = true;
let allowed = true;
let canAllow = false;

vi.mock("../../api/link", () => ({
  link: {
    describe: async () => ({ plugins: [{ id: "@nuah/console", state: "active" }], operations: {}, who: { subject: "a" } }),
    call: async (op: string, input: unknown) => {
      calls.push({ op, input });
      if (op === "shares.options") return { accounts, public_ok: accounts || allowed, acknowledged: !accounts && allowed, can_allow: canAllow, base_domain: null };
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

beforeEach(() => { calls.length = 0; accounts = true; allowed = true; canAllow = false; });

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

  it("an instance without accounts, where sharing was allowed, says a PIN protects and keeps the warning", async () => {
    accounts = false;
    show();
    expect(await screen.findAllByText(/no accounts/)).toBeTruthy();
    expect(screen.getByText(/has no sign-in: anyone who can open its address/)).toBeTruthy();
  });

  it("with no sign-in and no allowance the panel shows the warning and the way to turn sign-in on, not the form", async () => {
    accounts = false; allowed = false;
    show();
    expect(await screen.findByText("This instance has no sign-in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up sign-in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create link" })).toBeNull();
  });

  it("someone who is not an admin allows it with the admin password, which is asked for and used once", async () => {
    accounts = false; allowed = false;
    show();
    await userEvent.click(await screen.findByText("Share without sign-in anyway"));
    await userEvent.type(screen.getByLabelText("The instance's admin password"), "the-admin-pw");
    await userEvent.click(screen.getByRole("button", { name: "I understand, allow sharing" }));
    await waitFor(() => expect(calls.some((c) => c.op === "shares.acknowledge")).toBe(true));
    const order = calls.map((c) => c.op).filter((o) => o === "auth.sign_in" || o === "shares.acknowledge");
    expect(order).toEqual(["auth.sign_in", "shares.acknowledge"]);
    expect(calls.find((c) => c.op === "auth.sign_in")!.input).toEqual({ password: "the-admin-pw" });
  });
});
