import type { ReactNode } from "react";
import { useT } from "../../i18n/i18n";
import { IconButton } from "../../ui/Button";
import { ModalFrame, ModalTitle } from "../../ui/Modal";

/** A modal window with a title and a close button. The frame, focus handling and scrim are the kit's `ModalFrame`. */
export function Window({ title, onClose, wide, children, className }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode; className?: string }) {
  const t = useT();
  return (
    <ModalFrame title={title} onClose={onClose} size={wide ? "wide" : "md"} top="8vh" className={className}>
      <div className="mb-3 flex items-center gap-2"><ModalTitle className="grow">{title}</ModalTitle><IconButton icon="close" label={t("close")} onPress={onClose} /></div>
      {children}
    </ModalFrame>
  );
}
