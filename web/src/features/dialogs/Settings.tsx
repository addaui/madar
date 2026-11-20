import { useQueryClient } from "@tanstack/react-query";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { themesOf, useDescribe, useHasOp, usePrefs } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { useUnavailableEmojiSets } from "../../ui/emoji";
import { Checkbox } from "../../ui/Check";
import { ColorField } from "../../ui/ColorField";
import { NumberField, TextField } from "../../ui/Field";
import { Select } from "../../ui/Select";
import { About } from "./About";
import { Window } from "./Dialog";

interface Item { key: string; group?: string; type: string; label: { en: string; ar?: string }; default?: unknown; choices?: { value: string; label: { en: string; ar?: string } }[]; min?: number; max?: number }

/** Preferences, built from the schema the plugins declare. Each change is saved at once. */
export function Settings({ onClose, onAppearance, onFeatures }: { onClose: () => void; onAppearance: () => void; onFeatures: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const prefs = usePrefs() as Record<string, unknown>;
  const describe = useDescribe();
  const items = (useRead("prefs.schema").data as { items: Item[] }).items;
  const themes = themesOf(describe);
  const noFont = useUnavailableEmojiSets();
  const canManageFeatures = useHasOp("features.list");
  const save = async (key: string, value: unknown) => {
    const out = await link.call("prefs.set", { [key]: value } as never);
    qc.setQueryData(["prefs.get", {}], out);
  };
  const groups = [...new Set(items.map((i) => i.group ?? "other"))];
  const label = (it: Item) => (lang === "ar" && it.label.ar) || it.label.en;
  return (
    <Window title={t("settings")} onClose={onClose} wide>
      {canManageFeatures && <section className="mb-4 flex items-center justify-between gap-3 rounded-md border border-line p-3"><span>{t("featuresIntro").split(".")[0]}.</span><Button onPress={onFeatures}>{t("featuresBtn")}</Button></section>}
      {groups.map((g) => (
        <section key={g} className="mb-4 rounded-md border border-line p-3">
          <h2 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t(("g_" + g) as "g_other")}</h2>
          {items.filter((i) => (i.group ?? "other") === g).map((it) => {
            const v = prefs[it.key] ?? it.default;
            let ctl;
            const opts = (it.choices ?? []).map((c) => ({ value: c.value, label: ((lang === "ar" && c.label.ar) || c.label.en) + (it.key === "emoji.set" && noFont.has(c.value) ? " · " + t("notOnDevice") : ""), disabled: it.key === "emoji.set" && noFont.has(c.value) }));
            if (it.key === "theme") ctl = <Select label={label(it)} value={String(v)} onChange={(x) => void save(it.key, x)} options={themes.map((th) => { const val = th.id.replace(/^@nuah\/theme-/, ""); return { value: val, label: th.name ?? val }; })} />;
            else if (it.type === "boolean") ctl = <Checkbox aria-label={label(it)} isSelected={!!v} onChange={(x) => void save(it.key, x)} />;
            else if (it.type === "integer") ctl = <NumberField label={label(it)} minValue={it.min} maxValue={it.max} defaultValue={Number(v)} onChange={(x) => { if (Number.isFinite(x)) void save(it.key, x); }} className="w-24" />;
            else if (it.type === "choice") ctl = <Select label={label(it)} value={String(v)} onChange={(x) => void save(it.key, x)} options={opts} />;
            else if (it.type === "color") ctl = <ColorField label={label(it)} value={String(v || "#0b7a70")} onChange={(x) => void save(it.key, x)} />;
            else ctl = <TextField label={label(it)} defaultValue={String(v ?? "")} onBlur={(e) => void save(it.key, (e.target as HTMLInputElement).value)} />;
            return <div key={it.key} className="flex items-center justify-between gap-3 py-1.5"><span>{label(it)}</span>{ctl}</div>;
          })}
          {g === "appearance" && describe.operations["appearance.schema"] && <div className="flex items-center justify-between gap-3 py-1.5"><label>{t("customize")}</label><Button onPress={onAppearance}>{t("customizeBtn")}</Button></div>}
        </section>
      ))}
      <About />
    </Window>
  );
}
