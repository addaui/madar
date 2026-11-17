import type { ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

/** A heading that opens and closes the content under it. The panel opens by height with a short ease-out, and not at all for someone who asked for less motion. */
export function Disclosure({ title, children, defaultExpanded, className, panelClassName }: { title: ReactNode; children: ReactNode; defaultExpanded?: boolean; className?: string; panelClassName?: string }) {
  return (
    <Collapsible.Root defaultOpen={defaultExpanded} className={cn("group", className)}>
      <h3 className="m-0">
        <Collapsible.Trigger className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-1 py-1 text-start font-semibold outline-none hoverable focus-visible:outline-2 focus-visible:outline-brand">
          <Icon name="chevron" className="size-3.5 text-muted-foreground transition-transform duration-150 group-data-[open]:rotate-90 rtl:-scale-x-100 rtl:group-data-[open]:-rotate-90" />
          {title}
        </Collapsible.Trigger>
      </h3>
      <Collapsible.Panel className={cn("h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none", panelClassName)}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
