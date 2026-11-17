import { useRef } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { cn } from "../lib/cn";
import { popup, popupItem } from "./base";

/**
 * A text field with suggestions underneath (Base UI's combo box). The person may type something that is not suggested;
 * `onCommit` is called with whatever they chose or typed when they press Enter or pick a suggestion.
 */
export function ComboBox({ label, inputValue, onInputChange, suggestions, onCommit, placeholder, maxLength, className }: {
  label: string; inputValue: string; onInputChange: (v: string) => void; suggestions: string[]; onCommit: (v: string) => void; placeholder?: string; maxLength?: number; className?: string;
}) {
  const highlighted = useRef(false);
  return (
    <Combobox.Root items={suggestions} value={null} inputValue={inputValue} onInputValueChange={(v, d) => { if (d.reason !== "item-press") onInputChange(v); }}
      onValueChange={(v) => { if (v !== null) { onCommit(String(v)); onInputChange(""); } }} onItemHighlighted={(v) => { highlighted.current = v !== undefined && v !== null; }}
      openOnInputClick filter={null}>
      <div className={cn("grid gap-1", className)}>
        <Combobox.Input aria-label={label} className="field w-full" placeholder={placeholder} maxLength={maxLength} dir="auto" autoComplete="off" spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter" && !highlighted.current && inputValue.trim()) { e.preventDefault(); onCommit(inputValue.trim()); onInputChange(""); } }} />
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} align="start" className="z-[80]">
          <Combobox.Popup className={cn(popup, "min-w-(--anchor-width) origin-(--transform-origin) empty:hidden")}>
            <Combobox.List className="max-h-60 overflow-auto outline-none">
              {(s: string) => <Combobox.Item key={s} value={s} className={popupItem}><span dir="auto">{s}</span></Combobox.Item>}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
