import { useRead } from "../../../api/hooks";
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
import { optionsOf, resetValueOf, resolveOption, type BlockDecl, type OptionDecl, type PageDefaults } from "./options";
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
  const blocks = (useRead("editor.blocks").data as { blocks: BlockDecl[] }).blocks;
  const { ctx, api, pick } = useElementState();
  const { selected, list, control } = useStickerState();
  const sticker = selected ? list.find((s) => s.id === selected) : undefined;
  if (sticker && control) return <StickerOptionsPanel sticker={sticker} writer={writer} />;
  if (!ctx || !api) return <p className="m-0 text-[13px] text-muted-foreground">{t("elementNone")}</p>;
  const at = Math.min(pick, ctx.chain.length - 1), el = ctx.chain[at]!;
  const opts = optionsOf(blocks, el.node);
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
                <BaseButton onPress={() => elementStore.set({ pick: idx })} aria-current={idx === at ? "true" : undefined} className={cn("rounded-sm px-1.5 py-0.5 hoverable", idx === at ? "bg-soft font-semibold text-text" : "text-muted-foreground")}>{t(("node_" + c.node) as Key)}</BaseButton>
              </span>
            );
          })}
        </nav>
      )}
      <Heading kind={el.node} />
      {opts.length === 0 ? <p className="m-0 text-[13px] text-muted-foreground">{t("elementNoOptions")}</p> : (
        <Section title={t("elementThis", { type: t(("node_" + el.node) as Key) })}>
          {opts.map((o) => {
            const r = resolveOption(o, el.node, el.attrs, defaults);
            return (
              <Opt key={o.id} icon={ICONS[el.node] ?? "type"} label={optionLabel(o, lang)} stacked={isWide(o)} set={r.source === "element"} writer={writer} revert={t("revertOption")}
                onRevert={() => api.setAttrs(el.pos, { [o.attr ?? o.id]: resetValueOf(o) })}>
                <Source source={r.source} />
                <OptionControl opt={o} value={r.value} disabled={!writer} onChange={(v) => api.setAttrs(el.pos, { [o.attr ?? o.id]: v })} />
              </Opt>
            );
          })}
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

function Heading({ kind }: { kind: string }) {
  const { t } = useI18n();
  return <h3 className="m-0 mb-2 flex items-center gap-1.5 text-[13px] font-semibold"><Icon name={ICONS[kind] ?? "type"} className="size-3.5 text-muted-foreground" />{t(("node_" + kind) as Key)}</h3>;
}

function Source({ source }: { source: "element" | "page" | "default" }) {
  const { t } = useI18n();
  return source === "page" ? <span className="text-xs text-muted-foreground">{t("fromPage")}</span> : null;
}

/** A control that needs the whole row: a few choices side by side, or a label too long for the narrow column. */
const isWide = (o: OptionDecl) => (o.type === "choice" && (o.choices?.length ?? 0) > 2 && (o.choices?.length ?? 0) <= 4 && (o.choices ?? []).every((c) => c.label.en.length <= 9)) || o.label.en.length > 16;
const optionLabel = (o: OptionDecl, lang: string): string => (lang === "ar" && o.label.ar) || o.label.en;
