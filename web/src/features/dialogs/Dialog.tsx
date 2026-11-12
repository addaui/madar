import type { ReactNode } from "react";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { cn } from "../../lib/cn";
import { IconButton } from "../../ui/Button";
import { useT } from "../../i18n/i18n";

/** A modal window: focus is trapped, Escape and a click outside close it, and it has a title and a close button. */
export function Window({ title, onClose, wide, children, className }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) onClose(); }} className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-auto bg-scrim pt-[8vh] backdrop-blur-[3px]">
      <Modal className={cn("mb-[8vh] w-[min(460px,94vw)] rounded-lg bg-surface p-5 shadow-2", wide && "w-[min(720px,94vw)]", className)}>
        <AriaDialog aria-label={title} className="outline-none">
          <div className="mb-3 flex items-center gap-2"><Heading slot="title" className="m-0 grow text-lg font-semibold">{title}</Heading><IconButton icon="close" label={t("close")} onClick={onClose} /></div>
          {children}
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}
