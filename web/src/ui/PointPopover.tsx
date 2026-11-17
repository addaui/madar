import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";

/**
 * A popover that opens at a point on the screen (a context menu at the pointer, a picker at the caret). Base UI positions against any object that can say
 * where it is, so a virtual anchor stands at the point and no element (or style attribute, which the CSP forbids) is needed.
 */
export function PointPopover({ x, y, onClose, className, placement = "bottom start", dialogLabel, children }: { x: number; y: number; onClose: () => void; className?: string; placement?: "bottom start" | "bottom end" | "top start"; /** Name the panel (a small panel). Leave out when the content is a menu. */ dialogLabel?: string; children: ReactNode }) {
  const [side, align] = placement.split(" ") as ["bottom" | "top", "start" | "end"];
  const anchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  return (
    <Popover.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Popover.Portal>
        <Popover.Positioner anchor={anchor} side={side} align={align} sideOffset={2} className="z-[80]">
          <Popover.Popup aria-label={dialogLabel} className={className ? className + " outline-none" : "outline-none"}>{children}</Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
