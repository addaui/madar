import { useQueryClient } from "@tanstack/react-query";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { themesOf, useDescribe, usePrefs } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { Window } from "./Dialog";

interface Item { key: string; group?: string; type: string; label: { en: string; ar?: string }; default?: unknown; choices?: { value: string; label: { en: string; ar?: string } }[]; min?: number; max?: number }

/** Preferences, built from the schema the plugins declare. Each change is saved at once. */
export function Settings({ onClose, onAppearance }: { onClose: () => void; onAppearance: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const prefs = usePrefs() as Record<string, unknown>;
  const describe = useDescribe();
  const items = (useRead("prefs.schema").data as { items: Item[] }).items;
  const themes = themesOf(describe);
  const save = async (key: string, value: unknown) => {
    const out = await link.call("prefs.set", { [key]: value } as never);
    qc.setQueryData(["prefs.get", {}], out);
  };
  const groups = [...new Set(items.map((i) => i.group ?? "other"))];
  const label = (it: Item) => (lang === "ar" && it.label.ar) || it.label.en;
  return (
    <Window title={t("settings")} onClose={onClose} wide>
      {groups.map((g) => (
        <section key={g} className="mb-4 rounded-md border border-line p-3">
          <h2 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">{t(("g_" + g) as "g_other")}</h2>
          {items.filter((i) => (i.group ?? "other") === g).map((it) => {
            const v = prefs[it.key] ?? it.default, id = "pref-" + it.key.replace(/\W/g, "-");
            let ctl;
            if (it.key === "theme") ctl = <select id={id} value={String(v)} onChange={(e) => void save(it.key, e.target.value)} className="field">{themes.map((th) => { const val = th.id.replace(/^@nuah\/theme-/, ""); return <option key={th.id} value={val}>{(th.tokens as unknown as { name?: string }).name ?? val}</option>; })}</select>;
            else if (it.type === "boolean") ctl = <input id={id} type="checkbox" checked={!!v} onChange={(e) => void save(it.key, e.target.checked)} />;
            else if (it.type === "integer") ctl = <input id={id} type="number" min={it.min} max={it.max} defaultValue={Number(v)} onBlur={(e) => void save(it.key, Number(e.target.value))} className="field w-24" />;
            else if (it.type === "choice") ctl = <select id={id} value={String(v)} onChange={(e) => void save(it.key, e.target.value)} className="field">{(it.choices ?? []).map((c) => <option key={c.value} value={c.value}>{(lang === "ar" && c.label.ar) || c.label.en}</option>)}</select>;
            else if (it.type === "color") ctl = <input id={id} type="color" defaultValue={String(v || "#0b7a70")} onBlur={(e) => void save(it.key, e.target.value)} className="h-7 w-16" />;
            else ctl = <input id={id} type="text" defaultValue={String(v ?? "")} onBlur={(e) => void save(it.key, e.target.value)} className="field" />;
            return <div key={it.key} className="flex items-center justify-between gap-3 py-1.5"><label htmlFor={id}>{label(it)}</label>{ctl}</div>;
          })}
          {g === "appearance" && describe.operations["appearance.schema"] && <div className="flex items-center justify-between gap-3 py-1.5"><label>{t("customize")}</label><Button onClick={onAppearance}>{t("customizeBtn")}</Button></div>}
        </section>
      ))}
    </Window>
  );
}
