import type { ReactNode } from "react";
import { Radio, RadioGroup } from "react-aria-components";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export interface Segment { value: string; label: ReactNode; text?: string; hint?: string; className?: string }

/** One choice out of a few, shown side by side (a priority, a colour mode). A radio group underneath, so arrows move and the choice is announced. */
export function Segmented({ label, value, onChange, options, isDisabled, className, itemClassName }: {
  label: string; value: string; onChange: (value: string) => void; options: Segment[]; isDisabled?: boolean; className?: string; itemClassName?: string;
}) {
  return (
    <RadioGroup aria-label={label} orientation="horizontal" value={value} onChange={onChange} isDisabled={isDisabled} className={cn("inline-flex gap-0.5 rounded-sm bg-sunken p-[3px]", className)}>
      {options.map((o) => {
        const item = (
          <Radio key={o.value} value={o.value} aria-label={o.text}
            className={cn("cursor-pointer rounded-inner px-2.5 py-1 text-[13px] text-muted outline-none transition-colors hoverable data-[selected]:bg-surface data-[selected]:font-semibold data-[selected]:text-text data-[selected]:shadow-1 data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45", itemClassName, o.className)}>
            {o.label}
          </Radio>
        );
        return o.hint ? <Tooltip key={o.value} label={o.hint}>{item}</Tooltip> : item;
      })}
    </RadioGroup>
  );
}
