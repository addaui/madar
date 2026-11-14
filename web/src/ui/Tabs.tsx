import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs as AriaTabs } from "react-aria-components";
import { tv } from "tailwind-variants";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

export interface TabItem { id: string; label: string; icon?: string }

const tabs = tv({
  slots: {
    list: "flex",
    tab: "inline-flex cursor-pointer items-center gap-1.5 text-muted outline-none transition-colors data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent data-[disabled]:opacity-45",
  },
  variants: {
    variant: {
      underline: { list: "gap-1 border-b border-line", tab: "border-b-2 border-transparent px-3 py-2 hover:text-text data-[selected]:border-accent data-[selected]:font-semibold data-[selected]:text-text" },
      compact: { list: "gap-0.5 border-b border-line px-3", tab: "border-b-2 border-transparent px-2.5 py-2.5 text-[13px] hover:text-text data-[selected]:border-accent data-[selected]:font-semibold data-[selected]:text-text" },
      segmented: { list: "gap-0.5 rounded-sm bg-sunken p-[3px]", tab: "flex-1 justify-center rounded-inner px-2 py-1.5 text-[13px] hover:text-text data-[selected]:bg-surface data-[selected]:font-semibold data-[selected]:text-text data-[selected]:shadow-1" },
    },
  },
  defaultVariants: { variant: "underline" },
});

/**
 * Tabs (React Aria): arrow keys move between them, the panel is tied to its tab for assistive technology. `children` is what the selected tab shows
 * (the screen keeps its own state, so only that one is rendered). `variant` is the look: an underline, a compact underline, or a pill group.
 */
export function Tabs({ label, items, selected, onSelect, variant, className, listClassName, panelClassName, panels, children }: {
  label: string; items: TabItem[]; selected: string; onSelect: (id: string) => void; variant?: "underline" | "compact" | "segmented"; className?: string; listClassName?: string; panelClassName?: string;
  /** Every panel, by tab id, kept mounted (a form that spans tabs keeps what was typed). Without it, `children` is what the selected tab shows. */
  panels?: Record<string, ReactNode>; children?: ReactNode;
}) {
  const s = tabs({ variant });
  return (
    <AriaTabs selectedKey={selected} onSelectionChange={(k) => onSelect(String(k))} className={className}>
      <TabList aria-label={label} className={s.list({ className: listClassName })}>
        {items.map((it) => (
          <Tab key={it.id} id={it.id} className={s.tab()}>
            {it.icon && <Icon name={it.icon} className="size-4" />}<span>{it.label}</span>
          </Tab>
        ))}
      </TabList>
      {panels ? items.map((it) => <TabPanel key={it.id} id={it.id} shouldForceMount className={cn("outline-none", panelClassName)}>{panels[it.id]}</TabPanel>)
        : children !== undefined && <TabPanel id={selected} className={cn("outline-none", panelClassName)}>{children}</TabPanel>}
    </AriaTabs>
  );
}
