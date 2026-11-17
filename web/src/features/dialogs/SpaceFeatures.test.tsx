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
      if (op === "spaces.list") return { spaces: [{ id: "default", name: "My Space", builtin: true, role: "admin" }, { id: "s1", name: "Team", builtin: false, role }] };
      if (op === "spaces.features") return { features: [
        { id: "@madar/tasks", name: "Tasks", allowed: true, enabled: true },
        { id: "@madar/discussion", name: "Comments", allowed: true, enabled: true },
        { id: "@madar/audit", name: "History", allowed: false, enabled: false },
      ] };
      return { features: [] };
    },
  },
}));

const { SpaceFeatures } = await import("./SpaceFeatures");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider lang="en"><Suspense fallback="loading"><SpaceFeatures onClose={() => undefined} /></Suspense></I18nProvider></QueryClientProvider>);
}

beforeEach(() => { calls.length = 0; role = "admin"; spaceState.set("s1"); });

describe("the Space features window", () => {
  it("an admin switches one off and the call lists what stays on", async () => {
    show();
    await userEvent.click(await screen.findByRole("switch", { name: "Comments" }));
    await waitFor(() => expect(calls.some((c) => c.op === "spaces.set_features")).toBe(true));
    expect(calls.find((c) => c.op === "spaces.set_features")!.input).toEqual({ space: "s1", features: ["@madar/tasks"] });
  });

  it("a feature the instance does not allow cannot be switched on, and a member can change nothing", async () => {
    show();
    const audit = await screen.findByRole("switch", { name: "History" });
    expect(audit).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Not allowed on this instance")).toBeTruthy();
  });

  it("someone who is not an admin sees the switches but cannot use them", async () => {
    role = "member";
    show();
    expect(await screen.findByRole("switch", { name: "Tasks" })).toHaveAttribute("aria-disabled", "true");
  });
});
