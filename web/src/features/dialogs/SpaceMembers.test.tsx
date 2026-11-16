import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spaceState } from "../../app/ui-state";
import { I18nProvider } from "../../i18n/i18n";

const calls: { op: string; input: unknown }[] = [];
let role = "admin";

vi.mock("../../api/link", () => ({
  link: {
    call: async (op: string, input: unknown) => {
      calls.push({ op, input });
      if (op === "spaces.list") return { spaces: [{ id: "default", name: "Default", builtin: true, role: "admin" }, { id: "s1", name: "Team", builtin: false, role }] };
      if (op === "spaces.members") return { members: [{ subject: "alice", display: "Alice", role: "admin" }, { subject: "bob", display: "Bob", role: "member" }] };
      return {};
    },
  },
}));

const { SpaceMembers } = await import("./SpaceMembers");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider lang="en"><Suspense fallback="loading"><SpaceMembers onClose={() => undefined} /></Suspense></I18nProvider></QueryClientProvider>);
}

beforeEach(() => { calls.length = 0; role = "admin"; spaceState.set("s1"); });

describe("the Space members window", () => {
  it("lists who is in the Space and lets an admin add someone by username with a role", async () => {
    show();
    expect(await screen.findByText("Bob")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Their username"), "carol");
    await userEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(calls.some((c) => c.op === "spaces.share")).toBe(true));
    expect(calls.find((c) => c.op === "spaces.share")!.input).toEqual({ space: "s1", username: "carol", role: "member" });
  });

  it("an admin removes a person", async () => {
    show();
    await userEvent.click((await screen.findAllByRole("button", { name: "Remove" }))[1]!);
    await waitFor(() => expect(calls.find((c) => c.op === "spaces.unshare")?.input).toEqual({ space: "s1", subject: "bob" }));
  });

  it("someone who is only a member cannot change anything", async () => {
    role = "member";
    show();
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("the personal Space has nobody to list", async () => {
    spaceState.set("default");
    show();
    expect(await screen.findByText(/no one else/)).toBeTruthy();
    expect(calls.some((c) => c.op === "spaces.members")).toBe(false);
  });
});
