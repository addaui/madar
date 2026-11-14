import { useState, type ReactNode } from "react";
import { Dialog, Popover } from "react-aria-components";

/**
 * A popover that opens at a point on the screen (a context menu at the pointer, a picker at the caret). React Aria positions against a real element,
 * so a zero-size fixed anchor sits at the point; its position is set through the CSSOM because the CSP forbids style attributes.
 */
export function PointPopover({ x, y, onClose, className, placement = "bottom start", dialogLabel, children }: { x: number; y: number; onClose: () => void; className?: string; placement?: "bottom start" | "bottom end" | "top start"; /** Wrap the content in a dialog with this name (a small panel). Leave out when the content is a menu. */ dialogLabel?: string; children: ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <span aria-hidden="true" ref={(el) => { if (el) { el.style.position = "fixed"; el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = "0"; el.style.height = "0"; } setAnchor(el); }} />
      {anchor && <Popover isOpen onOpenChange={(o) => { if (!o) onClose(); }} triggerRef={{ current: anchor }} placement={placement} className={className}>{dialogLabel ? <Dialog aria-label={dialogLabel} className="outline-none">{children}</Dialog> : children}</Popover>}
    </>
  );
}
