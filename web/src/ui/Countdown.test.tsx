import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n/i18n";
import { OverlayHost } from "./OverlayHost";
import { askCountdown } from "./overlays";

const show = () => render(<I18nProvider lang="en"><OverlayHost /></I18nProvider>);

describe("the countdown", () => {
  it("shows the seconds left and says true when it runs out", async () => {
    show();
    const answer = askCountdown("Team", 1);
    expect(await screen.findByText("Deleting in 1…")).toBeTruthy();
    expect(await answer).toBe(true);
  });

  it("says false at once when the person stops it, and the window goes away", async () => {
    show();
    const answer = askCountdown("Team", 3);
    await userEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await answer).toBe(false);
    expect(screen.queryByText(/Deleting in/)).toBeNull();
  });
});
