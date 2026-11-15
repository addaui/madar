import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { spaceState, usePersistedValue } from "../../app/ui-state";
import { useI18n, type Key } from "../../i18n/i18n";
import { Switch } from "../../ui/Check";
import { Window } from "./Dialog";

const label = (id: string): Key => ("feat_" + id.replace("@madar/", "")) as Key;

/** What the current Space uses (ADR 0082): an admin switches the features the instance allows, for everyone in the Space. */
export function SpaceFeatures({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const space = usePersistedValue(spaceState);
  const spaces = useRead("spaces.list").data.spaces;
  const cur = spaces.find((s) => s.id === space && !s.builtin);
  if (!cur) return <Window title={t("spaceFeatures")} onClose={onClose}><p className="m-0 text-muted">{t("personalSpaceNote")}</p></Window>;
  return <Features id={cur.id} name={cur.name} admin={cur.role === "admin"} onClose={onClose} />;
}

function Features({ id, name, admin, onClose }: { id: string; name: string; admin: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const list = useRead("spaces.features", { space: id }).data.features;
  const [error, setError] = useState<string | null>(null);
  const change = async (feature: string, on: boolean) => {
    const chosen = list.filter((f) => (f.id === feature ? on : f.enabled)).map((f) => f.id);
    try { await link.call("spaces.set_features", { space: id, features: chosen }); setError(null); await qc.invalidateQueries({ predicate: (q) => /^(spaces|tasks|knowledge|discussion|timeline|projects)\./.test(String(q.queryKey[0])) }); } catch (x) { setError(x instanceof Error ? x.message : t("offline")); }
  };
  return (
    <Window title={`${t("spaceFeatures")} · ${name}`} onClose={onClose}>
      <p className="m-0 mb-3 text-muted">{t("spaceFeaturesIntro")}</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {list.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
            <span>{t(label(f.id))}{!f.allowed && <span className="ms-2 text-[12px] text-muted">{t("spaceFeatureNotAllowed")}</span>}</span>
            <Switch aria-label={t(label(f.id))} isSelected={f.enabled} isDisabled={!admin || !f.allowed} onChange={(on) => void change(f.id, on)} />
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Window>
  );
}
