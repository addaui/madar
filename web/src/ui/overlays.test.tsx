import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MenuButton } from "./Menu";
import { ModalFrame, ModalTitle } from "./Modal";
import { PopupButton } from "./Popup";
import { Segmented } from "./Segmented";
import { Select } from "./Select";
import { Tags } from "./Tags";
import { ToggleChip } from "./Toggle";

describe("choices", () => {
  it("a select shows the chosen label, opens on press and reports a plain string", async () => {
    const onChange = vi.fn();
    render(<Select label="Colour" value="a" onChange={onChange} options={[{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }]} />);
    const user = userEvent.setup();
    expect(screen.getByRole("combobox", { name: "Colour" })).toHaveTextContent("Alpha");
    await user.click(screen.getByRole("combobox", { name: "Colour" }));
    await user.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("a segmented control is a radio group: arrows move the choice", async () => {
    const Host = () => { const [v, setV] = useState("x"); return <Segmented label="Mode" value={v} onChange={setV} options={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} />; };
    render(<Host />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /X/ }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: /Y/ })).toBeChecked();
  });

  it("a toggle chip announces and flips its pressed state", async () => {
    const Host = () => { const [v, setV] = useState(false); return <ToggleChip isSelected={v} onChange={setV}>Mine</ToggleChip>; };
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Mine" }));
    expect(screen.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
  });

  it("tags can be removed with Delete or their button", async () => {
    const onRemove = vi.fn();
    render(<Tags label="Tags" tags={["one", "two"]} onRemove={onRemove} removeLabel="Remove" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Remove: two" }));
    expect(onRemove).toHaveBeenLastCalledWith("two");
    screen.getByText("one").closest("li")!.focus();
    await user.keyboard("{Delete}");
    expect(onRemove).toHaveBeenLastCalledWith("one");
  });
});

describe("overlays", () => {
  it("a menu runs the action of the row pressed and closes", async () => {
    const run = vi.fn();
    render(<MenuButton label="More" entries={[{ label: "Rename", onclick: run }, "-", { label: "Delete", danger: true }]}>…</MenuButton>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a popup hands its content a close function", async () => {
    render(<PopupButton label="Inbox" trigger="Open">{(close) => <button onClick={close}>Done</button>}</PopupButton>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Inbox" }));
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("a window closes on Escape, but not when it is not dismissable", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<ModalFrame label="W" onClose={onClose}><ModalTitle>Hi</ModalTitle></ModalFrame>);
    const user = userEvent.setup();
    expect(screen.getByRole("dialog", { name: "Hi" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
    onClose.mockClear();
    rerender(<ModalFrame label="W" onClose={onClose} dismissable={false}><ModalTitle>Hi</ModalTitle></ModalFrame>);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
