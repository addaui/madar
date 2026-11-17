import { useId, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { popupItem } from "./base";
import { Icon } from "./Icon";

export interface SearchItem { id: string; text: string }

/**
 * A search field with its results listed under it, as one control: typing keeps the focus in the field while the arrow keys move through the results
 * (the field points at the active one with aria-activedescendant), and Enter or a click picks one. The results come from the caller (the Core searches); nothing is filtered here.
 */
export function SearchList<T extends SearchItem>({ label, placeholder, value, onChange, items, onPick, render, empty, extra, className, listClassName }: {
  label: string; placeholder?: string; value: string; onChange: (v: string) => void; items: T[]; onPick: (item: T) => void; render: (item: T) => ReactNode;
  /** What to show when there are no results (a hint, or "nothing found"). */
  empty: ReactNode; extra?: ReactNode; className?: string; listClassName?: string;
}) {
  const base = useId();
  // The active row belongs to the list it was chosen in: a new list starts at its first row.
  const [pos, setPos] = useState<{ items: T[]; i: number }>({ items, i: 0 });
  const active = pos.items === items ? pos.i : 0;
  const setActive = (i: number) => setPos({ items, i });
  const optionId = (i: number) => base + "-" + i;
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      setActive(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const it = items[active];
      if (it) { e.preventDefault(); onPick(it); }
    }
  };
  return (
    <>
      <div className={cn("flex items-center gap-2", className)}>
        <div className="relative grow">
          <label htmlFor={base} className="sr-only">{label}</label>
          <Icon name="search" className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input id={base} type="search" autoFocus role="combobox" aria-expanded="true" aria-controls={base + "-list"} aria-autocomplete="list" aria-activedescendant={items[active] ? optionId(active) : undefined}
            value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={key} placeholder={placeholder} dir="auto" autoComplete="off"
            className="field w-full ps-8 [&::-webkit-search-cancel-button]:hidden" />
        </div>
        {extra}
      </div>
      <ul id={base + "-list"} role="listbox" aria-label={label} className={cn("m-0 mt-3 grid max-h-[50vh] list-none gap-0.5 overflow-auto p-0 outline-none", listClassName)}>
        {items.length === 0 && <li role="presentation" className="px-3 py-4 text-muted-foreground">{empty}</li>}
        {items.map((item, i) => (
          <li key={item.id} id={optionId(i)} role="option" aria-selected={i === active} data-highlighted={i === active ? "" : undefined}
            onMouseMove={() => setActive(i)} onClick={() => onPick(item)} className={cn(popupItem, "items-start")}>{render(item)}</li>
        ))}
      </ul>
    </>
  );
}
