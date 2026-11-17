import type { ReactNode } from "react";
import { Toggle } from "@base-ui/react/toggle";
import { cn } from "../lib/cn";
import { interactive } from "./base";

/** A pill that is on or off (a filter, a choice in a row of choices). Pressed state is announced by Base UI. */
export function ToggleChip({ children, isSelected, onChange, isDisabled, className, "aria-label": label }: { children: ReactNode; isSelected: boolean; onChange: (selected: boolean) => void; isDisabled?: boolean; className?: string; "aria-label"?: string }) {
  return (
    <Toggle pressed={isSelected} onPressedChange={onChange} disabled={isDisabled} aria-label={label}
      className={cn(interactive, "inline-flex cursor-pointer items-center gap-1.5 rounded-chip border border-line px-3 py-1.5 text-[13px] text-muted-foreground transition-[background-color,color,border-color,transform] duration-150 hoverable active:scale-[0.97] motion-reduce:active:scale-100 data-[pressed]:border-brand data-[pressed]:bg-soft data-[pressed]:text-text focus-visible:outline-2 focus-visible:outline-brand", className)}>
      {children}
    </Toggle>
  );
}
