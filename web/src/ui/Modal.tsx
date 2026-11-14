import type { ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { cn } from "../lib/cn";

/**
 * What every window is made of (ADR 0069): React Aria's modal (focus is trapped, Escape and a click outside close it, the page behind is inert),
 * the scrim, and the card. `Window`, the confirm and prompt dialogs, the reference and image pickers all start here.
 */
export function ModalFrame({ label, title, onClose, size = "sm", dismissable = true, role, top = "10vh", children, className }: {
  /** The accessible name when there is no visible `title`. */
  label?: string; title?: string; onClose: () => void; size?: "sm" | "md" | "lg" | "wide"; dismissable?: boolean; role?: "dialog" | "alertdialog"; top?: string; children: ReactNode; className?: string;
}) {
  const width = { sm: "w-[min(420px,94vw)]", md: "w-[min(460px,94vw)]", lg: "w-[min(520px,94vw)]", wide: "w-[min(720px,94vw)]" }[size];
  return (
    <ModalOverlay isOpen isDismissable={dismissable} isKeyboardDismissDisabled={!dismissable} onOpenChange={(o) => { if (!o && dismissable) onClose(); }}
      className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-auto bg-scrim pt-[var(--top)] backdrop-blur-[3px]" ref={(el) => { el?.style.setProperty("--top", top); }}>
      <Modal className={cn("mb-[8vh] rounded-lg bg-surface p-5 shadow-2", width, className)}>
        <Dialog role={role} aria-label={title ?? label} className="outline-none">
          {children}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/** The heading of a window. */
export function ModalTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <Heading slot="title" className={cn("m-0 text-lg font-semibold", className)}>{children}</Heading>;
}
