import type { ReactNode } from "react";
import { ToggleButton } from "react-aria-components";
import { cn } from "../lib/cn";
import { interactive } from "./base";

/** A pill that is on or off (a filter, a choice in a row of choices). Pressed state is announced by React Aria. */
export function ToggleChip({ children, isSelected, onChange, isDisabled, className, "aria-label": label }: { children: ReactNode; isSelected: boolean; onChange: (selected: boolean) => void; isDisabled?: boolean; className?: string; "aria-label"?: string }) {
  return (
    <ToggleButton isSelected={isSelected} onChange={onChange} isDisabled={isDisabled} aria-label={label}
      className={cn(interactive, "inline-flex cursor-pointer items-center gap-1.5 rounded-chip border border-line px-3 py-1.5 text-[13px] text-muted-foreground hoverable data-[selected]:border-brand data-[selected]:bg-soft data-[selected]:text-text data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand", className)}>
      {children}
    </ToggleButton>
  );
}
