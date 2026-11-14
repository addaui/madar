import { useState } from "react";
import { Button as AriaButton, ColorArea, ColorField as AriaColorField, ColorPicker, ColorSlider, ColorSwatch, ColorThumb, Dialog, DialogTrigger, Input, Popover, SliderTrack, parseColor } from "react-aria-components";
import { cn } from "../lib/cn";
import { popup } from "./base";

const asColor = (v: string) => { try { return parseColor(v || "#000000"); } catch { return parseColor("#000000"); } };

/** A colour: a swatch that opens an area and a hue slider, with the hex code to type. The value is "#rrggbb". */
export function ColorField({ label, value, onChange, live, isDisabled, className }: { label: string; value: string; onChange: (hex: string) => void; /** Report every change while the colour is dragged (for a live preview); otherwise only when the picker closes. */ live?: boolean; isDisabled?: boolean; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <ColorPicker value={asColor(shown)} onChange={(c) => { const hex = c.toString("hex"); if (live) onChange(hex); else setDraft(hex); }}>
      <DialogTrigger onOpenChange={(open) => { if (!open && draft !== null) { if (draft !== value) onChange(draft); setDraft(null); } }}>
        <AriaButton aria-label={label} isDisabled={isDisabled} className={cn("inline-flex items-center gap-1.5 rounded-sm outline-none data-[disabled]:opacity-45 data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent", className)}>
          <ColorSwatch className="size-7 rounded-sm border border-line-strong" />
          <span className="text-[12.5px] tabular-nums text-muted" dir="ltr">{shown}</span>
        </AriaButton>
        <Popover className={cn(popup, "p-3")} placement="bottom start" offset={6}>
          <Dialog aria-label={label} className="grid w-48 gap-3 outline-none">
            <ColorArea colorSpace="hsb" xChannel="saturation" yChannel="brightness" className="h-36 w-full rounded-sm">
              <ColorThumb className="size-4 rounded-full border-2 border-white shadow-2 data-[focus-visible]:size-5" />
            </ColorArea>
            <ColorSlider colorSpace="hsb" channel="hue" aria-label={label}>
              <SliderTrack className="h-4 w-full rounded-full"><ColorThumb className="top-1/2 size-4 rounded-full border-2 border-white shadow-2 data-[focus-visible]:size-5" /></SliderTrack>
            </ColorSlider>
            <AriaColorField aria-label={label}><Input className="field w-full tabular-nums" dir="ltr" /></AriaColorField>
          </Dialog>
        </Popover>
      </DialogTrigger>
    </ColorPicker>
  );
}
