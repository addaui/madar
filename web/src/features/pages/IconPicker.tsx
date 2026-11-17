import { useState } from "react";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { PageGlyph } from "../../ui/PageGlyph";
import { PopupButton } from "../../ui/Popup";
import { EmojiGrid } from "./EmojiGrid";

/** The icon of a page: a button that opens a picker with search, groups and recents. */
export function IconPicker({ icon, onPick, disabled }: { icon: string | null; onPick: (e: string | null) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <PopupButton label={t("pickIcon")} onOpenChange={setOpen} width={340} buttonProps={{ isDisabled: disabled, className: "grid size-10 shrink-0 place-items-center rounded-sm bg-surface text-[21px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--text)_14%,transparent)] outline-none hover:shadow-2 data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand" }} trigger={<PageGlyph icon={icon} className={icon ? undefined : "size-6 text-muted-foreground"} />}>
      {(close) => (
        <div>
          {open && <EmojiGrid onPick={(e) => { onPick(e); close(); }} />}
          {icon && <div className="mt-2"><Button kind="ghost" size="sm" icon="trash" onPress={() => { onPick(null); close(); }}>{t("removeIcon")}</Button></div>}
        </div>
      )}
    </PopupButton>
  );
}
