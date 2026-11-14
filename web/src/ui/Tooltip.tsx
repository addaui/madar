import type { ReactNode } from "react";
import { Tooltip as AriaTooltip, TooltipTrigger } from "react-aria-components";

/**
 * A hint for a control that has no visible text. It shows on hover and on keyboard focus, after a short delay for the first one (the next
 * shows at once, which React Aria handles). Wrap one focusable child.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={500} closeDelay={80}>
      {children}
      <AriaTooltip offset={6} className="z-[90] max-w-64 rounded-sm bg-text px-2 py-1 text-[12.5px] text-bg shadow-2">{label}</AriaTooltip>
    </TooltipTrigger>
  );
}
