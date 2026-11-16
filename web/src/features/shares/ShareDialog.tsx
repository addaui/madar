import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRead } from "../../api/hooks";
import { link } from "../../api/link";
import type { Ops } from "../../api/contract";
import { useI18n, type Key } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Check";
import { copyText } from "../../ui/CopyCode";
import { TextField } from "../../ui/Field";
import { askConfirm } from "../../ui/overlays";
import { Select } from "../../ui/Select";
import { Window } from "../dialogs/Dialog";

type Share = Ops["shares.list"]["output"]["shares"][number];
type Audience = "anyone" | "pin" | "accounts" | "people";
type Mode = "pinned" | "live";
const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ predicate: (q) => /^shares\./.test(String(q.queryKey[0])) });
const addressOf = (s: Share) => `${location.origin}/share/${s.id}`;
const errorOf = (e: unknown) => (e instanceof Error ? e.message : "");

/** What a share of a page looks like to the person who made it: who may open it, which version, the link. Everyone shares view-only. */
export function ShareDialog({ page, project, onClose }: { page: { id: string; title: string }; project?: string; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const options = useRead("shares.options").data;
  const list = useRead("shares.list", { page: page.id }).data.shares;
  const [error, setError] = useState("");
  const run = async (f: () => Promise<unknown>) => { try { setError(""); await f(); await refresh(qc); } catch (e) { setError(errorOf(e)); } };
  return (
    <Window title={`${t("shareTitle")} · ${page.title}`} onClose={onClose} wide>
      <p className="m-0 mb-3 text-muted">{t("shareViewOnly")}</p>
      <h3 className="mb-2 mt-0 text-[13px] font-semibold uppercase tracking-wide text-muted">{t("shareLinks")}</h3>
      {list.length === 0 && <p className="m-0 mb-3 text-muted">{t("shareNone")}</p>}
      <ul className="m-0 mb-4 grid list-none gap-3 p-0">
        {list.map((s) => <ShareRow key={s.id} s={s} accounts={options.accounts} run={run} />)}
      </ul>
      <CreateShare accounts={options.accounts} onCreate={(v) => run(() => link.call("shares.create_page", { page: page.id, ...(project ? { project } : {}), ...v }))} />
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
    </Window>
  );
}

const audiences = (accounts: boolean): Audience[] => (accounts ? ["anyone", "pin", "accounts", "people"] : ["anyone", "pin"]);

function ShareRow({ s, accounts, run }: { s: Share; accounts: boolean; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const { t } = useI18n();
  const [people, setPeople] = useState(s.people.map((p) => p.display ?? p.subject).join(", "));
  return (
    <li className="grid gap-2 rounded-md border border-line p-3">
      <div className="flex items-center gap-2">
        <TextField label={t("shareCopy")} showLabel={false} value={addressOf(s)} isReadOnly className="min-w-0 grow" />
        <Button onPress={() => void copyText(addressOf(s), t("shareCopied"))}>{t("shareCopy")}</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("shareWho")} value={s.audience} onChange={(a) => void run(() => link.call("shares.update", { id: s.id, audience: a as Audience }))} options={audiences(accounts).map((a) => ({ value: a, label: t(("aud_" + a) as Key) }))} />
        <Select label={t("shareVersion")} value={s.mode} onChange={(m) => void run(() => link.call("shares.update", { id: s.id, mode: m as Mode }))}
          options={[{ value: "pinned", label: t("shareVersionPinned") }, { value: "live", label: t("shareVersionLive") }]} />
        <Checkbox isSelected={s.include_children} onChange={(c) => void run(() => link.call("shares.update", { id: s.id, include_children: c }))}>{t("shareSubpages")}</Checkbox>
      </div>
      <p className="m-0 text-[12px] text-muted">{s.mode === "pinned" ? t("shareVersionPinnedHint") : t("shareVersionLiveHint")} {s.include_children && t("shareSubpagesHint")}</p>
      {s.audience === "pin" && s.pin && <p className="m-0 text-[13px]"><b>{t("sharePin")}:</b> <code>{s.pin}</code></p>}
      {s.audience === "people" && (
        <div className="flex items-end gap-2"><TextField label={t("sharePeople")} value={people} onChange={setPeople} className="min-w-0 grow" />
          <Button onPress={() => void run(() => link.call("shares.update", { id: s.id, people: people.split(",").map((n) => n.trim()).filter(Boolean) }))}>{t("save")}</Button></div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {s.mode === "pinned" && <Button onPress={() => void run(() => link.call("shares.publish", { id: s.id }))}>{t("sharePublish")} · {t("shareReleaseNo", { n: s.release })}</Button>}
        <Button kind="danger" onPress={async () => { if (await askConfirm(t("shareRevokeSure"), { action: t("shareRevoke") })) await run(() => link.call("shares.revoke", { id: s.id })); }}>{t("shareRevoke")}</Button>
      </div>
    </li>
  );
}

function CreateShare({ accounts, onCreate }: { accounts: boolean; onCreate: (v: { audience: Audience; mode: Mode; include_children: boolean; people?: string[] }) => Promise<void> }) {
  const { t } = useI18n();
  const [audience, setAudience] = useState<Audience>("anyone");
  const [mode, setMode] = useState<Mode>("pinned");
  const [sub, setSub] = useState(false);
  const [people, setPeople] = useState("");
  return (
    <section className="grid gap-3 rounded-md border border-line bg-soft p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("shareWho")} value={audience} onChange={(a) => setAudience(a as Audience)} options={audiences(accounts).map((a) => ({ value: a, label: t(("aud_" + a) as Key) }))} />
        <Select label={t("shareVersion")} value={mode} onChange={(m) => setMode(m as Mode)} options={[{ value: "pinned", label: t("shareVersionPinned") }, { value: "live", label: t("shareVersionLive") }]} />
      </div>
      <p className="m-0 text-[12px] text-muted">{mode === "pinned" ? t("shareVersionPinnedHint") : t("shareVersionLiveHint")}</p>
      {!accounts && <p className="m-0 text-[12px] text-muted">{t("shareNoAccounts")}</p>}
      {audience === "people" && <TextField label={t("sharePeople")} value={people} onChange={setPeople} />}
      <div className="grid gap-0.5">
        <Checkbox isSelected={sub} onChange={setSub}>{t("shareSubpages")}</Checkbox>
        {sub && <span className="ps-[26px] text-[12px] text-muted">{t("shareSubpagesHint")}</span>}
      </div>
      <div><Button kind="primary" onPress={() => void onCreate({ audience, mode, include_children: sub, ...(audience === "people" ? { people: people.split(",").map((n) => n.trim()).filter(Boolean) } : {}) })}>{t("shareCreate")}</Button></div>
    </section>
  );
}
