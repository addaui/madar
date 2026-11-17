import type { ReactElement } from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

/**
 * A hint for a control that has no visible text. It shows on hover and on keyboard focus, after a short delay for the first one (the next
 * shows at once). Wrap one focusable child. It grows from the control it describes and fades, and does neither for someone who asked for less motion.
 */
export function Tooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger delay={500} closeDelay={80} render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner sideOffset={6} className="z-[90]">
          <TooltipPrimitive.Popup role="tooltip" className="max-w-64 origin-(--transform-origin) rounded-sm bg-text px-2 py-1 text-[12.5px] text-bg shadow-2 transition-[opacity,scale] duration-[125ms] ease-out data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[instant]:duration-0 motion-reduce:transition-none">{label}</TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
