import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "./Button";

describe("buttons", () => {
  it("a button never submits a form by accident, and an icon button is named", async () => {
    const onClick = vi.fn(), onSubmit = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    render(<form onSubmit={onSubmit}><Button onClick={onClick}>Save</Button><IconButton icon="trash" label="Delete" onClick={onClick} /></form>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onClick).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Delete" })).toHaveAttribute("title", "Delete");
  });
});
