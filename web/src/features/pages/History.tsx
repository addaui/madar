import { textOf } from "./text";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import type { Page } from "../../api/types";
import { useDescribe } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { cn } from "../../lib/cn";
import { BaseButton, Button } from "../../ui/Button";
import { askConfirm, askText, toast } from "../../ui/overlays";
import { compareDocs } from "./diff";
import { Window } from "../dialogs/Dialog";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";

interface Version { id: string; at: number; by?: string; text?: string; name?: string | null }

/** The Versions of a page, newest first (ADR 0093): read one, name it, compare it with the page as it is now, and bring it back (the page is
 *  marked first, so a restore can itself be undone). */
export default function History({ page, scope, writer, onClose }: { page: Page; scope: PageScope; writer: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const f = useDateFormat();
  const qc = useQueryClient();
  const who = useDescribe().who;
  const name = (s?: string) => (s && who && s === who.subject ? who.display : s ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const call = <T,>(name: string, input: object) => link.call(opOf(scope, name) as never, inputOf(scope, { id: page.id, ...input }) as never) as Promise<T>;
  const list = useQuery({ queryKey: [opOf(scope, "versions"), inputOf(scope, { id: page.id })], queryFn: () => call<{ versions: Version[] }>("versions", {}) });
  const versions = list.data?.versions ?? [];
  const current = picked ?? versions[0]?.id ?? null;
  const one = useQuery({ queryKey: [opOf(scope, "version"), inputOf(scope, { id: page.id, version: current })], queryFn: () => call<{ title: string; body: unknown }>("version", { version: current }), enabled: !!current });
  const nameIt = async () => {
    const v = versions.find((x) => x.id === current);
    if (!v) return;
    const name = await askText(t("versionName"), v.name ?? "");
    if (name === null) return;
    await call("version_name", { version: v.id, name: name.trim() || null });
    await list.refetch();
    toast(t("versionNamed"));
  };
  const restore = async () => {
    if (!current || !(await askConfirm(t("sureRestore"), { action: t("restoreVersion"), danger: false }))) return;
    const back = await call<Page>("restore", { version: current });
    qc.setQueryData(keyOf(scope, "get", { id: page.id }), back);
    await qc.invalidateQueries({ predicate: (q) => /^(pages|knowledge)\./.test(String(q.queryKey[0])) });
    toast(t("restored"));
    onClose();
  };
  return (
    <Window title={t("pageHistory")} onClose={onClose} wide>
      <div className="grid min-h-[40vh] grid-cols-[240px_minmax(0,1fr)] gap-3 max-md:grid-cols-1">
        <ul className="m-0 grid max-h-[55vh] list-none content-start gap-0.5 overflow-auto p-0">
          {versions.length === 0 && <li className="p-2.5 text-muted-foreground">{t("noVersions")}</li>}
          {versions.map((v) => (
            <li key={v.id}><BaseButton aria-current={v.id === current} onPress={() => setPicked(v.id)} className={cn("block w-full rounded-md px-2.5 py-2 text-start hoverable", v.id === current && "bg-hover")}>
              {v.name && <strong className="block truncate" dir="auto">{v.name}</strong>}<strong className={cn("block", v.name && "font-normal text-muted-foreground")}>{f.time(v.at)}</strong><small className="block truncate text-muted-foreground" dir="auto">{name(v.by) + " · " + (v.text || "…")}</small></BaseButton></li>
          ))}
        </ul>
        <div className="min-w-0">
          {one.data && (
            <>
              <h3 className="m-0 mb-2" dir="auto">{one.data.title}</h3>
              {compare ? (
                <div className="max-h-[45vh] overflow-auto rounded-md bg-sunken p-3 text-[13px]" dir="auto">
                  {compareDocs(one.data.body, page.body).map((b, i) => (
                    <p key={i} className={cn("m-0 mb-1.5 whitespace-pre-wrap", b.kind === "added" && "bg-[color-mix(in_oklab,var(--ok,green)_18%,transparent)]", b.kind === "removed" && "bg-[color-mix(in_oklab,var(--danger,red)_14%,transparent)] line-through")}
                      aria-label={b.kind === "added" ? t("diffAdded") : b.kind === "removed" ? t("diffRemoved") : undefined}>
                      {b.words ? b.words.map((w, k) => (w.op === "added" ? <ins key={k} className="bg-[color-mix(in_oklab,var(--ok,green)_22%,transparent)] no-underline">{w.text}</ins> : w.op === "removed" ? <del key={k} className="bg-[color-mix(in_oklab,var(--danger,red)_18%,transparent)]">{w.text}</del> : <span key={k}>{w.text}</span>)) : b.text}
                    </p>
                  ))}
                </div>
              ) : (
                <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 text-[13px]" dir="auto">{textOf(one.data.body)}</pre>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {writer && <Button kind="primary" icon="history" onPress={() => void restore()}>{t("restoreVersion")}</Button>}
                <Button onPress={() => setCompare((c) => !c)} aria-pressed={compare}>{t("compareWithNow")}</Button>
                {writer && <Button onPress={() => void nameIt()}>{t("nameVersion")}</Button>}
              </div>
            </>
          )}
        </div>
      </div>
    </Window>
  );
}
