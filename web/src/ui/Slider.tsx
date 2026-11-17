import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../lib/cn";
import { fieldLabel } from "./base";

/** A value in a range, dragged or moved with the arrow keys. `onChangeEnd` fires when the pointer is released, so a save is not sent for every pixel. */
export function Slider({ label, showLabel, value, onChange, onChangeEnd, minValue, maxValue, step, format, isDisabled, className }: {
  label: string; showLabel?: boolean; value: number; onChange: (v: number) => void; onChangeEnd?: (v: number) => void; minValue: number; maxValue: number; step?: number; format?: (v: number) => string; isDisabled?: boolean; className?: string;
}) {
  return (
    <SliderPrimitive.Root value={value} onValueChange={(v) => onChange(Array.isArray(v) ? v[0]! : (v as number))} onValueCommitted={(v) => onChangeEnd?.(Array.isArray(v) ? v[0]! : (v as number))}
      min={minValue} max={maxValue} step={step} disabled={isDisabled} className={cn("grid min-w-28 gap-1 data-[disabled]:opacity-45", className)}>
      <div className="flex items-center justify-between gap-2">
        <SliderPrimitive.Label className={showLabel ? fieldLabel : "sr-only"}>{label}</SliderPrimitive.Label>
        <SliderPrimitive.Value className="text-[12.5px] tabular-nums text-muted-foreground">{(_f, values) => (format ? format(values[0]!) : String(values[0]))}</SliderPrimitive.Value>
      </div>
      <SliderPrimitive.Control className="flex h-5 w-full touch-none items-center">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-line-strong">
          <SliderPrimitive.Indicator className="rounded-full bg-brand" />
          <SliderPrimitive.Thumb aria-label={label} className="size-4 rounded-full border-2 border-brand bg-surface shadow-1 outline-none transition-transform duration-150 data-[dragging]:scale-110 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand motion-reduce:transition-none" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
