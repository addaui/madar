import { Label, Slider as AriaSlider, SliderOutput, SliderThumb, SliderTrack } from "react-aria-components";
import { cn } from "../lib/cn";
import { fieldLabel } from "./base";

/** A value in a range, dragged or moved with the arrow keys. `onChangeEnd` fires when the pointer is released, so a save is not sent for every pixel. */
export function Slider({ label, showLabel, value, onChange, onChangeEnd, minValue, maxValue, step, format, isDisabled, className }: {
  label: string; showLabel?: boolean; value: number; onChange: (v: number) => void; onChangeEnd?: (v: number) => void; minValue: number; maxValue: number; step?: number; format?: (v: number) => string; isDisabled?: boolean; className?: string;
}) {
  return (
    <AriaSlider value={value} onChange={onChange} onChangeEnd={onChangeEnd} minValue={minValue} maxValue={maxValue} step={step} isDisabled={isDisabled} className={cn("grid min-w-28 gap-1 data-[disabled]:opacity-45", className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className={showLabel ? fieldLabel : "sr-only"}>{label}</Label>
        <SliderOutput className="text-[12.5px] tabular-nums text-muted-foreground">{({ state }) => (format ? format(state.values[0]!) : String(state.values[0]))}</SliderOutput>
      </div>
      <SliderTrack className="relative h-5 w-full">
        {({ state }) => (
          <>
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-line-strong" />
            <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-brand" ref={(el) => { if (el) { el.style.insetInlineStart = "0"; el.style.width = state.getThumbPercent(0) * 100 + "%"; } }} />
            <SliderThumb className="top-1/2 size-4 rounded-full border-2 border-brand bg-surface shadow-1 outline-none data-[dragging]:scale-110 data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand" />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
