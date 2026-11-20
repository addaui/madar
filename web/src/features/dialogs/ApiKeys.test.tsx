import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

let keys = [{ id: "k1", name: "laptop", created_at: 1_700_000_000_000 }];
const calls: { op: string; input: unknown }[] = [];
vi.mock("../../api/link", () => ({
  link: {
    call: async (op: string, input: unknown) => {
      calls.push({ op, input });
      if (op === "auth.keys.list") return { keys };
      if (op === "auth.keys.create") { keys = [...keys, { id: "k2", name: (input as { name: string }).name, created_at: 1_700_000_100_000 }]; return { id: "k2", key: "nuah_secretsecretsecret", name: "my agent", created_at: 1 }; }
      if (op === "auth.keys.revoke") { keys = keys.filter((k) => k.id !== (input as { id: string }).id); return {}; }
      return {};
    },
  },
}));
vi.mock("../../api/session", () => ({ useHasOp: (op: string) => op.startsWith("auth.keys"), useDescribe: () => ({ plugins: [{ id: "@nuah/mcp" }] }) }));
vi.mock("../../ui/overlays", () => ({ askConfirm: async () => true, toast: () => undefined }));
const { ApiKeys } = await import("./ApiKeys");

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider lang="en"><ApiKeys /></I18nProvider></QueryClientProvider>);
}

describe("API keys and agents (ADR 0101)", () => {
  it("makes_a_key_shows_it_once_with_the_mcp_address_and_revokes_one", async () => {
    show();
    expect(await screen.findByText("laptop")).toBeTruthy();
    expect(screen.getByText(`${location.origin}/mcp`)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Key name" }), { target: { value: "my agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Make a key" }));
    expect(await screen.findByText("nuah_secretsecretsecret")).toBeTruthy();
    expect(calls.find((c) => c.op === "auth.keys.create")?.input).toEqual({ name: "my agent" });
    // the MCP client setup carries the key
    expect(screen.getByText(/"Authorization": "Bearer nuah_secretsecretsecret"/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
    await waitFor(() => expect(calls.find((c) => c.op === "auth.keys.revoke")?.input).toEqual({ id: "k1" }));
    await waitFor(() => expect(screen.queryByText("laptop")).toBeNull());
  });
});
