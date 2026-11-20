import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverlayHost } from "./OverlayHost";
import { askText, openDomModal } from "./overlays";

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

  it("gives_focus_back_to_what_had_it_when_a_window_opened_from_code_closes", async () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true"; editor.tabIndex = 0;
    document.body.append(editor);
    render(<OverlayHost />);
    editor.focus();
    const answer = askText("Link to a page or task");
    const field = await screen.findByRole("textbox");
    await waitFor(() => expect(document.activeElement).toBe(field));
    fireEvent.keyDown(field, { key: "Escape" });
    expect(await answer).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(editor));
    editor.remove();
  });
});
