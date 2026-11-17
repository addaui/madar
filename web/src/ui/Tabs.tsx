import type { ReactNode } from "react";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { tv } from "tailwind-variants";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

export interface TabItem { id: string; label: string; icon?: string }

const tabs = tv({
  slots: {
    list: "flex",
    tab: "inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground outline-none transition-colors focus-visible:outline-2 focus-visible:outline-brand data-[disabled]:opacity-45",
  },
  variants: {
    variant: {
      underline: { list: "gap-1 border-b border-line", tab: "border-b-2 border-transparent px-3 py-2 hover:text-text data-[active]:border-brand data-[active]:font-semibold data-[active]:text-text" },
      compact: { list: "gap-1 border-b border-line px-4", tab: "border-b-2 border-transparent px-3 py-3 text-[13px] hover:text-text data-[active]:border-brand data-[active]:font-semibold data-[active]:text-text" },
      segmented: { list: "gap-0.5 rounded-sm bg-sunken p-[3px]", tab: "flex-1 justify-center rounded-inner px-2 py-1.5 text-[13px] hover:text-text data-[active]:bg-surface data-[active]:font-semibold data-[active]:text-text data-[active]:shadow-1" },
    },
  },
  defaultVariants: { variant: "underline" },
});

/**
 * Tabs (Base UI): arrow keys move between them, the panel is tied to its tab for assistive technology. `children` is what the selected tab shows
 * (the screen keeps its own state, so only that one is rendered). `variant` is the look: an underline, a compact underline, or a pill group.
 */
export function Tabs({ label, items, selected, onSelect, variant, className, listClassName, panelClassName, panels, children }: {
  label: string; items: TabItem[]; selected: string; onSelect: (id: string) => void; variant?: "underline" | "compact" | "segmented"; className?: string; listClassName?: string; panelClassName?: string;
  /** Every panel, by tab id, kept mounted (a form that spans tabs keeps what was typed). Without it, `children` is what the selected tab shows. */
  panels?: Record<string, ReactNode>; children?: ReactNode;
}) {
  const s = tabs({ variant });
  return (
    <TabsPrimitive.Root value={selected} onValueChange={(k) => onSelect(String(k))} className={className}>
      <TabsPrimitive.List activateOnFocus aria-label={label} className={s.list({ className: listClassName })}>
        {items.map((it) => (
          <TabsPrimitive.Tab key={it.id} value={it.id} className={s.tab()}>
            {it.icon && <Icon name={it.icon} className="size-4" />}<span>{it.label}</span>
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
      {panels ? items.map((it) => <TabsPrimitive.Panel key={it.id} value={it.id} keepMounted className={cn("outline-none", panelClassName)}>{panels[it.id]}</TabsPrimitive.Panel>)
        : children !== undefined && <TabsPrimitive.Panel value={selected} className={cn("outline-none", panelClassName)}>{children}</TabsPrimitive.Panel>}
    </TabsPrimitive.Root>
  );
}
