import { useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { cn } from "../lib/cn";

/**
 * What every window is made of (ADR 0086): Base UI's dialog (focus is trapped, Escape and a click outside close it, the page behind is inert),
 * the scrim, and the card. `Window`, the confirm and prompt dialogs, the reference and image pickers all start here.
 */
export function ModalFrame({ label, title, onClose, size = "sm", dismissable = true, role, top = "10vh", children, className }: {
  /** The accessible name when there is no visible `title`. */
  label?: string; title?: string; onClose: () => void; size?: "sm" | "md" | "lg" | "wide" | "page"; dismissable?: boolean; role?: "dialog" | "alertdialog"; top?: string; children: ReactNode; className?: string;
}) {
  // what had focus when the window opened gets it back when it closes (a window opened from code has no trigger to return to)
  const [back] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  const width = { sm: "w-[min(420px,94vw)]", md: "w-[min(460px,94vw)]", lg: "w-[min(520px,94vw)]", wide: "w-[min(720px,94vw)]", page: "w-[min(1400px,96vw)]" }[size];
  return (
    <Dialog.Root open modal disablePointerDismissal={!dismissable}
      onOpenChange={(o, d) => { if (o) return; if (!dismissable) { d.cancel(); return; } onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[60] bg-scrim backdrop-blur-[3px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
        <div className="fixed inset-0 z-[60] overflow-auto" ref={(el) => { el?.style.setProperty("--top", top); }}>
          <Dialog.Popup role={role ?? "dialog"} aria-label={title ?? label}
            finalFocus={() => (back && back !== document.body && back.isConnected ? back : true)}
            className={cn("mx-auto mb-[8vh] mt-(--top) rounded-lg bg-surface p-5 shadow-2 outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none", width, className)}>
            {children}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The heading of a window. */
export function ModalTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <Dialog.Title className={cn("m-0 text-lg font-semibold", className)}>{children}</Dialog.Title>;
}
