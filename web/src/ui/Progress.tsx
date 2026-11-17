import { Meter as MeterPrimitive } from "@base-ui/react/meter";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "../lib/cn";

/** How far something has got, or (no `value`) that it is working. `label` is announced. */
export function ProgressBar({ label, value, className }: { label: string; value?: number; className?: string }) {
  const indeterminate = value === undefined;
  return (
    <ProgressPrimitive.Root aria-label={label} value={indeterminate ? null : Math.round(value)} className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)}>
      <ProgressPrimitive.Track className="h-full w-full overflow-hidden rounded-full">
        <ProgressPrimitive.Indicator className={cn("block h-full rounded-full bg-brand transition-[width] duration-200 ease-out", indeterminate && "w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite] motion-reduce:animate-none")} />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

/** A quantity against a maximum (the bars of the overview). `color` is a CSS colour or variable. */
export function Meter({ label, value, maxValue, color, className }: { label: string; value: number; maxValue: number; color?: string; className?: string }) {
  return (
    <MeterPrimitive.Root aria-label={label} value={value} min={0} max={Math.max(1, maxValue)} className={cn("h-2 overflow-hidden rounded-full bg-sunken", className)}>
      <MeterPrimitive.Track className="h-full w-full overflow-hidden rounded-full">
        <MeterPrimitive.Indicator className="block h-full rounded-full bg-brand transition-[width] duration-200 ease-out" ref={(el) => { if (el && color) el.style.background = color; }} />
      </MeterPrimitive.Track>
    </MeterPrimitive.Root>
  );
}
