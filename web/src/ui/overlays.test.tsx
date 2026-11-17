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

import { ColorField, hexToHsv, hsvToHex } from "./ColorField";
import { ComboBox } from "./ComboBox";
import { DataTable } from "./Table";
import { SearchList } from "./SearchList";
import { Slider } from "./Slider";
import { FileDrop } from "./FileDrop";
import { BaseLink } from "./Link";

describe("the rest of the kit", () => {
  it("colours convert both ways without drifting", () => {
    for (const hex of ["#ff0000", "#3a7bd5", "#000000", "#ffffff", "#808080"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  it("a colour typed in the hex box is reported when the picker closes", async () => {
    const onChange = vi.fn();
    render(<ColorField label="Accent" value="#000000" onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Accent" }));
    const box = (await screen.findAllByLabelText("Accent")).find((e) => e.tagName === "INPUT" && e.getAttribute("type") !== "range")!;
    await user.clear(box); await user.type(box, "#336699");
    await user.keyboard("{Escape}");
    expect(onChange).toHaveBeenCalledWith("#336699");
  });

  it("a slider moves with the arrow keys and says its value", async () => {
    const onChange = vi.fn();
    render(<Slider label="Size" value={5} onChange={onChange} minValue={0} maxValue={10} />);
    screen.getByRole("slider", { name: "Size" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("a table row opens with Enter, and an empty table says so", async () => {
    const onOpen = vi.fn();
    const cols = [{ id: "n", label: "Name", isRowHeader: true }];
    const { rerender } = render(<DataTable label="T" columns={cols} rows={[{ id: "1" }]} cell={() => "one"} onOpen={onOpen} />);
    screen.getByRole("row", { name: /one/ }).focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith("1");
    rerender(<DataTable label="T" columns={cols} rows={[]} cell={() => ""} empty="Nothing" />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
  });

  it("a search list picks with the arrow keys and Enter while the focus stays in the field", async () => {
    const onPick = vi.fn();
    render(<SearchList label="Find" value="q" onChange={() => undefined} items={[{ id: "a", text: "A" }, { id: "b", text: "B" }]} onPick={onPick} render={(i) => i.text} empty="none" />);
    const input = screen.getByRole("combobox", { name: "Find" });
    expect(input).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledWith({ id: "b", text: "B" });
  });

  it("a combo box commits what is typed on Enter, and a suggestion when picked", async () => {
    const onCommit = vi.fn();
    const Host = () => { const [v, setV] = useState(""); return <ComboBox label="Tag" inputValue={v} onInputChange={setV} suggestions={["red", "green"]} onCommit={onCommit} />; };
    render(<Host />);
    const user = userEvent.setup();
    await user.type(screen.getByRole("combobox", { name: "Tag" }), "blue{Enter}");
    expect(onCommit).toHaveBeenCalledWith("blue");
    expect(screen.getByRole("combobox", { name: "Tag" })).toHaveValue("");
  });

  it("a file drop passes on only the types it accepts", () => {
    const onFile = vi.fn();
    render(<FileDrop label="Drop" accept={["image/png"]} onFile={onFile}>x</FileDrop>);
    const zone = screen.getByRole("group", { name: "Drop" });
    const drop = (f: File) => { const e = new Event("drop", { bubbles: true, cancelable: true }); Object.assign(e, { dataTransfer: { files: [f], items: [] } }); zone.dispatchEvent(e); };
    drop(new File(["x"], "a.txt", { type: "text/plain" }));
    expect(onFile).not.toHaveBeenCalled();
    drop(new File(["x"], "a.png", { type: "image/png" }));
    expect(onFile).toHaveBeenCalledOnce();
  });

  it("a link is a real anchor, and onPress is skipped when a new tab is asked for", async () => {
    const onPress = vi.fn();
    render(<BaseLink href="#/x" onPress={onPress}>go</BaseLink>);
    expect(screen.getByRole("link", { name: "go" })).toHaveAttribute("href", "#/x");
    const user = userEvent.setup();
    await user.keyboard("{Control>}"); await user.click(screen.getByRole("link", { name: "go" })); await user.keyboard("{/Control}");
    expect(onPress).not.toHaveBeenCalled();
    await user.click(screen.getByRole("link", { name: "go" }));
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe("right to left", () => {
  it("a select's chevron still points down when the page is mirrored", () => {
    render(<Select label="C" value="a" options={[{ value: "a", label: "A" }]} />);
    const chevron = screen.getByRole("combobox", { name: "C" }).querySelector("svg")!;
    // The icon is mirrored in right-to-left (Icon), which would turn a quarter-turn into the opposite quarter-turn, so the turn is reversed there too.
    expect(chevron.getAttribute("class")).toMatch(/rotate-90/);
    expect(chevron.getAttribute("class")).toMatch(/rtl:-rotate-90/);
  });
});
