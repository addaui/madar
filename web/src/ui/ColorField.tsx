import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import { cn } from "../lib/cn";
import { popup } from "./base";

type Hsv = { h: number; s: number; v: number };
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
}

const validHex = (v: string) => /^#?[0-9a-f]{6}$/i.test(v.trim());

/** A colour: a swatch that opens an area and a hue slider, with the hex code to type. The value is "#rrggbb". */
export function ColorField({ label, value, onChange, live, isDisabled, className }: { label: string; value: string; onChange: (hex: string) => void; /** Report every change while the colour is dragged (for a live preview); otherwise only when the picker closes. */ live?: boolean; isDisabled?: boolean; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const shown = draft ?? value;
  const hsv = hexToHsv(shown);
  const [hue, setHue] = useState(hsv.h);   // a grey has no hue of its own: keep the one the slider shows
  const h = hsv.s === 0 || hsv.v === 0 ? hue : hsv.h;

  const set = (next: Hsv) => { const hex = hsvToHex(next); if (live) onChange(hex); else setDraft(hex); setTyped(null); };
  const point = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    set({ h, s: clamp((e.clientX - r.left) / r.width), v: 1 - clamp((e.clientY - r.top) / r.height) });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d: Record<string, [number, number]> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = d[e.key]; if (!m) return;
    e.preventDefault();
    set({ h, s: clamp(hsv.s + m[0]), v: clamp(hsv.v + m[1]) });
  };
  const close = (open: boolean) => { if (!open && draft !== null) { if (draft !== value) onChange(draft); setDraft(null); setTyped(null); } };

  return (
    <Popover.Root onOpenChange={close}>
      <Popover.Trigger disabled={isDisabled} aria-label={label} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-brand data-[disabled]:opacity-45", className)}>
        <span className="size-7 rounded-sm border border-line-strong" ref={(el) => { el?.style.setProperty("background-color", shown); }} />
        <span className="text-[12.5px] tabular-nums text-muted-foreground" dir="ltr">{shown}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[80]">
          <Popover.Popup aria-label={label} className={cn(popup, "p-3 outline-none")}>
            <div className="grid w-48 gap-3">
              <div role="slider" tabIndex={0} dir="ltr" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.v * 100)} aria-valuetext={`${Math.round(hsv.s * 100)}% / ${Math.round(hsv.v * 100)}%`}
                onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); point(e); }} onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }} onKeyDown={key}
                className="relative h-36 w-full cursor-crosshair touch-none rounded-sm bg-[linear-gradient(to_top,#000,transparent),linear-gradient(to_right,#fff,transparent)] outline-none focus-visible:outline-2 focus-visible:outline-brand"
                ref={(el) => { el?.style.setProperty("background-color", hsvToHex({ h, s: 1, v: 1 })); }}>
                <span className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-2"
                  ref={(el) => { if (el) { el.style.left = hsv.s * 100 + "%"; el.style.top = (1 - hsv.v) * 100 + "%"; } }} />
              </div>
              <Slider.Root value={Math.round(h)} min={0} max={360} onValueChange={(v) => { const nh = Array.isArray(v) ? v[0]! : (v as number); setHue(nh); set({ h: nh, s: hsv.s, v: hsv.v }); }} className="grid" dir="ltr">
                <Slider.Control className="flex h-4 w-full touch-none items-center">
                  <Slider.Track className="relative h-4 w-full rounded-full bg-[linear-gradient(to_right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]">
                    <Slider.Thumb aria-label={label} className="size-4 rounded-full border-2 border-white shadow-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand" />
                  </Slider.Track>
                </Slider.Control>
              </Slider.Root>
              <input aria-label={label} dir="ltr" className="field w-full tabular-nums" spellCheck={false} autoComplete="off" value={typed ?? shown}
                onChange={(e) => { const v = e.target.value; setTyped(v); if (validHex(v)) { const hex = v.startsWith("#") ? v : "#" + v; if (live) onChange(hex.toLowerCase()); else setDraft(hex.toLowerCase()); } }}
                onBlur={() => setTyped(null)} />
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
