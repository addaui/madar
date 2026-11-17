import type { ReactNode } from "react";
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../lib/cn";
import { Icon } from "./Icon";

interface ChoiceProps { /** A circle instead of a rounded square (a task's done mark). */ round?: boolean; children?: ReactNode; "aria-label"?: string; isSelected?: boolean; defaultSelected?: boolean; onChange?: (selected: boolean) => void; name?: string; value?: string; isDisabled?: boolean; className?: string }

const row = "inline-flex cursor-pointer items-center gap-2 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-45";

/** A yes or no. The box is drawn here; focus, space-to-toggle, forms and the label click come from Base UI. It gives under the press and settles on release. */
export function Checkbox({ children, className, round, isSelected, defaultSelected, onChange, isDisabled, ...rest }: ChoiceProps) {
  return (
    <label className={cn(row, className)}>
      <CheckboxPrimitive.Root
        checked={isSelected}
        defaultChecked={defaultSelected}
        onCheckedChange={(on) => onChange?.(on)}
        disabled={isDisabled}
        className={cn("grid size-[18px] shrink-0 place-items-center border border-muted-foreground bg-surface text-brand-foreground outline-none transition-[background-color,border-color,transform] duration-150 active:not-data-[disabled]:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand motion-reduce:active:scale-100", round ? "rounded-full data-[checked]:border-ok data-[checked]:bg-ok" : "rounded-inner data-[checked]:border-brand data-[checked]:bg-brand")}
        {...rest}
      >
        <CheckboxPrimitive.Indicator keepMounted={false} className="grid place-items-center"><Icon name="check" className="size-3" /></CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {children}
    </label>
  );
}

/** A setting that is on or off, as a track and a thumb. */
export function Switch({ children, className, isSelected, defaultSelected, onChange, isDisabled, ...rest }: ChoiceProps) {
  return (
    <label className={cn(row, className)}>
      <SwitchPrimitive.Root
        checked={isSelected}
        defaultChecked={defaultSelected}
        onCheckedChange={(on) => onChange?.(on)}
        disabled={isDisabled}
        className="relative inline-block h-5 w-9 shrink-0 rounded-full bg-[color-mix(in_srgb,var(--text)_30%,transparent)] outline-none transition-colors duration-150 data-[checked]:bg-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        {...rest}
      >
        <SwitchPrimitive.Thumb className="absolute start-0.5 top-0.5 size-4 rounded-full bg-surface shadow-1 transition-transform duration-150 ease-out data-[checked]:translate-x-4 rtl:data-[checked]:-translate-x-4 motion-reduce:transition-none" />
      </SwitchPrimitive.Root>
      {children}
    </label>
  );
}
