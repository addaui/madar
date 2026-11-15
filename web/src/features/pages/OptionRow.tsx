import type { ReactNode } from "react";
import { IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";

/** One option of a panel: its icon and label, its control, and (when the person changed it) the arrow that puts it back. Shared by the Page tab and the Element tab. */
export function Opt({ icon, label, set, onRevert, writer, revert, stacked, children }: { icon: string; label: string; set: boolean; onRevert: () => void; writer: boolean; revert: string; /** A wide control (a few choices side by side): the label goes above it. */ stacked?: boolean; children: ReactNode }) {
  if (stacked) {
    return (
      <div className="grid gap-1.5 rounded-sm bg-sunken py-2 ps-[11px] pe-1">
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="size-[15px] shrink-0" /><span className="min-w-0 grow truncate">{label}</span><span className="grid size-6 place-items-center">{writer && set && <IconButton icon="undo" label={revert} size="sm" className="size-6" onPress={onRevert} />}</span></div>
        <div className="flex flex-wrap items-center gap-2 pe-2">{children}</div>
      </div>
    );
  }
  return (
    <div className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_auto_26px] items-center gap-2 rounded-sm bg-sunken ps-[11px] pe-1">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="size-[15px] shrink-0" /><span className="truncate">{label}</span></div>
      <div className="flex items-center justify-end gap-2">{children}</div>
      <span className="grid place-items-center">{writer && set && <IconButton icon="undo" label={revert} size="sm" className="size-6" onPress={onRevert} />}</span>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mb-4"><h3 className="m-0 mb-1.5 text-[13px] font-semibold text-muted">{title}</h3><div className="grid gap-1.5">{children}</div></section>;
}
