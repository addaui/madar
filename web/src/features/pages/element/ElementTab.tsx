import { useState } from "react";
import { PointPopover } from "../../../ui/PointPopover";
import { useKinds } from "./kinds";
import type { Page } from "../../../api/types";
import { useI18n, type Key } from "../../../i18n/i18n";
import { cn } from "../../../lib/cn";
import { BaseButton, Button } from "../../../ui/Button";
import { Icon } from "../../../ui/Icon";
import { Opt, Section } from "../OptionRow";
import type { PageScope } from "../scope";
import type { PageSettings } from "../style/settings";
import { stickerStore, useStickerState } from "../stickers/store";
import { OptionControl } from "./OptionControl";
import { blocksOf, optionsOf, resetValueOf, resolveOption, type OptionDecl, type PageDefaults } from "./options";
import { elementStore, useElementState } from "./store";
import { shownIn, STICKER_OPTIONS } from "./stickerOptions";

/** The icon of each kind of element, for its options' heading. */
const ICONS: Record<string, string> = { paragraph: "type", heading: "heading-1", blockquote: "quote", codeBlock: "code", bulletList: "list-bullet", orderedList: "list-ordered", taskList: "list-check", callout: "callout", toggle: "toggle", image: "image", youtube: "video", linkPreview: "bookmark", horizontalRule: "divider", taskBlock: "task", sticker: "sticker" };

/**
 * The Element tab (ADR 0073): the options of whatever is selected or has the cursor in it. A block's options come from what its plugin declared; a sticker's from
 * the Face. Each shows the value in force, and where the person changed it, the arrow that puts it back to what the page or the default says.
 */
export function ElementTab({ page, writer }: { page: Page; scope?: PageScope; writer: boolean }) {
  const { t, lang } = useI18n();
  const kinds = useKinds();
  const blocks = blocksOf(kinds);
  const [open, setOpen] = useState<{ id: string; x: number; y: number } | null>(null);
  const { ctx, api, pick } = useElementState();
  const { selected, list, control } = useStickerState();
  const sticker = selected ? list.find((s) => s.id === selected) : undefined;
  if (sticker && control) return <StickerOptionsPanel sticker={sticker} writer={writer} />;
  if (!ctx || !api) return <p className="m-0 text-[13px] text-muted-foreground">{t("elementNone")}</p>;
  const at = Math.min(pick, ctx.chain.length - 1), el = ctx.chain[at]!;
  // an element (a card) is known by its kind; its options come with the context, its values live in its settings (ADR 0094)
  const key = el.kind ?? el.node;
  const all = el.options ?? optionsOf(blocks, key);
  const pinned = all.filter((o) => o.pinned), rest = all.filter((o) => !o.pinned);
  const values = (el.kind ? (el.attrs.data as Record<string, unknown> | undefined) ?? {} : el.attrs);
  const write = (o: OptionDecl, v: unknown) => { if (el.id && api.setOption) api.setOption(el.id, o.id, v); else api.setAttrs(el.pos, { [o.attr ?? o.id]: v }); };
  const label = (node: string, kind?: string | null) => { const k = kind ? kinds.find((x) => x.kind === kind) : undefined; return k ? (lang === "ar" && k.label.ar) || k.label.en : t(("node_" + node) as Key); };
  const settings = (page.settings ?? {}) as PageSettings & { elements?: PageDefaults };
  const defaults = settings.elements;
  return (
    <div>
      {ctx.chain.length > 1 && (
        <nav aria-label={t("elementPath")} className="mb-3 flex flex-wrap items-center gap-1 text-[13px]">
          {[...ctx.chain].reverse().map((c, i, all) => {
            const idx = all.length - 1 - i;
            return (
              <span key={c.pos + c.node} className="flex items-center gap-1">
                {i > 0 && <Icon name="chevron" className="size-3 text-muted-foreground rtl:-scale-x-100" />}
                <BaseButton onPress={() => elementStore.set({ pick: idx })} aria-current={idx === at ? "true" : undefined} className={cn("rounded-sm px-1.5 py-0.5 hoverable", idx === at ? "bg-soft font-semibold text-text" : "text-muted-foreground")}>{label(c.node, c.kind)}</BaseButton>
              </span>
            );
          })}
        </nav>
      )}
      <Heading kind={el.node} title={label(el.node, el.kind)} />
      {all.length === 0 ? <p className="m-0 text-[13px] text-muted-foreground">{t("elementNoOptions")}</p> : (
        <Section title={t("elementThis", { type: label(el.node, el.kind) })}>
          {(pinned.length ? pinned : all.slice(0, 2)).map((o) => {
            const r = resolveOption(o, key, values, defaults);
            return (
              <Opt key={o.id} icon={ICONS[el.node] ?? "type"} label={optionLabel(o, lang)} stacked={isWide(o)} set={r.source === "element"} writer={writer} revert={t("revertOption")}
                onRevert={() => write(o, resetValueOf(o))}>
                <Source source={r.source} />
                <OptionControl opt={o} value={r.value} disabled={!writer} onChange={(v) => write(o, v)} />
              </Opt>
            );
          })}
          {/* the other options stay out of the way: a row of buttons, each opening its control (ADR 0094) */}
          {(pinned.length ? rest : all.slice(2)).length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(pinned.length ? rest : all.slice(2)).map((o) => (
                <Button key={o.id} size="sm" onPress={(e) => { const r = (e.target as HTMLElement).getBoundingClientRect(); setOpen({ id: o.id, x: r.left, y: r.bottom }); }}>{optionLabel(o, lang)}</Button>
              ))}
            </div>
          )}
          {open && (() => {
            const o = all.find((x) => x.id === open.id);
            if (!o) return null;
            const r = resolveOption(o, key, values, defaults);
            return (
              <PointPopover x={open.x} y={open.y} onClose={() => setOpen(null)} dialogLabel={optionLabel(o, lang)}>
                <div className="grid min-w-56 gap-2 p-1">
                  <span className="text-[13px] font-semibold">{optionLabel(o, lang)}</span>
                  <OptionControl opt={o} value={r.value} disabled={!writer} onChange={(v) => write(o, v)} />
                </div>
              </PointPopover>
            );
          })()}
        </Section>
      )}
    </div>
  );
}

function StickerOptionsPanel({ sticker, writer }: { sticker: import("../stickers/model").Sticker; writer: boolean }) {
  const { t, lang } = useI18n();
  const { control } = useStickerState();
  if (!control) return null;
  const cls = control.sizeClass(), { eff, own } = shownIn(sticker, cls);
  const text = (l: { en: string; ar?: string }) => (lang === "ar" && l.ar) || l.en;
  return (
    <div>
      <Heading kind="sticker" />
      <Section title={t("elementThis", { type: t("node_sticker") })}>
        {STICKER_OPTIONS.filter((o) => !o.hidden?.(eff)).map((o) => (
          <Opt key={o.decl.id} icon={ICONS.sticker!} label={text(o.decl.label)} stacked={isWide(o.decl)} set={!!o.reset && !!o.changed?.(eff)} writer={writer} revert={t("revertOption")} onRevert={() => o.reset?.(control, sticker.id)}>
            <OptionControl opt={o.decl} value={o.read(eff)} disabled={!writer || !!o.disabled?.(eff)} onChange={(v) => o.write(control, sticker.id, v)} />
          </Opt>
        ))}
      </Section>
      {cls !== "wide" && (
        <Section title={t("stickerLayoutHere", { size: t(("preview" + cls[0]!.toUpperCase() + cls.slice(1)) as Key) })}>
          <p className="m-0 text-[13px] text-muted-foreground">{own ? t("stickerLayoutOwn") : t("stickerLayoutShared")}</p>
          {own && writer && <Button size="sm" icon="undo" onPress={() => control.apply((l) => l.map((x) => (x.id === sticker.id ? shownIn(x, cls).clear() : x)))}>{t("resetSize")}</Button>}
        </Section>
      )}
      <div className="mt-2"><Button size="sm" icon="close" onPress={() => stickerStore.set({ selected: null })}>{t("elementDeselect")}</Button></div>
    </div>
  );
}

function Heading({ kind, title }: { kind: string; title?: string }) {
  const { t } = useI18n();
  return <h3 className="m-0 mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Icon name={ICONS[kind] ?? "type"} className="size-3.5 text-muted-foreground" />{title ?? t(("node_" + kind) as Key)}</h3>;
}

function Source({ source }: { source: "element" | "page" | "default" }) {
  const { t } = useI18n();
  return source === "page" ? <span className="text-xs text-muted-foreground">{t("fromPage")}</span> : null;
}

/** A control that needs the whole row: a few choices side by side, or a label too long for the narrow column. */
const isWide = (o: OptionDecl) => (o.type === "choice" && (o.choices?.length ?? 0) > 2 && (o.choices?.length ?? 0) <= 4 && (o.choices ?? []).every((c) => c.label.en.length <= 9)) || o.label.en.length > 16;
const optionLabel = (o: OptionDecl, lang: string): string => (lang === "ar" && o.label.ar) || o.label.en;
