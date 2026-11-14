import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./Button";

describe("buttons", () => {
  it("a button never submits a form by accident, and an icon button is named", async () => {
    const onPress = vi.fn(), onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button onPress={onPress}>Save</Button><IconButton icon="trash" label="Delete" onPress={onPress} /></form>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("a pending button keeps its label and ignores presses; a disabled one does too", async () => {
    const onPress = vi.fn();
    render(<><Button isPending onPress={onPress}>Saving</Button><Button isDisabled onPress={onPress}>Off</Button></>);
    await userEvent.click(screen.getByRole("button", { name: /Saving/ }));
    await userEvent.click(screen.getByRole("button", { name: "Off" }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("an icon button shows its name as a tooltip when the pointer rests on it", async () => {
    render(<IconButton icon="trash" label="Delete" />);
    await userEvent.hover(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("tooltip", {}, { timeout: 3000 })).toHaveTextContent("Delete");
  });
});
