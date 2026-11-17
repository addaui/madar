import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Check";
import { DateField } from "./DateField";
import { NumberField, TextField } from "./Field";
import { Segmented } from "./Segmented";
import { Select } from "./Select";
import { Tabs } from "./Tabs";
import { I18nProvider } from "../i18n/i18n";

const entries = (form: HTMLFormElement) => Object.fromEntries([...new FormData(form).entries()].map(([k, v]) => [k, String(v)]));

describe("the kit's controls work in a form", () => {
  it("a form reads what each control holds, and 'nothing' as empty", () => {
    const { container } = render(
      <form>
        <TextField name="title" label="Title" defaultValue="Plan" />
        <Select name="assignee" label="Assignee" defaultValue="" options={[{ value: "", label: "Nobody" }, { value: "ann", label: "Ann" }]} />
        <Select name="status" label="Status" defaultValue="doing" options={[{ value: "todo", label: "To do" }, { value: "doing", label: "Doing" }]} />
        <NumberField name="every" label="Every" defaultValue={3} />
        <Checkbox name="mirror" aria-label="Mirror" defaultSelected />
        <DateField name="due" label="Due" value="2026-11-20" onChange={() => undefined} />
      </form>,
    );
    expect(entries(container.querySelector("form")!)).toMatchObject({ title: "Plan", assignee: "", status: "doing", every: "3", mirror: "on", due: "2026-11-20" });
  });
});

describe("choices", () => {
  it("a segmented control is a radio group: the choice is announced and arrows move it", async () => {
    const onChange = vi.fn();
    function Demo() { const [v, setV] = useState("low"); return <Segmented label="Priority" value={v} onChange={(x) => { setV(x); onChange(x); }} options={[{ value: "low", label: "Low" }, { value: "high", label: "High" }]} />; }
    render(<Demo />);
    expect(screen.getByRole("radio", { name: "Low" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(onChange).toHaveBeenCalledWith("high");
  });

  it("tabs are tied to their panel and the arrow keys move between them", async () => {
    function Demo() { const [t, setT] = useState("a"); return <Tabs label="Lists" items={[{ id: "a", label: "A" }, { id: "b", label: "B" }]} selected={t} onSelect={setT}>content of {t}</Tabs>; }
    render(<Demo />);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("content of a");
    await userEvent.click(screen.getByRole("tab", { name: "A" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "B" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("content of b");
  });
});

describe("the combo box", () => {
  it("empties its field once a suggestion is chosen or Enter adds the typed text", async () => {
    const { ComboBox } = await import("./ComboBox");
    const added: string[] = [];
    function Demo() {
      const [v, setV] = useState("");
      return <ComboBox label="Add a tag" inputValue={v} onInputChange={setV} suggestions={["work", "home"].filter((s) => s.includes(v))} onCommit={(x) => added.push(x)} />;
    }
    render(<Demo />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "wo");
    await userEvent.click(await screen.findByRole("option", { name: "work" }));
    expect(added).toContain("work");
    await vi.waitFor(() => expect(input).toHaveValue(""));
    await userEvent.type(input, "new{Enter}");
    expect(added).toContain("new");
    await vi.waitFor(() => expect(input).toHaveValue(""));
  });
});

describe("the date field follows the app, not the browser", () => {
  it("shows the date in the app's language and picks from a month grid", async () => {
    const onChange = vi.fn();
    render(<I18nProvider lang="ar"><DateField label="Due" value="2026-11-20" onChange={onChange} /></I18nProvider>);
    const trigger = screen.getByRole("button", { name: "Due" });
    await userEvent.click(trigger);
    expect(await screen.findByText(/نوفمبر/)).toBeTruthy();   // the month is named in Arabic, whatever the browser's language is
    await userEvent.click(screen.getByRole("button", { name: /(25|٢٥)/ }));
    expect(onChange).toHaveBeenCalledWith("2026-11-25");
  });
  it("says there is no date, and clears", async () => {
    const onChange = vi.fn();
    render(<I18nProvider lang="en"><DateField label="Due" value="" onChange={onChange} /></I18nProvider>);
    expect(screen.getByRole("button", { name: "Due" }).textContent).toBe("No date");
  });
});
