import type { ReactNode } from "react";
import { Button as AriaButton, FieldError, ListBox, ListBoxItem, Popover, Select as AriaSelect, SelectValue } from "react-aria-components";
import { cn } from "../lib/cn";
import { fieldError, popup, popupItem } from "./base";
import { Icon } from "./Icon";

export interface Option { value: string; label: ReactNode; text?: string; disabled?: boolean }

/**
 * A choice from a list. The popup is the same surface as every other list of choices (`popup` in base.ts). `value` is a plain string; an option with
 * the value "" means "nothing" (it is submitted as "", so a form reads it as empty). It works inside a form too (`name`).
 */
export function Select({ label, value, defaultValue, onChange, options, name, isDisabled, className, triggerClassName, errorMessage, plain }: {
  label: string; /** No box: for a choice inside a row of settings, where the row is the box. */ plain?: boolean; value?: string; defaultValue?: string; onChange?: (value: string) => void; options: Option[]; name?: string; isDisabled?: boolean; className?: string; triggerClassName?: string; errorMessage?: string;
}) {
  return (
    <AriaSelect aria-label={label} className={cn("grid gap-1", className)} name={name} isDisabled={isDisabled}
      selectedKey={value} defaultSelectedKey={defaultValue} onSelectionChange={(k) => onChange?.(k === null ? "" : String(k))}>
      <AriaButton className={cn(plain ? "flex items-center gap-1 rounded-inner px-1.5 py-1 text-end text-[13px] hoverable" : "field flex items-center justify-between gap-2 text-start", "outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-60", triggerClassName)}>
        <SelectValue className="truncate" />
        <Icon name="chevron" className="size-4 shrink-0 rotate-90 text-muted" />
      </AriaButton>
      {errorMessage && <FieldError className={fieldError}>{errorMessage}</FieldError>}
      <Popover className={cn(popup, "min-w-(--trigger-width)")} placement="bottom start" offset={4}>
        <ListBox className="max-h-72 overflow-auto outline-none">
          {options.map((o) => (
            <ListBoxItem key={o.value} id={o.value} textValue={o.text ?? (typeof o.label === "string" ? o.label : o.value)} isDisabled={o.disabled} className={popupItem}>
              {({ isSelected }) => (<><span className="grow truncate" dir="auto">{o.label}</span>{isSelected && <Icon name="check" className="size-4 text-accent" />}</>)}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
