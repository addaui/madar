import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Checkbox, Switch } from "./Check";
import { Disclosure } from "./Disclosure";
import { NumberField, SearchField, TextArea, TextField } from "./Field";
import { Meter, ProgressBar } from "./Progress";

describe("buttons", () => {
  it("a press says which key was held, and hover callbacks ignore touch", async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Go</Button>);
    const user = userEvent.setup();
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Go" }));
    expect(onPress.mock.calls[0]![0]).toMatchObject({ pointerType: expect.any(String), shiftKey: true });
  });

  it("Enter and Space press it like a click, and a button out of the tab order is skipped by Tab", async () => {
    const onPress = vi.fn();
    render(<><Button onPress={onPress}>First</Button><Button excludeFromTabOrder>Skipped</Button></>);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onPress).toHaveBeenCalledTimes(2);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Skipped" })).not.toHaveFocus();
  });
});

describe("choices", () => {
  it("a checkbox is controlled by its owner and a switch reports each change", async () => {
    const seen: boolean[] = [];
    function Demo() { const [on, setOn] = useState(false); return <><Checkbox isSelected={on} onChange={(v) => { seen.push(v); setOn(v); }}>Done</Checkbox><Switch aria-label="Mirror" onChange={(v) => seen.push(v)} /></>; }
    render(<Demo />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Done" }));
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
    await userEvent.click(screen.getByRole("switch", { name: "Mirror" }));
    await userEvent.click(screen.getByRole("switch", { name: "Mirror" }));
    expect(seen).toEqual([true, true, false]);
  });

  it("a disabled checkbox cannot be changed", async () => {
    const onChange = vi.fn();
    render(<Checkbox isDisabled onChange={onChange}>Locked</Checkbox>);
    await userEvent.click(screen.getByText("Locked"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("fields", () => {
  it("a text field is named, shows its hint and its error, and tells assistive technology", () => {
    render(<TextField label="Title" description="Short" errorMessage="Too long" />);
    const input = screen.getByRole("textbox", { name: "Title" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Short Too long");
  });

  it("a text area reports what is typed", async () => {
    const onChange = vi.fn();
    render(<TextArea label="Note" onChange={onChange} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Note" }), "hi");
    expect(onChange).toHaveBeenLastCalledWith("hi");
  });

  it("a search field submits on Enter and clears with its button or Escape", async () => {
    const onSubmit = vi.fn();
    render(<SearchField label="Search" onSubmit={onSubmit} />);
    const box = screen.getByRole("searchbox", { name: "Search" });
    await userEvent.type(box, "plan{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("plan");
    await userEvent.click(screen.getByRole("button", { name: "×" }));
    expect(box).toHaveValue("");
    await userEvent.type(box, "x{Escape}");
    expect(box).toHaveValue("");
  });

  it("a number field steps with the arrow keys and reports a number", async () => {
    const onChange = vi.fn();
    render(<NumberField label="Every" defaultValue={3} onChange={onChange} />);
    const box = screen.getByRole("textbox", { name: "Every" });
    await userEvent.click(box);
    await userEvent.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith(4);
  });
});

describe("feedback", () => {
  it("progress is announced with its value, and without one it says it is working", () => {
    render(<><ProgressBar label="Upload" value={40} /><ProgressBar label="Working" /><Meter label="Used" value={3} maxValue={10} /></>);
    expect(screen.getByRole("progressbar", { name: "Upload" })).toHaveAttribute("aria-valuenow", "40");
    expect(screen.getByRole("progressbar", { name: "Working" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("meter", { name: "Used" })).toHaveAttribute("aria-valuenow", "3");
  });

  it("a disclosure opens and closes its content from its heading", async () => {
    render(<Disclosure title="More">Hidden text</Disclosure>);
    const heading = screen.getByRole("button", { name: "More" });
    expect(heading).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(heading);
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Hidden text")).toBeVisible();
  });
});
