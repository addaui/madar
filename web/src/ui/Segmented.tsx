import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

export interface Segment { value: string; label: ReactNode; text?: string; hint?: string; className?: string }

/** One choice out of a few, shown side by side (a priority, a colour mode). A radio group underneath, so arrows move and the choice is announced. */
export function Segmented({ label, value, onChange, options, isDisabled, className, itemClassName }: {
  label: string; value: string; onChange: (value: string) => void; options: Segment[]; isDisabled?: boolean; className?: string; itemClassName?: string;
}) {
  return (
    <RadioGroup aria-label={label} value={value} onValueChange={(v) => onChange(String(v))} disabled={isDisabled} className={cn("inline-flex gap-0.5 rounded-sm bg-sunken p-[3px]", className)}>
      {options.map((o) => {
        const item = (
          <Radio.Root key={o.value} value={o.value} aria-label={o.text}
            className={cn("cursor-pointer rounded-inner px-2.5 py-1 text-[13px] text-muted-foreground outline-none transition-[background-color,color,box-shadow] duration-150 hoverable active:scale-[0.97] motion-reduce:active:scale-100 data-[checked]:bg-surface data-[checked]:font-semibold data-[checked]:text-text data-[checked]:shadow-1 focus-visible:outline-2 focus-visible:outline-brand data-[disabled]:opacity-45", itemClassName, o.className)}>
            {o.label}
          </Radio.Root>
        );
        return o.hint ? <Tooltip key={o.value} label={o.hint}>{item}</Tooltip> : item;
      })}
    </RadioGroup>
  );
}
