import type { ReactNode } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "../lib/cn";
import { fieldError, popup, popupItem } from "./base";
import { Icon } from "./Icon";

export interface Option { value: string; label: ReactNode; text?: string; disabled?: boolean }

/**
 * A choice from a list. The popup is the same surface as every other list of choices (`popup` in base.ts) and grows from its button. `value` is a plain string;
 * an option with the value "" means "nothing" (it is submitted as "", so a form reads it as empty). It works inside a form too (`name`).
 */
export function Select({ label, value, defaultValue, onChange, options, name, isDisabled, className, triggerClassName, errorMessage, plain }: {
  label: string; /** No box: for a choice inside a row of settings, where the row is the box. */ plain?: boolean; value?: string; defaultValue?: string; onChange?: (value: string) => void; options: Option[]; name?: string; isDisabled?: boolean; className?: string; triggerClassName?: string; errorMessage?: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <SelectPrimitive.Root items={options.map((o) => ({ value: o.value, label: o.label }))} value={value} defaultValue={defaultValue} onValueChange={(v) => onChange?.(v === null ? "" : String(v))} name={name} disabled={isDisabled}>
        <SelectPrimitive.Trigger aria-label={label} className={cn(plain ? "flex items-center gap-1 rounded-inner px-1.5 py-1 text-end text-[13px] hoverable" : "field flex items-center justify-between gap-2 text-start", "outline-none focus-visible:outline-2 focus-visible:outline-brand data-[disabled]:opacity-45", triggerClassName)}>
          <SelectPrimitive.Value className="truncate" />
          <SelectPrimitive.Icon render={<Icon name="chevron" className="size-4 shrink-0 rotate-90 text-muted-foreground" />} />
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner side="bottom" align="start" sideOffset={4} alignItemWithTrigger={false} className="z-[80]">
            <SelectPrimitive.Popup className={cn(popup, "min-w-(--anchor-width) origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none")}>
              <SelectPrimitive.List className="max-h-72 overflow-auto outline-none">
                {options.map((o) => (
                  <SelectPrimitive.Item key={o.value} value={o.value} label={o.text ?? (typeof o.label === "string" ? o.label : o.value)} disabled={o.disabled} className={popupItem}>
                    <SelectPrimitive.ItemText className="grow truncate" dir="auto">{o.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator><Icon name="check" className="size-4 text-brand" /></SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {errorMessage && <p role="alert" className={cn("m-0", fieldError)}>{errorMessage}</p>}
    </div>
  );
}
