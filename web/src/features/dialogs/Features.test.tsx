import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

const calls: { op: string; input: unknown }[] = [];
let failDisable: { reason: string; message: string } | null = null;

vi.mock("../../api/link", () => ({
  link: {
    call: async (op: string, input: unknown) => {
      calls.push({ op, input });
      if (op === "features.list") {
        return {
          features: [
            { id: "@nuah/gifs", kind: "plugin", name: "GIFs", description: "Find GIFs", enabled: true, needs: [], provides: [], settings_schema: null, settings: null },
            { id: "@nuah/gifs-giphy", kind: "plugin", name: "GIPHY", description: "GIF source", enabled: false, needs: ["@nuah/gifs"], provides: ["gifs.provider"],
              settings_schema: { properties: { api_key: { type: "string", title: "GIPHY API key", "x-secret": true }, rating: { type: "string", enum: ["g", "pg"], title: "Rating" } } }, settings: null },
            { id: "@nuah/theme-elevated", kind: "theme", name: "Elevated", description: "", enabled: true, needs: [], provides: [], settings_schema: null, settings: null },
          ],
          platform: [{ id: "@nuah/link-analyzer", name: "Link analyzer", description: "", enabled: true, reasons: ["needs the capability net"] }],
        };
      }
      if (op === "features.disable" && failDisable && !(input as { cascade?: boolean }).cascade) throw Object.assign(new Error(failDisable.message), failDisable);
      return { saved: true, restart_required: true };
    },
  },
}));

const { Features } = await import("./Features");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><I18nProvider lang="en"><Features onClose={() => undefined} /></I18nProvider></QueryClientProvider>);
}

beforeEach(() => { calls.length = 0; failDisable = null; });

describe("the Features page", () => {
  it("shows features as cards, themes not at all, and platform plugins read-only with the reason", async () => {
    show();
    expect(await screen.findByText("GIFs")).toBeTruthy();
    expect(screen.getByText("GIPHY")).toBeTruthy();
    expect(screen.queryByText("Elevated")).toBeNull();
    await userEvent.click(screen.getByText(/Managed by the operator/));
    expect(screen.getByText("needs the capability net")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Link analyzer" })).toBeNull();
  });

  it("switching a feature on asks the Core, then offers to start the app again", async () => {
    show();
    await userEvent.click(await screen.findByRole("switch", { name: "GIPHY" }));
    await waitFor(() => expect(calls.some((c) => c.op === "features.enable")).toBe(true));
    expect(calls.find((c) => c.op === "features.enable")!.input).toEqual({ id: "@nuah/gifs-giphy" });
    expect(await screen.findByText(/Start the app again/)).toBeTruthy();
  });

  it("when other features need one, the Core's message is shown and only a confirmation switches them all off", async () => {
    failDisable = { reason: "features.needed_by", message: "@nuah/gifs is needed by @nuah/gifs-giphy." };
    show();
    await userEvent.click(await screen.findByRole("switch", { name: "GIFs" }));
    expect(await screen.findByText(/is needed by/)).toBeTruthy();
    expect(calls.filter((c) => c.op === "features.disable")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Switch all off" }));
    await waitFor(() => expect(calls.filter((c) => c.op === "features.disable")).toHaveLength(2));
    expect(calls.filter((c) => c.op === "features.disable")[1]!.input).toEqual({ id: "@nuah/gifs", cascade: true });
  });
});
