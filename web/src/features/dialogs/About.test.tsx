import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/i18n";

const about = {
  name: "madar", version: "0.3.0", commit: "abc123def4567890+changes",
  components: [{ name: "Nuah", version: "v0.17.0", commit: "6dc85cd77a3f29503aef8fa7d8eab2bc96925460" }, { name: "Nuah plugins", version: "0.9.0", commit: null }],
};
vi.mock("../../api/session", () => ({ useDescribe: () => ({ about }) }));
const { About } = await import("./About");

describe("About (ADR 0100)", () => {
  it("shows_what_this_instance_is_built_from_and_copies_it_for_a_report", async () => {
    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => { copied.push(t); } } });
    render(<I18nProvider lang="en"><About /></I18nProvider>);
    expect(screen.getByText("Madar")).toBeTruthy();
    expect(screen.getByText("0.3.0")).toBeTruthy();
    expect(screen.getByText("abc123def456 (with changes)")).toBeTruthy();
    expect(screen.getByText("v0.17.0")).toBeTruthy();
    expect(screen.getByText("6dc85cd77a3f")).toBeTruthy();
    expect(screen.getByText("local checkout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(copied[0]).toBe("Madar 0.3.0 (abc123def4567890+changes)\nNuah v0.17.0 (6dc85cd77a3f29503aef8fa7d8eab2bc96925460)\nNuah plugins 0.9.0 (local checkout)"));
  });
});
