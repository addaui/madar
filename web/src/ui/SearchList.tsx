import type { ReactNode } from "react";
import { Autocomplete, Input, Label, ListBox, ListBoxItem, SearchField } from "react-aria-components";
import { cn } from "../lib/cn";
import { popupItem } from "./base";
import { Icon } from "./Icon";

export interface SearchItem { id: string; text: string }

/**
 * A search field with its results listed under it, as one control (React Aria's Autocomplete): typing keeps the focus in the field while the arrow keys
 * move through the results, and Enter or a click picks one. The results come from the caller (the Core searches); nothing is filtered here.
 */
export function SearchList<T extends SearchItem>({ label, placeholder, value, onChange, items, onPick, render, empty, extra, className, listClassName }: {
  label: string; placeholder?: string; value: string; onChange: (v: string) => void; items: T[]; onPick: (item: T) => void; render: (item: T) => ReactNode;
  /** What to show when there are no results (a hint, or "nothing found"). */
  empty: ReactNode; extra?: ReactNode; className?: string; listClassName?: string;
}) {
  return (
    <Autocomplete inputValue={value} onInputChange={onChange}>
      <div className={cn("flex items-center gap-2", className)}>
        <SearchField autoFocus aria-label={label} className="group relative grow">
          <Label className="sr-only">{label}</Label>
          <span className="relative block">
            <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input className="field w-full ps-8 [&::-webkit-search-cancel-button]:hidden" placeholder={placeholder} dir="auto" />
          </span>
        </SearchField>
        {extra}
      </div>
      <ListBox aria-label={label} items={items} onAction={(k) => { const it = items.find((x) => x.id === String(k)); if (it) onPick(it); }}
        renderEmptyState={() => <div className="px-3 py-4 text-muted">{empty}</div>} className={cn("m-0 mt-3 grid max-h-[50vh] gap-0.5 overflow-auto outline-none", listClassName)}>
        {(item) => <ListBoxItem id={item.id} textValue={item.text} className={cn(popupItem, "items-start")}>{render(item)}</ListBoxItem>}
      </ListBox>
    </Autocomplete>
  );
}
