import { ComboBox as AriaComboBox, Input, Label, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { cn } from "../lib/cn";
import { popup, popupItem } from "./base";

/**
 * A text field with suggestions underneath (React Aria's combo box). The person may type something that is not suggested (`allowsCustomValue`);
 * `onCommit` is called with whatever they chose or typed when they press Enter or pick a suggestion.
 */
export function ComboBox({ label, inputValue, onInputChange, suggestions, onCommit, placeholder, maxLength, className }: {
  label: string; inputValue: string; onInputChange: (v: string) => void; suggestions: string[]; onCommit: (v: string) => void; placeholder?: string; maxLength?: number; className?: string;
}) {
  return (
    <AriaComboBox aria-label={label} allowsCustomValue menuTrigger="focus" inputValue={inputValue} onInputChange={onInputChange} className={cn("grid gap-1", className)}
      onSelectionChange={(k) => { if (k !== null) { onCommit(String(k)); setTimeout(() => onInputChange(""), 0); } }}   // the library puts the chosen text back in the field: empty it once the choice is taken
      onKeyDown={(e) => { if (e.key === "Enter" && inputValue.trim()) { onCommit(inputValue.trim()); setTimeout(() => onInputChange(""), 0); } }}>
      <Label className="sr-only">{label}</Label>
      <Input className="field w-full" placeholder={placeholder} maxLength={maxLength} dir="auto" autoComplete="off" spellCheck={false} />
      <Popover className={cn(popup, "min-w-(--trigger-width)")} offset={4}>
        <ListBox className="max-h-60 overflow-auto outline-none">
          {suggestions.map((s) => <ListBoxItem key={s} id={s} textValue={s} className={popupItem}><span dir="auto">{s}</span></ListBoxItem>)}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
