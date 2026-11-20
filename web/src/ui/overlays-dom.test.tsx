import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayHost } from "./OverlayHost";
import { openDomModal } from "./overlays";

describe("a modal a plugin draws into", () => {
  it("the_plugin_draws_once_the_dialog_is_there_and_cleans_up_when_closed", async () => {
    let cleaned = false;
    render(<OverlayHost />);
    const close = openDomModal("Diagram", (el) => { el.textContent = "drawn by the plugin"; return () => { cleaned = true; }; });
    await waitFor(() => expect(document.body.textContent).toContain("drawn by the plugin"));
    close();
    await waitFor(() => expect(cleaned).toBe(true));
  });

  it("has_a_close_button_because_what_is_drawn_inside_may_keep_escape_for_itself", async () => {
    let cleaned = false;
    render(<OverlayHost />);
    openDomModal("Sketch", (el) => { el.addEventListener("keydown", (e) => e.stopPropagation()); return () => { cleaned = true; }; });
    fireEvent.click(await screen.findByRole("button", { name: /close/i }));
    await waitFor(() => expect(cleaned).toBe(true));
  });
});
