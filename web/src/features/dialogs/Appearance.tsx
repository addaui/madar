import { useQueryClient } from "@tanstack/react-query";
import { apca, apply, resolve, type Preset } from "@nuah/theme-engine";
import { useEffect, useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { themesOf, useDescribe, useOverrides, usePrefs } from "../../api/session";
import { DEFAULT_THEME } from "../../app/appearance";
import { useI18n, type Key } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/Button";
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
  const name = prefs.theme ?? DEFAULT_THEME;
  const preset: Preset = (themes.find((x) => x.id === "@nuah/theme-" + name) ?? themes[0])!.tokens;
  const [draft, setDraft] = useState<Record<string, Value>>({ ...saved });
  const [advanced, setAdvanced] = useState(false);
  const rtl = lang === "ar";
  const T = resolve(preset, draft, prefs.scheme, rtl);
  const sc = T.sc;

  // the draft is shown live; closing without saving puts the saved look back
  useEffect(() => { apply(preset, draft, prefs.scheme, rtl); }, [preset, draft, prefs.scheme, rtl]);
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
  const save = async () => { await link.call("appearance.save", { overrides: draft } as never); await qc.invalidateQueries({ queryKey: ["appearance.get"] }); onClose(); };
  const reset = async () => { await link.call("appearance.reset", {} as never); await qc.invalidateQueries({ queryKey: ["appearance.get"] }); setDraft({}); };

  const p = T.pal;
  const rows: [string, string, string, number][] = [[t("cBody"), p.text, p.surface, 75], [t("cMuted"), p.muted, p.surface, 60], [t("cButton"), T.on(p.primary), p.primary, 60], [t("cAccent"), p.accent, p.surface, 45]];

  const control = (it: Item) => {
    const k = it.per_scheme ? sc + ":" + it.key : it.key, id = "ap-" + k.replace(/\W/g, "-"), v = val(k);
    if (it.type === "color") return <span className="inline-flex items-center gap-1.5"><input id={id} type="color" value={String(v)} onChange={(e) => set(k, e.target.value)} className="h-7 w-14" />{draft[k] !== undefined && <button type="button" aria-label={t("clear")} onClick={() => clear(k)} className="text-muted">✕</button>}</span>;
    if (it.type === "bool") return <input id={id} type="checkbox" checked={!!v} onChange={(e) => set(k, e.target.checked)} />;
    if (it.type === "choice") return <select id={id} value={String(v)} onChange={(e) => set(k, e.target.value)} className="field">{(it.choices ?? []).map((c) => <option key={c} value={c}>{t(("tok_" + c) as Key) === "tok_" + c ? c : t(("tok_" + c) as Key)}</option>)}</select>;
    const auto = it.type === "number_or_auto" && v === "auto";
    return (
      <span className="inline-flex items-center gap-2">
        {it.type === "number_or_auto" && <label className="inline-flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={auto} onChange={(e) => set(k, e.target.checked ? "auto" : Number(it.min ?? 0))} />auto</label>}
        <input id={id} type="range" min={it.min} max={it.max} step={k === "bw" ? 0.5 : 1} value={auto ? Number(it.min ?? 0) : Number(v)} disabled={auto} onChange={(e) => set(k, Number(e.target.value))} className="w-36" />
        <output dir="ltr" className="w-9 text-end text-muted">{auto ? "auto" : String(v)}</output>
      </span>
    );
  };

  return (
    <Window title={t("customize")} onClose={onClose} wide>
      <div className="mb-3 rounded-md border border-line p-2.5 text-[13px]" aria-live="polite">
        <div className="mb-1 text-muted">{t("contrast")}</div>
        {rows.map(([n, a, b, goal]) => { const lc = Math.round(apca(a, b)); return <div key={n} className="flex justify-between"><span>{n}</span><span dir="ltr" className={lc >= goal ? "text-ok" : "text-danger"}>Lc {lc} / {t("target")} {goal}</span></div>; })}
      </div>
      <label className="mb-3 flex items-center gap-2 text-[13px]"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />{t("advanced")}</label>
      <div className="max-h-[52vh] overflow-auto">
        {schema.groups.map((g) => {
          const items = schema.items.filter((i) => i.group === g.id && (advanced || i.basic));
          if (!items.length) return null;
          return (
            <section key={g.id} className="mb-3">
              <h3 className="m-0 mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{(lang === "ar" && g.label.ar) || g.label.en}</h3>
              {items.map((it) => { const k = it.per_scheme ? sc + ":" + it.key : it.key; return <div key={it.key} className={cn("flex items-center justify-between gap-3 py-1.5", draft[k] !== undefined && "font-semibold")}><label htmlFor={"ap-" + k.replace(/\W/g, "-")}>{(lang === "ar" && it.label.ar) || it.label.en}</label>{control(it)}</div>; })}
            </section>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button kind="ghost" onClick={() => void reset()}>{t("resetLook")}</Button><Button onClick={onClose}>{t("cancel")}</Button><Button kind="primary" onClick={() => void save()}>{t("save")}</Button></div>
    </Window>
  );
}
