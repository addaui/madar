import { useQueryClient } from "@tanstack/react-query";
import { apca, apply, resolve, type Preset } from "@nuah/theme-engine";
import { useEffect, useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { themesOf, useDescribe, useOverrides, usePrefs } from "../../api/session";
import { DEFAULT_THEME } from "../../app/appearance";
import { useI18n, type Key } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { Button, IconButton } from "../../ui/Button";
import { Checkbox } from "../../ui/Check";
import { ColorField } from "../../ui/ColorField";
import { TextArea } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import { Select } from "../../ui/Select";
import { Slider } from "../../ui/Slider";
import { ToggleChip } from "../../ui/Toggle";
import { toast } from "../../ui/overlays";
import { Window } from "./Dialog";

type Value = string | number | boolean;
interface Item { key: string; group: string; type: "color" | "bool" | "choice" | "number" | "number_or_auto"; label: { en: string; ar?: string }; per_scheme?: boolean; basic?: boolean; choices?: string[]; min?: number; max?: number }
interface Schema { groups: { id: string; label: { en: string; ar?: string } }[]; items: Item[] }

/** The customizer (Nuah ADR 0028): the theme's tokens, changed live and saved as the person's overrides. */
export function Appearance({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const describe = useDescribe();
  const prefs = usePrefs();
  const saved = useOverrides();
  const schema = useRead("appearance.schema").data as Schema;
  const themes = themesOf(describe);
  const [theme, setTheme] = useState<string>(prefs.theme ?? DEFAULT_THEME);
  const [scheme, setScheme] = useState<string>(prefs.scheme ?? "auto");
  const preset: Preset = (themes.find((x) => x.id === "@nuah/theme-" + theme) ?? themes[0])!.tokens;
  const [draft, setDraft] = useState<Record<string, Value>>({ ...saved });
  const [advanced, setAdvanced] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);   // the text to import (or to copy by hand), while the box is open
  const rtl = lang === "ar";
  const T = resolve(preset, draft, scheme, rtl);
  const sc = T.sc;

  // the draft is shown live; closing without saving puts the saved look back
  useEffect(() => { apply(preset, draft, scheme, rtl); }, [preset, draft, scheme, rtl]);
  useEffect(() => () => { apply(preset, saved, prefs.scheme, rtl); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const baseOf = (k: string): Value => {
    const [s, n] = k.includes(":") ? (k.split(":") as [string, string]) : [null, k];
    if (s) return (preset[s as "light" | "dark"] as unknown as Record<string, string>)[n]!;
    if (k.startsWith("sig.")) return !!preset.sig[k.slice(4)];
    if (k === "dpct") return 100;
    return preset.tokens[k] as Value;
  };
  const val = (k: string) => draft[k] ?? baseOf(k);
  const set = (k: string, v: Value) => setDraft((d) => { const n = { ...d }; if (v === baseOf(k)) delete n[k]; else n[k] = v; return n; });
  const clear = (k: string) => setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
  const save = async () => {
    await link.call("appearance.save", { overrides: draft } as never);
    const changed: Record<string, string> = {};
    if (theme !== (prefs.theme ?? DEFAULT_THEME)) changed.theme = theme;
    if (scheme !== (prefs.scheme ?? "auto")) changed.scheme = scheme;
    if (Object.keys(changed).length) qc.setQueryData(["prefs.get", {}], await link.call("prefs.set", changed as never));
    await qc.invalidateQueries({ queryKey: ["appearance.get"] });
    onClose();
  };
  const known = new Set(schema.items.map((i) => i.key));
  const exportLook = async () => {
    const text = JSON.stringify({ theme, scheme, overrides: draft }, null, 2);
    try { await navigator.clipboard.writeText(text); toast(t("lookCopied")); } catch { setImporting(text); }
  };
  const applyImport = () => {
    try {
      const j = JSON.parse(importing ?? "") as { theme?: string; scheme?: string; overrides?: Record<string, Value> };
      if (!j || typeof j !== "object" || typeof j.overrides !== "object" || j.overrides === null) throw new Error("not a look");
      if (j.theme && themes.some((x) => x.id === "@nuah/theme-" + j.theme)) setTheme(j.theme);
      if (j.scheme && ["auto", "light", "dark"].includes(j.scheme)) setScheme(j.scheme);
      setDraft(Object.fromEntries(Object.entries(j.overrides).filter(([k]) => known.has(k.replace(/^(light|dark):/, "")))));
      setImporting(null);
    } catch { toast(t("lookBad")); }
  };

  const p = T.pal;
  const rows: [string, string, string, number][] = [[t("cBody"), p.text, p.surface, 75], [t("cMuted"), p.muted, p.surface, 60], [t("cButton"), T.on(p.primary), p.primary, 60], [t("cAccent"), p.accent, p.surface, 45]];

  const control = (it: Item) => {
    const k = it.per_scheme ? sc + ":" + it.key : it.key, v = val(k);
    const name = (lang === "ar" && it.label.ar) || it.label.en;
    if (it.type === "color") return <span className="inline-flex items-center gap-1.5"><ColorField live label={name} value={String(v)} onChange={(x) => set(k, x)} />{draft[k] !== undefined && <IconButton icon="close" size="sm" label={t("clear")} onPress={() => clear(k)} />}</span>;
    if (it.type === "bool") return <Checkbox aria-label={name} isSelected={!!v} onChange={(x) => set(k, x)} />;
    if (it.type === "choice") return <Select label={name} value={String(v)} onChange={(x) => set(k, x)} options={(it.choices ?? []).map((c) => ({ value: c, label: t(("tok_" + c) as Key) === "tok_" + c ? c : t(("tok_" + c) as Key) }))} />;
    const auto = it.type === "number_or_auto" && v === "auto";
    return (
      <span className="inline-flex items-center gap-2">
        {it.type === "number_or_auto" && <Checkbox className="text-xs text-muted-foreground" isSelected={auto} onChange={(x) => set(k, x ? "auto" : Number(it.min ?? 0))}>auto</Checkbox>}
        <Slider label={name} className="w-36" minValue={Number(it.min ?? 0)} maxValue={Number(it.max ?? 100)} step={k === "bw" ? 0.5 : 1} value={auto ? Number(it.min ?? 0) : Number(v)} isDisabled={auto} onChange={(x) => set(k, x)}
          format={(x) => (auto ? t("auto") : (k === "rbtn" || k === "rchip") && x >= 40 ? t("pill") : String(x))} />
      </span>
    );
  };

  return (
    <Window title={t("customize")} onClose={onClose} wide>
      <div className="mb-3 rounded-md border border-line p-2.5 text-[13px]" aria-live="polite">
        <div className="mb-1 text-muted-foreground">{t("contrast")}</div>
        {rows.map(([n, a, b, goal]) => { const lc = Math.round(apca(a, b)); return <div key={n} className="flex justify-between"><span>{n}</span><span dir="ltr" className={lc >= goal ? "text-ok" : "text-danger"}>Lc {lc} / {t("target")} {goal}</span></div>; })}
      </div>
      <div className="mb-3 grid gap-1.5"><b className="text-[13px]">{t("preset")}</b>
        <div className="flex flex-wrap gap-1.5">{themes.map((th) => { const val = th.id.replace(/^@nuah\/theme-/, ""); return <span key={th.id}><ToggleChip isSelected={theme === val} onChange={() => { setTheme(val); setDraft({}); }}>{th.name ?? val}</ToggleChip></span>; })}</div></div>
      <div className="mb-3 grid gap-1.5"><b className="text-[13px]">{t("mode")}</b>
        <Segmented label={t("mode")} value={scheme} onChange={setScheme} options={[{ value: "auto", label: t("modeAuto") }, { value: "light", label: t("modeLight") }, { value: "dark", label: t("modeDark") }]} className="justify-self-start" /></div>
      <Checkbox className="mb-3 text-[13px]" isSelected={advanced} onChange={setAdvanced}>{t("advanced")}</Checkbox>
      <div className="max-h-[52vh] overflow-auto">
        {schema.groups.map((g) => {
          const items = schema.items.filter((i) => i.group === g.id && (advanced || i.basic));
          if (!items.length) return null;
          return (
            <section key={g.id} className="mb-3">
              <h3 className="m-0 mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{(lang === "ar" && g.label.ar) || g.label.en}</h3>
              {items.map((it) => { const k = it.per_scheme ? sc + ":" + it.key : it.key; return <div key={it.key} className={cn("flex items-center justify-between gap-3 py-1.5", draft[k] !== undefined && "font-semibold")}><span>{(lang === "ar" && it.label.ar) || it.label.en}</span>{control(it)}</div>; })}
            </section>
          );
        })}
      </div>
      {importing !== null && (
        <div className="mt-3 grid gap-2">
          <TextArea rows={6} dir="ltr" value={importing} onChange={setImporting} placeholder={t("importPh")} label={t("importLook")} />
          <div><Button size="sm" onPress={applyImport}>{t("applyImport")}</Button></div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button kind="ghost" onPress={() => { setDraft({}); }}>{t("resetLook")}</Button><Button kind="ghost" onPress={() => void exportLook()}>{t("exportLook")}</Button><Button kind="ghost" onPress={() => setImporting(importing === null ? "" : null)}>{t("importLook")}</Button><span className="grow" /><Button onPress={onClose}>{t("cancel")}</Button><Button kind="primary" onPress={() => void save()}>{t("saveLook")}</Button></div>
    </Window>
  );
}
