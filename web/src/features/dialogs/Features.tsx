import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import type { FeaturesListOutput } from "../../api/contract";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { Checkbox, Switch } from "../../ui/Check";
import { Disclosure } from "../../ui/Disclosure";
import { NumberField, TextField } from "../../ui/Field";
import { Select } from "../../ui/Select";
import { notify } from "../../ui/Toast";
import { Window } from "./Dialog";

type Feature = FeaturesListOutput["features"][number];
interface Prop { type?: string | string[]; enum?: string[]; items?: { enum?: string[] }; title?: string; description?: string; minimum?: number; maximum?: number; default?: unknown; "x-secret"?: boolean }
interface Schema { properties?: Record<string, Prop> }
const isMarker = (v: unknown) => !!v && typeof v === "object" && (v as { $secret?: boolean }).$secret === true;
const errorOf = (e: unknown) => e as { reason?: string | null; message?: string };

/** What the Owner may switch (ADR 0080). The Core says which plugins are features; this page only shows what it was told. */
export function Features({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["features.list"], queryFn: () => link.call("features.list", {}), staleTime: 0 });
  const [pending, setPending] = useState(false);
  const [restart, setRestart] = useState(false);
  const [confirm, setConfirm] = useState<{ id: string; message: string } | null>(null);
  const [error, setError] = useState("");

  const run = async (act: () => Promise<unknown>, id = "") => {
    setError("");
    setPending(true);
    try {
      await act();
      setRestart(true);
      await qc.invalidateQueries({ queryKey: ["features.list"] });
    } catch (e) {
      const x = errorOf(e);
      // others need it: the Core named them and saved nothing; the Owner decides whether to switch those off too
      if (x.reason === "features.needed_by") setConfirm({ id, message: x.message ?? "" });
      else setError(x.message ?? String(e));
    } finally {
      setPending(false);
    }
  };
  const toggle = (f: Feature, on: boolean) => void run(() => (on ? link.call("features.enable", { id: f.id }) : link.call("features.disable", { id: f.id })), f.id);
  const apply = async () => {
    setPending(true);
    try {
      await link.call("features.apply", {});
    } catch (e) {
      setPending(false);
      return setError(errorOf(e).message ?? String(e));
    }
    // the instance starts again; come back when it answers
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        if (i > 1 && (await fetch("/healthz", { cache: "no-store" })).ok) return void location.reload();
      } catch { /* still starting */ }
    }
    setPending(false);
    setError(t("featuresNotBack"));
  };

  const data = list.data;
  const shown = (data?.features ?? []).filter((f) => f.kind !== "theme");
  // what came with a newer version of the product and was never switched either way (features the Owner may turn on now; platform plugins wait for the operator)
  const fresh = shown.filter((f) => f.new && !f.enabled);
  const freshPlatform = (data?.platform ?? []).filter((p) => p.new && !p.enabled);
  const turnOnNew = () => void run(async () => { for (const f of fresh) await link.call("features.enable", { id: f.id }); });
  return (
    <Window title={t("features")} onClose={onClose} wide>
      <p className="m-0 mb-3 text-muted-foreground">{t("featuresIntro")}</p>
      {list.error && <p role="alert" className="text-danger">{errorOf(list.error).message}</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {confirm && (
        <div role="alert" aria-label={t("featuresNeededBy")} className="mb-3 rounded-md border border-line p-3">
          <p className="m-0 mb-2">{confirm.message}</p>
          <div className="flex gap-2">
            <Button kind="primary" onPress={() => { const c = confirm; setConfirm(null); void run(() => link.call("features.disable", { id: c.id, cascade: true })); }}>{t("featuresSwitchAllOff")}</Button>
            <Button onPress={() => setConfirm(null)}>{t("cancel")}</Button>
          </div>
        </div>
      )}
      {restart && (
        <div role="status" className="mb-3 flex items-center justify-between gap-3 rounded-md border border-line bg-soft p-3">
          <span>{t("featuresSaved")}</span>
          <Button kind="primary" onPress={() => void apply()} isPending={pending}>{t("featuresApply")}</Button>
        </div>
      )}
      {(fresh.length > 0 || freshPlatform.length > 0) && (
        <div role="status" className="mb-3 grid gap-2 rounded-md border border-line bg-soft p-3">
          <b>{t("featuresNewTitle")}</b>
          {fresh.length > 0 && <>
            <span className="text-muted-foreground">{fresh.map((f) => f.name || f.id).join(" · ")}</span>
            <div><Button kind="primary" size="sm" onPress={turnOnNew} isPending={pending}>{t("featuresTurnOnNew")}</Button></div>
          </>}
          {freshPlatform.length > 0 && <span className="text-[12px] text-muted-foreground">{t("featuresNewPlatform", { names: freshPlatform.map((p) => p.name || p.id).join(", ") })}</span>}
        </div>
      )}
      {shown.map((f) => <FeatureCard key={f.id} f={f} busy={pending} onToggle={(on) => toggle(f, on)} onSave={(settings) => void run(async () => { await link.call("features.configure", { id: f.id, settings }); notify(t("saved")); })} />)}
      {data && data.platform.length > 0 && (
        <Disclosure title={t("featuresPlatform")} className="mt-4">
          <p className="m-0 mb-2 text-muted-foreground">{t("featuresPlatformNote")}</p>
          <ul className="m-0 list-none p-0">
            {data.platform.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-1.5">
                <span><b>{p.name || p.id}</b> <span className="text-muted-foreground">{p.enabled ? t("featuresOn") : t("featuresOff")}</span></span>
                <span className="text-[12px] text-muted-foreground">{p.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Window>
  );
}

function FeatureCard({ f, busy, onToggle, onSave }: { f: Feature; busy: boolean; onToggle: (on: boolean) => void; onSave: (settings: Record<string, unknown>) => void }) {
  const { t } = useI18n();
  const props = Object.entries(((f.settings_schema ?? {}) as Schema).properties ?? {});
  const stored = (f.settings ?? {}) as Record<string, unknown>;
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...stored }));
  const [dirty, setDirty] = useState(false);
  const set = (k: string, v: unknown) => { setValues((x) => ({ ...x, [k]: v })); setDirty(true); };
  return (
    <section className="mb-3 rounded-md border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15px] font-semibold">{f.name || f.id}{f.new && !f.enabled && <span className="ms-2 rounded-chip bg-brand px-1.5 text-[11px] font-medium text-brand-foreground">{t("featuresNewBadge")}</span>}</h2>
          {f.description && <p className="m-0 mt-0.5 text-muted-foreground">{f.description}</p>}
          {f.needs.length > 0 && <p className="m-0 mt-0.5 text-[12px] text-muted-foreground">{t("featuresNeeds")}: {f.needs.join(", ")}</p>}
        </div>
        <Switch aria-label={f.name || f.id} isSelected={f.enabled} isDisabled={busy} onChange={onToggle} />
      </div>
      {f.enabled && props.length > 0 && (
        <div className="mt-3 grid gap-2">
          {props.map(([k, p]) => {
            const label = p.title ?? k;
            const v = values[k];
            const types = Array.isArray(p.type) ? p.type : p.type ? [p.type] : [];
            if (types.includes("array") && p.items?.enum) {
              const chosen = Array.isArray(v) ? (v as string[]) : [];
              return (
                <fieldset key={k} className="m-0 grid gap-1 border-0 p-0">
                  <legend className="mb-1 font-medium">{label}</legend>
                  {p.description && <span className="text-[12px] text-muted-foreground">{p.description}</span>}
                  {p.items.enum.map((e) => <Checkbox key={e} isSelected={chosen.includes(e)} onChange={(on) => set(k, on ? [...chosen, e] : chosen.filter((x) => x !== e))}>{e}</Checkbox>)}
                </fieldset>
              );
            }
            if (p.enum) return <Select key={k} label={label} value={String(v ?? p.default ?? p.enum[0])} onChange={(x) => set(k, x)} options={p.enum.map((e) => ({ value: e, label: e }))} />;
            if (types.includes("boolean")) return <Checkbox key={k} isSelected={!!(v ?? p.default)} onChange={(x) => set(k, x)}>{label}</Checkbox>;
            if (types.includes("integer") || types.includes("number")) return <NumberField key={k} label={label} minValue={p.minimum} maxValue={p.maximum} defaultValue={Number(v ?? p.default ?? 0)} onChange={(x) => { if (Number.isFinite(x)) set(k, x); }} className="w-32" />;
            if (p["x-secret"]) return <TextField key={k} label={label} description={isMarker(v) ? t("featuresSecretSet") : p.description} type="password" defaultValue="" onChange={(x) => set(k, x === "" && isMarker(stored[k]) ? stored[k] : x)} />;
            return <TextField key={k} label={label} description={p.description} defaultValue={String(v ?? "")} onChange={(x) => set(k, x)} />;
          })}
          <div><Button isDisabled={!dirty || busy} onPress={() => { setDirty(false); onSave(values); }}>{t("save")}</Button></div>
        </div>
      )}
    </section>
  );
}
