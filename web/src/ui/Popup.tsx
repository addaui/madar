import type { ReactNode } from "react";
import { Dialog, DialogTrigger, Popover } from "react-aria-components";
import { cn } from "../lib/cn";
import { BaseButton, type BaseButtonProps } from "./Button";
import { popup } from "./base";

/** A button that opens a small panel next to it (the inbox, the emoji picker). `children` may be a function that gets `close`. */
export function PopupButton({ label, buttonProps, onOpenChange, width = 340, children, trigger }: {
  label: string; buttonProps?: Omit<BaseButtonProps, "aria-label" | "children">; onOpenChange?: (open: boolean) => void; width?: number; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode);
}) {
  return (
    <DialogTrigger onOpenChange={onOpenChange}>
      <BaseButton aria-label={label} {...buttonProps}>{trigger}</BaseButton>
      <Popover placement="bottom start" className={cn(popup, "max-w-[92vw] p-2.5")} ref={(el) => { el?.style.setProperty("width", width + "px"); }}>
        <Dialog aria-label={label} className="outline-none">{typeof children === "function" ? ({ close }) => children(close) : children}</Dialog>
      </Popover>
    </DialogTrigger>
  );
}
