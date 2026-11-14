import type { ReactNode } from "react";
import { Checkbox as AriaCheckbox, Switch as AriaSwitch } from "react-aria-components";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

interface ChoiceProps { /** A circle instead of a rounded square (a task's done mark). */ round?: boolean; children?: ReactNode; "aria-label"?: string; isSelected?: boolean; defaultSelected?: boolean; onChange?: (selected: boolean) => void; name?: string; value?: string; isDisabled?: boolean; className?: string }

/** A yes or no. The box is drawn here; focus, space-to-toggle, forms and the label click come from React Aria. */
export function Checkbox({ children, className, round, ...rest }: ChoiceProps) {
  return (
    <AriaCheckbox className={cn("group inline-flex cursor-pointer items-center gap-2 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45", className)} {...rest}>
      {({ isSelected }) => (
        <>
          <span className={cn("grid size-[18px] shrink-0 place-items-center border border-line-strong bg-surface text-on-accent transition-colors group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-accent", round ? "rounded-full group-data-[selected]:border-ok group-data-[selected]:bg-ok" : "rounded-inner group-data-[selected]:border-accent group-data-[selected]:bg-accent")}>
            {isSelected && <Icon name="check" className="size-3" />}
          </span>
          {children}
        </>
      )}
    </AriaCheckbox>
  );
}

/** A setting that is on or off, as a track and a thumb. */
export function Switch({ children, className, ...rest }: ChoiceProps) {
  return (
    <AriaSwitch className={cn("group inline-flex cursor-pointer items-center gap-2 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45", className)} {...rest}>
      <span className="relative inline-block h-5 w-9 shrink-0 rounded-full bg-line-strong transition-colors group-data-[selected]:bg-accent group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-accent">
        <span className="absolute start-0.5 top-0.5 size-4 rounded-full bg-surface shadow-1 transition-transform group-data-[selected]:translate-x-4 rtl:group-data-[selected]:-translate-x-4" />
      </span>
      {children}
    </AriaSwitch>
  );
}
