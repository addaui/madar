import { useT } from "../../../i18n/i18n";
import { BaseButton, Button, IconButton } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { MenuButton } from "../../../ui/Menu";
import { Segmented } from "../../../ui/Segmented";
import { inOrder, type Sticker } from "./model";
import { PACK } from "./pack";
import { StickerArt } from "./StickerArt";
import { stickerStore, useStickerState, type Preview } from "./store";

/**
 * The page's stickers as a list, top of the pile first (ADR 0071). It is the way to reach a sticker that sits behind the text, to reorder with a
 * keyboard or a screen reader, and to hide or lock one. Each row has the same menu as the sticker itself.
 */
export function StickerList() {
  const t = useT();
  const { list, selected, control, editable, preview } = useStickerState();
  if (!control || !editable) return null;
  const rows = inOrder(list).reverse();
  return (
    <section className="mb-5" aria-label={t("stickers")}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <h3 className="m-0 flex grow items-center gap-1.5 text-[13px] font-semibold text-muted"><Icon name="sticker" className="size-3.5" />{t("stickers")}</h3>
        <Button size="sm" icon="plus" onPress={control.addAtCenter}>{t("addSticker")}</Button>
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted">{t("previewWidth")}</span>
        <Segmented label={t("previewWidth")} value={preview} onChange={(v) => stickerStore.set({ preview: v as Preview })} className="min-w-0 grow justify-between"
          options={[{ value: "auto", label: t("previewAuto") }, { value: "wide", label: t("previewWide") }, { value: "medium", label: t("previewMedium") }, { value: "narrow", label: t("previewNarrow") }]} />
      </div>
      {rows.length === 0 ? <p className="m-0 text-[13px] text-muted">{t("stickersEmpty")}</p> : (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {rows.map((s) => (
            <li key={s.id} className="flex items-center gap-1 rounded-sm data-[selected]:bg-soft" data-selected={s.id === selected ? "" : undefined}>
              <BaseButton aria-pressed={s.id === selected} onPress={() => stickerStore.set({ selected: s.id })} className="flex min-w-0 grow items-center gap-2 rounded-sm px-1.5 py-1 text-start hoverable">
                <span className="grid size-7 shrink-0 place-items-center text-[20px]" aria-hidden="true"><StickerArt s={s} /></span>
                <span className="grid min-w-0 grow">
                  <span className="truncate text-[13px]" dir="auto">{s.kind === "pack" ? PACK.find((p) => p.id === s.value)?.label : t("sticker")}</span>
                  {flags(s, t).length > 0 && <span className="truncate text-xs text-muted">{flags(s, t).join(" · ")}</span>}
                </span>
              </BaseButton>
              <IconButton icon={s.hidden ? "eyeOff" : "eye"} label={s.hidden ? t("showSticker") : t("hideSticker")} size="sm" onPress={() => control.apply((l) => l.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x)))} />
              <IconButton icon={s.lock ? "lock" : "unlock"} label={s.lock ? t("unlockSticker") : t("lockSticker")} size="sm" onPress={() => control.apply((l) => l.map((x) => (x.id === s.id ? { ...x, lock: !x.lock } : x)))} />
              <MenuButton label={t("sticker")} entries={control.entries(s.id)} placement="bottom end" buttonProps={{ className: "grid size-8 place-items-center rounded-sm text-muted hoverable" }}><Icon name="more" className="size-4" /></MenuButton>
            </li>
          ))}
        </ul>
      )}
      <p className="mb-0 mt-2 text-xs text-muted">{t("stickerHint")}</p>
    </section>
  );
}

/** What is special about a sticker, in words (an icon alone was not understood). */
function flags(s: Sticker, t: ReturnType<typeof useT>): string[] {
  const out: string[] = [];
  if (s.behind) out.push(t("stickerBehind"));
  if (s.anchor === null) out.push(t("stickerFlagPinned"));
  if (s.wrap && s.wrap !== "none" && !s.behind) out.push(t("textWrap") + ": " + t(("wrap_" + s.wrap) as "wrap_none"));
  if (s.sizes) out.push(t("stickerFlagLayout"));
  return out;
}
