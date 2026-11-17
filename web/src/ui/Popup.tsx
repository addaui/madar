import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "../lib/cn";
import { BaseButton, type BaseButtonProps } from "./Button";
import { popup } from "./base";

/** A button that opens a small panel next to it (the inbox, the emoji picker). `children` may be a function that gets `close`. */
export function PopupButton({ label, buttonProps, onOpenChange, width = 340, children, trigger }: {
  label: string; buttonProps?: Omit<BaseButtonProps, "aria-label" | "children">; onOpenChange?: (open: boolean) => void; width?: number; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const change = (o: boolean) => { setOpen(o); onOpenChange?.(o); };
  return (
    <Popover.Root open={open} onOpenChange={change}>
      <Popover.Trigger render={<BaseButton aria-label={label} {...buttonProps} />}>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]">
          <Popover.Popup aria-label={label} ref={(el) => { el?.style.setProperty("width", width + "px"); }}
            className={cn(popup, "max-w-[92vw] origin-(--transform-origin) p-2.5 outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none")}>
            {typeof children === "function" ? children(() => change(false)) : children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
