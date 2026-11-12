import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import type { Page } from "../../api/types";
import { useDescribe } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { cn } from "../../lib/cn";
import { Button } from "../../ui/Button";
import { askConfirm, toast } from "../../ui/overlays";
import { Window } from "../dialogs/Dialog";
import { inputOf, keyOf, opOf, type PageScope } from "./scope";

interface Version { id: string; at: number; by?: string; text?: string }

/** The earlier pictures of a page, newest first: read one, and put it back (the page keeps the current one as a picture too). */
export default function History({ page, scope, writer, onClose }: { page: Page; scope: PageScope; writer: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const f = useDateFormat();
  const qc = useQueryClient();
  const who = useDescribe().who;
  const name = (s?: string) => (s && who && s === who.subject ? who.display : s ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const call = <T,>(name: string, input: object) => link.call(opOf(scope, name) as never, inputOf(scope, { id: page.id, ...input }) as never) as Promise<T>;
  const list = useQuery({ queryKey: [opOf(scope, "versions"), inputOf(scope, { id: page.id })], queryFn: () => call<{ versions: Version[] }>("versions", {}) });
  const versions = list.data?.versions ?? [];
  const current = picked ?? versions[0]?.id ?? null;
  const one = useQuery({ queryKey: [opOf(scope, "version"), inputOf(scope, { id: page.id, version: current })], queryFn: () => call<{ title: string; body: unknown }>("version", { version: current }), enabled: !!current });
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
          {versions.length === 0 && <li className="p-2.5 text-muted">{t("noVersions")}</li>}
          {versions.map((v) => (
            <li key={v.id}><button type="button" aria-current={v.id === current} onClick={() => setPicked(v.id)} className={cn("block w-full rounded-md px-2.5 py-2 text-start hoverable", v.id === current && "bg-hover")}>
              <strong className="block">{f.time(v.at)}</strong><small className="block truncate text-muted" dir="auto">{name(v.by) + " · " + (v.text || "…")}</small></button></li>
          ))}
        </ul>
        <div className="min-w-0">
          {one.data && (
            <>
              <h3 className="m-0 mb-2" dir="auto">{one.data.title}</h3>
              <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 text-[13px]" dir="auto">{window.MadarEditor ? window.MadarEditor.text(one.data.body) : ""}</pre>
              {writer && <div className="mt-3"><Button kind="primary" icon="history" onClick={() => void restore()}>{t("restoreVersion")}</Button></div>}
            </>
          )}
        </div>
      </div>
    </Window>
  );
}
