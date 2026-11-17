import type { ReactNode } from "react";
import { Button as AriaButton, Disclosure as AriaDisclosure, DisclosurePanel, Heading } from "react-aria-components";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

/** A heading that opens and closes the content under it (React Aria: the button is the heading's, the panel is tied to it). */
export function Disclosure({ title, children, defaultExpanded, className, panelClassName }: { title: ReactNode; children: ReactNode; defaultExpanded?: boolean; className?: string; panelClassName?: string }) {
  return (
    <AriaDisclosure defaultExpanded={defaultExpanded} className={cn("group", className)}>
      <Heading className="m-0">
        <AriaButton slot="trigger" className="flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-1 py-1 text-start font-semibold outline-none hoverable data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand">
          <Icon name="chevron" className="size-3.5 text-muted-foreground transition-transform group-data-[expanded]:rotate-90 rtl:-scale-x-100 rtl:group-data-[expanded]:-rotate-90" />
          {title}
        </AriaButton>
      </Heading>
      <DisclosurePanel className={panelClassName}>{children}</DisclosurePanel>
    </AriaDisclosure>
  );
}
