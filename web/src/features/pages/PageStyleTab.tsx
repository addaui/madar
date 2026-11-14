import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { link } from "../../api/link";
import { useDescribe } from "../../api/session";
import type { Page } from "../../api/types";
import { useI18n, type Key } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { BaseButton, Button, IconButton } from "../../ui/Button";
import { Checkbox } from "../../ui/Check";
import { ColorField } from "../../ui/ColorField";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { Slider } from "../../ui/Slider";
import { Window } from "../dialogs/Dialog";
import { Icon } from "../../ui/Icon";
import { askConfirm, askImage, askText, toast } from "../../ui/overlays";
import { saverFor } from "./pageSaver";
import { keyOf, type PageScope } from "./scope";
import { autumnImage } from "./style/art";
import { effectiveSettings, appScheme, PAGE_PRESETS, readableOn, type PageSettings, type PagePreset } from "./style/settings";
import { leavesTile } from "./style/art";

type Saved = { id: string; name: string; settings: PageSettings };
const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

/** The Page tab: a look for the page (light, dark or following the app), then every option, each with its icon and a revert arrow. */
export function PageStyleTab({ page, scope, writer }: { page: Page; scope: PageScope; writer: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const hasStyles = !!useDescribe().operations["pages.style_save"];
  const st = (page.settings ?? {}) as PageSettings;
  const eff = effectiveSettings(st);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [more, setMore] = useState(false);

  /** Changes the settings now (the page repaints from the cache) and saves them: at once, or a moment after a slider stops. */
  const commit = (next: PageSettings, now = true) => {
    qc.setQueryData(keyOf(scope, "get", { id: page.id }), { ...page, settings: next });
    clearTimeout(timer.current);
    const send = () => void saverFor(qc, page, scope).save({ settings: next });
    if (now) send(); else timer.current = setTimeout(send, 500);
  };
  const put = (k: keyof PageSettings, v: unknown, now = true) => { const n = { ...st } as Record<string, unknown>; if (v === undefined || v === "") delete n[k]; else n[k] = v; commit(n as PageSettings, now); };
  const putMany = (c: Record<string, unknown>) => { const n = { ...st } as Record<string, unknown>; for (const [k, v] of Object.entries(c)) { if (v === undefined || v === "") delete n[k]; else n[k] = v; } commit(n as PageSettings); };

  const mode = st.preset_mode ?? "auto", shown = mode === "auto" ? appScheme() : mode;
  const own = Object.keys(st).filter((k) => k !== "preset" && k !== "preset_mode").length > 0;
  const applyBuiltin = (p: PagePreset, m: typeof mode) => commit({ ...(p.id !== "default" ? { preset: p.id } : {}), ...(m !== "auto" ? { preset_mode: m } : {}) });
  const saveAs = async () => {
    const name = await askText(t("styleName")); if (!name) return;
    await link.call("pages.style_save", { name, settings: eff } as never);
    await qc.invalidateQueries({ queryKey: ["pages.styles"] });
    toast(t("styleSaved"));
  };

  const has = (k: keyof PageSettings) => st[k] !== undefined && st[k] !== false;
  const select = (k: keyof PageSettings, opts: [string, Key][], label: string) => (
    <Select plain label={label} isDisabled={!writer} value={String(eff[k] ?? "")} onChange={(v) => put(k, v || undefined)} className="max-w-[140px]" options={opts.map(([v, l]) => ({ value: v, label: t(l) }))} />
  );
  const slider = (k: keyof PageSettings, lo: number, hi: number, step: number, dflt: number, unit: string) => (
    <Slider label={t((k + "Lbl") as Key)} className="w-[96px]" minValue={lo} maxValue={hi} step={step} value={(eff[k] as number | undefined) ?? dflt} isDisabled={!writer}
      onChange={(x) => put(k, x, false)} onChangeEnd={(x) => put(k, x)} format={(x) => x + unit} />
  );
  const colour = (k: keyof PageSettings, fallback: string) => (
    <ColorField label={t((k + "Lbl") as Key)} isDisabled={!writer} value={(eff[k] as string | undefined) ?? fallback} onChange={(hex) => put(k, hex)} />
  );
  const srcNow = eff.sheet_image ? "image" : eff.sheet_art ? "autumn" : "none";
  const art = !!(eff.sheet_image || eff.sheet_art);
  const pickImage = async (key: "bg_image" | "sheet_image") => { const u = await askImage(t(key === "bg_image" ? "secImage" : "sheetPicture")); if (u) put(key, u); };

  return (
    <div>
      <Section title={t("secPresets") + (own ? " · " + t("presetCustom") : "")}>
        <Segmented label={t("presetMode")} value={mode} isDisabled={!writer} onChange={(m) => put("preset_mode", m === "auto" ? undefined : m)} className="w-full" itemClassName="flex-1 text-center"
          options={(["auto", "light", "dark"] as const).map((m) => ({ value: m, label: t(("mode_" + m) as Key), hint: m === "auto" ? t("modeAutoHint") : undefined }))} />
        <div className="grid grid-cols-3 gap-2">
          {PAGE_PRESETS.map((p) => <PresetTile key={p.id} label={t(("pre_" + p.id) as Key)} settings={p[shown]} on={(st.preset ?? "default") === p.id && !own} disabled={!writer} onClick={() => applyBuiltin(p, mode)} />)}
          <BaseButton onPress={() => setMore(true)} aria-label={t("moreStyles")} className="grid gap-1 rounded-sm border border-line p-1.5 text-center text-xs hoverable"><span className="grid h-[34px] place-items-center rounded-md bg-sunken text-xl tracking-[2px] text-muted">···</span>{t("moreStyles")}</BaseButton>
        </div>
        {own && writer && hasStyles && <div><Button kind="ghost" size="sm" icon="plus" onPress={() => void saveAs()}>{t("saveStyle")}</Button></div>}
      </Section>

      <Section title={t("secText")}>
        <Opt icon="type" label={t("fontLbl")} set={has("font")} onRevert={() => put("font", undefined)} writer={writer} revert={t("revert")}>{select("font", [["", "fDefault"], ["serif", "fSerif"], ["mono", "fMono"]], t("fontLbl"))}</Opt>
        <Opt icon="textSize" label={t("sizeLbl")} set={has("size")} onRevert={() => put("size", undefined)} writer={writer} revert={t("revert")}>{slider("size", 12, 24, 1, 16, "")}</Opt>
        <Opt icon="lineHeight" label={t("line_heightLbl")} set={has("line_height")} onRevert={() => put("line_height", undefined)} writer={writer} revert={t("revert")}>{slider("line_height", 100, 260, 5, 170, "%")}</Opt>
        <Opt icon="palette" label={t("text_colorLbl")} set={has("text_color")} onRevert={() => put("text_color", undefined)} writer={writer} revert={t("revert")}>{colour("text_color", "#222222")}</Opt>
      </Section>
      <Section title={t("secLayout")}>
        <Opt icon="width" label={t("widthLbl")} set={has("width")} onRevert={() => put("width", undefined)} writer={writer} revert={t("revert")}>{select("width", [["", "wNormal"], ["narrow", "wNarrow"], ["wide", "wWide"]], t("widthLbl"))}</Opt>
        <Opt icon="spacing" label={t("block_gapLbl")} set={has("block_gap")} onRevert={() => put("block_gap", undefined)} writer={writer} revert={t("revert")}>{slider("block_gap", 0, 250, 5, 85, "%")}</Opt>
      </Section>
      <Section title={t("secColours")}>
        <Opt icon="fill" label={t("page_colorLbl")} set={has("page_color")} onRevert={() => put("page_color", undefined)} writer={writer} revert={t("revert")}>{colour("page_color", "#ffffff")}</Opt>
        {eff.page_color && <Opt icon="opacity" label={t("page_opacityLbl")} set={has("page_opacity")} onRevert={() => put("page_opacity", undefined)} writer={writer} revert={t("revert")}>{slider("page_opacity", 0, 100, 5, 100, "%")}</Opt>}
        <Opt icon="backdrop" label={t("bg_colorLbl")} set={has("bg_color")} onRevert={() => put("bg_color", undefined)} writer={writer} revert={t("revert")}>{colour("bg_color", "#ffffff")}</Opt>
        <Opt icon="shadow" label={t("band_shadowLbl")} set={has("band_shadow")} onRevert={() => put("band_shadow", undefined)} writer={writer} revert={t("revert")}><Checkbox isDisabled={!writer} isSelected={!!eff.band_shadow} aria-label={t("band_shadowLbl")} onChange={(x) => put("band_shadow", x ? true : undefined)} /></Opt>
      </Section>
      <Section title={t("secPaper")}>
        <Opt icon="grid" label={t("patternLbl")} set={has("pattern")} onRevert={() => put("pattern", undefined)} writer={writer} revert={t("revert")}>{select("pattern", [["", "patNone"], ["ruled", "patRuled"], ["grid", "patGrid"], ["dots", "patDots"]], t("patternLbl"))}</Opt>
        {eff.pattern && eff.pattern !== "none" && <Opt icon="palette" label={t("pattern_colorLbl")} set={has("pattern_color")} onRevert={() => put("pattern_color", undefined)} writer={writer} revert={t("revert")}>{colour("pattern_color", "#bbbbbb")}</Opt>}
        <Opt icon="marginLine" label={t("margin_lineLbl")} set={has("margin_line")} onRevert={() => put("margin_line", undefined)} writer={writer} revert={t("revert")}>{colour("margin_line", "#d9534f")}</Opt>
        <Opt icon="rule" label={t("block_ruleLbl")} set={has("block_rule")} onRevert={() => put("block_rule", undefined)} writer={writer} revert={t("revert")}>{select("block_rule", [["", "ruleNone"], ["line", "ruleLine"], ["dashed", "ruleDashed"], ["dotted", "ruleDotted"]], t("block_ruleLbl"))}</Opt>
      </Section>
      <Section title={t("secSheetArt")}>
        <Opt icon="image" label={t("sheet_srcLbl")} set={has(eff.sheet_image ? "sheet_image" : "sheet_art")} onRevert={() => put(eff.sheet_image ? "sheet_image" : "sheet_art", undefined)} writer={writer} revert={t("revert")}>
          <Select plain label={t("sheet_srcLbl")} isDisabled={!writer} value={srcNow} className="max-w-[140px]" options={([["none", "srcNone"], ["autumn", "srcAutumn"], ["image", "srcImage"]] as [string, Key][]).map(([v, l]) => ({ value: v, label: t(l) }))}
            onChange={async (v) => { if (v === "none") putMany({ sheet_art: undefined, sheet_image: undefined }); else if (v === "autumn") putMany({ sheet_art: "autumn", sheet_image: undefined }); else { const u = await askImage(t("sheetPicture")); if (u) putMany({ sheet_art: undefined, sheet_image: u }); } }} />
        </Opt>
        {eff.sheet_image && <Opt icon="upload" label={t("sheetPicture")} set={has("sheet_image")} onRevert={() => put("sheet_image", undefined)} writer={writer} revert={t("revert")}>{writer && <Button kind="ghost" size="sm" onPress={() => void pickImage("sheet_image")}>{t("changeImage")}</Button>}</Opt>}
        {art && <Opt icon="fit" label={t("sheet_cornerLbl")} set={has("sheet_corner")} onRevert={() => put("sheet_corner", undefined)} writer={writer} revert={t("revert")}>{select("sheet_corner", [["top-right", "cTR"], ["top-left", "cTL"], ["bottom-right", "cBR"], ["bottom-left", "cBL"]], t("sheet_cornerLbl"))}</Opt>}
        {art && <Opt icon="scale" label={t("sheet_sizeLbl")} set={has("sheet_size")} onRevert={() => put("sheet_size", undefined)} writer={writer} revert={t("revert")}>{slider("sheet_size", 60, 500, 10, 260, "px")}</Opt>}
        {art && <Opt icon="copy" label={t("sheet_mirrorLbl")} set={has("sheet_mirror")} onRevert={() => put("sheet_mirror", undefined)} writer={writer} revert={t("revert")}><Checkbox isDisabled={!writer} isSelected={!!eff.sheet_mirror} aria-label={t("sheet_mirrorLbl")} onChange={(x) => put("sheet_mirror", x ? true : undefined)} /></Opt>}
      </Section>
      <Section title={t("secImage")}>
        <div className="flex items-center gap-2.5">
          <div className="grid size-[72px] place-items-center rounded-md border border-line bg-sunken text-xs text-muted" ref={(el) => { if (el) { el.style.backgroundImage = eff.bg_image ? `url("${eff.bg_image}")` : ""; el.style.backgroundSize = "cover"; } }}>{!eff.bg_image && t("noImage")}</div>
          {writer && <Button icon="image" onPress={() => void pickImage("bg_image")}>{eff.bg_image ? t("changeImage") : t("chooseImage")}</Button>}
          {writer && eff.bg_image && <Button kind="ghost" icon="trash" onPress={() => put("bg_image", undefined)}>{t("removeImage")}</Button>}
        </div>
        {eff.bg_image && (
          <>
            <Opt icon="fit" label={t("bg_fitLbl")} set={has("bg_fit")} onRevert={() => put("bg_fit", undefined)} writer={writer} revert={t("revert")}>{select("bg_fit", [["cover", "fitCover"], ["contain", "fitContain"], ["scale", "fitScale"], ["tile", "fitTile"]], t("bg_fitLbl"))}</Opt>
            {eff.bg_fit === "scale" && <Opt icon="scale" label={t("bg_scaleLbl")} set={has("bg_scale")} onRevert={() => put("bg_scale", undefined)} writer={writer} revert={t("revert")}>{slider("bg_scale", 10, 300, 5, 100, "%")}</Opt>}
            {eff.bg_fit === "tile" && <Opt icon="grid" label={t("bg_tileLbl")} set={has("bg_tile")} onRevert={() => put("bg_tile", undefined)} writer={writer} revert={t("revert")}>{slider("bg_tile", 40, 800, 10, 200, "px")}</Opt>}
            <Opt icon="pin" label={t("bg_attachLbl")} set={has("bg_attach")} onRevert={() => put("bg_attach", undefined)} writer={writer} revert={t("revert")}>{select("bg_attach", [["fixed", "attachFixed"], ["scroll", "attachScroll"]], t("bg_attachLbl"))}</Opt>
            <Opt icon="moon" label={t("bg_dimLbl")} set={has("bg_dim")} onRevert={() => put("bg_dim", undefined)} writer={writer} revert={t("revert")}>{slider("bg_dim", 0, 80, 5, 0, "%")}</Opt>
          </>
        )}
      </Section>
      {more && <MoreStyles shown={shown} onClose={() => setMore(false)} writer={writer} hasStyles={hasStyles} onBuiltin={(p) => { applyBuiltin(p, mode); setMore(false); }} onSaved={(s) => { commit({ ...s }); setMore(false); }} onSave={saveAs} />}
    </div>
  );
}

function PresetTile({ label, settings, on, disabled, onClick }: { label: string; settings: PageSettings; on: boolean; disabled?: boolean; onClick: () => void }) {
  const s = settings;
  return (
    <BaseButton isDisabled={disabled} aria-pressed={on} onPress={onClick} className={cn("grid gap-1 rounded-sm border border-line p-1.5 text-center text-xs hoverable", on && "border-accent shadow-[0_0_0_1px_var(--accent)]")}>
      <div className="grid h-[42px] place-items-center rounded-md border border-line" ref={(el) => {
        if (!el) return;
        el.style.backgroundColor = s.bg_color ?? "var(--sunken)";
        el.style.backgroundImage = s.bg_art === "leaves" ? leavesTile(s.bg_art_color ?? "#b5d4a2") : "";
        el.style.backgroundSize = "54px 54px";
      }}>
        <div className="grid h-[28px] w-[70%] place-items-center rounded-sm text-[13px] font-bold" ref={(el) => {
          if (!el) return;
          el.style.background = s.page_color ?? "var(--surface)"; el.style.color = s.text_color ?? (s.page_color ? readableOn(s.page_color) : "var(--text)");
          el.style.fontFamily = s.font === "mono" ? "var(--mono)" : s.font === "serif" ? "Fraunces, Georgia, serif" : "";
          const line = s.pattern_color ?? "#999";
          el.style.backgroundImage = s.sheet_art === "autumn" ? autumnImage(0.95, "top-right") : s.pattern === "ruled" ? `linear-gradient(transparent 80%, ${line} 0)` : s.pattern === "grid" ? `linear-gradient(transparent 80%, ${line} 0), linear-gradient(90deg, transparent 80%, ${line} 0)` : "";
          el.style.backgroundSize = s.sheet_art === "autumn" ? "46px 46px" : s.pattern ? "100% 6px" : "";
          el.style.backgroundRepeat = "no-repeat"; el.style.backgroundPosition = "top right";
        }}>Aa</div>
      </div>
      <span>{label}</span>
    </BaseButton>
  );
}

/** Every look: the built-in ones and the ones the person saved (kept with their data, with their pictures). */
function MoreStyles({ shown, onClose, writer, hasStyles, onBuiltin, onSaved, onSave }: { shown: "light" | "dark"; onClose: () => void; writer: boolean; hasStyles: boolean; onBuiltin: (p: PagePreset) => void; onSaved: (s: PageSettings) => void; onSave: () => Promise<void> }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [styles, setStyles] = useState<Saved[] | null>(null);
  const load = async () => { setStyles(hasStyles ? ((await link.call("pages.styles", {} as never)) as { styles: Saved[] }).styles : []); };
  if (styles === null) void load();
  const remove = async (s: Saved) => { if (!(await askConfirm(t("sure")))) return; await link.call("pages.style_delete", { id: s.id } as never); await qc.invalidateQueries({ queryKey: ["pages.styles"] }); await load(); };
  return (
    <Window title={t("pageStyles")} onClose={onClose} wide>
        <h3 className="mb-2 text-[13px] font-semibold text-muted">{t("builtInStyles")}</h3>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">{PAGE_PRESETS.map((p) => <PresetTile key={p.id} label={t(("pre_" + p.id) as Key)} settings={p[shown]} on={false} disabled={!writer} onClick={() => onBuiltin(p)} />)}</div>
        <h3 className="mb-2 mt-4 text-[13px] font-semibold text-muted">{t("myStyles")}</h3>
        {styles && styles.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">{styles.map((s) => (
            <div key={s.id} className="group/tile relative"><PresetTile label={s.name} settings={s.settings} on={same(s.settings, {})} disabled={!writer} onClick={() => onSaved(s.settings)} />
              {writer && <IconButton icon="close" label={t("delete")} size="sm" className="absolute end-1.5 top-1.5 size-[22px] bg-surface opacity-0 group-hover/tile:opacity-100 focus:opacity-100" onPress={() => void remove(s)} />}</div>
          ))}</div>
        ) : <p className="m-0 text-muted">{t("noStyles")}</p>}
        {writer && hasStyles && <div className="mt-4 flex justify-end"><Button icon="plus" onPress={async () => { await onSave(); await load(); }}>{t("saveStyle")}</Button></div>}
    </Window>
  );
}

function Opt({ icon, label, set, onRevert, writer, revert, children }: { icon: string; label: string; set: boolean; onRevert: () => void; writer: boolean; revert: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_auto_26px] items-center gap-2 rounded-sm bg-sunken ps-[11px] pe-1">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted"><Icon name={icon} className="size-[15px] shrink-0" /><span className="truncate">{label}</span></div>
      <div className="flex items-center justify-end gap-2">{children}</div>
      <span className="grid place-items-center">{writer && set && <IconButton icon="undo" label={revert} size="sm" className="size-6" onPress={onRevert} />}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mb-4"><h3 className="m-0 mb-1.5 text-[13px] font-semibold text-muted">{title}</h3><div className="grid gap-1.5">{children}</div></section>;
}
