import { Meter as AriaMeter, ProgressBar as AriaProgressBar } from "react-aria-components";
import { cn } from "../lib/cn";

/** How far something has got, or (no `value`) that it is working. `label` is announced. */
export function ProgressBar({ label, value, className }: { label: string; value?: number; className?: string }) {
  return (
    <AriaProgressBar aria-label={label} value={value === undefined ? undefined : Math.round(value)} isIndeterminate={value === undefined} className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)}>
      {({ percentage, isIndeterminate }) => (
        <span className={cn("block h-full rounded-full bg-brand", isIndeterminate && "w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite]")} ref={(el) => { if (el && !isIndeterminate) el.style.width = (percentage ?? 0) + "%"; }} />
      )}
    </AriaProgressBar>
  );
}

/** A quantity against a maximum (the bars of the overview). `color` is a CSS colour or variable. */
export function Meter({ label, value, maxValue, color, className }: { label: string; value: number; maxValue: number; color?: string; className?: string }) {
  return (
    <AriaMeter aria-label={label} value={value} minValue={0} maxValue={Math.max(1, maxValue)} className={cn("h-2 overflow-hidden rounded-full bg-sunken", className)}>
      {({ percentage }) => <span className="block h-full rounded-full bg-brand" ref={(el) => { if (el) { el.style.width = percentage + "%"; if (color) el.style.background = color; } }} />}
    </AriaMeter>
  );
}

