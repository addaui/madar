import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useMaybeRead, useRead } from "../../api/hooks";
import { link } from "../../api/link";
import type { Ops } from "../../api/contract";
import { spaceState, usePersistedValue } from "../../app/ui-state";
import { useI18n, type Key } from "../../i18n/i18n";
import { useDateFormat } from "../../lib/format";
import { Button } from "../../ui/Button";
import { copyText } from "../../ui/CopyCode";
import { TextField } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { askConfirm } from "../../ui/overlays";
import { PopupButton } from "../../ui/Popup";
import { Select } from "../../ui/Select";
import { useHasOp } from "../../api/session";
import { cn } from "../../lib/cn";

type Site = Ops["shares.space"]["output"];
const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ predicate: (q) => /^shares\./.test(String(q.queryKey[0])) });

/**
 * In the top bar while a shared Space is chosen (ADR 0084): a globe with a check when the website shows the Space as it is, an exclamation mark
 * when pages changed since. It opens the site's panel: the address, the releases, and (for an admin) publishing.
 */
export function SiteIndicator() {
  const { t } = useI18n();
  const space = usePersistedValue(spaceState);
  const spaces = useRead("spaces.list").data.spaces;
  const cur = spaces.find((s) => s.id === space && !s.builtin);
  const allowed = useHasOp("shares.space");
  const q = useMaybeRead("shares.space", cur ? { space: cur.id } : undefined, !!cur && allowed);
  if (!cur || !allowed || !q.data) return null;
  const site = q.data;
  const admin = cur.role === "admin";
  if (!site.share && !admin) return null;
  const state = !site.share ? "none" : site.status?.current ? "ok" : "stale";
  const label = !site.share ? t("siteMake") : state === "ok" ? t("siteUpToDate") : t("siteOutOfDate", { n: site.status?.changed ?? 0 });
  return (
    <PopupButton label={`${t("siteStatusLabel")}: ${label}`} width={360}
      buttonProps={{ className: "relative inline-grid size-[30px] shrink-0 place-items-center rounded-sm text-muted hoverable hover:text-text data-[pressed]:bg-soft" }}
      trigger={<>
        <Icon name="globe" />
        {state !== "none" && <span aria-hidden="true" className={cn("absolute -end-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full text-white", state === "ok" ? "bg-ok" : "bg-danger")}><Icon name={state === "ok" ? "check" : "alert"} className="size-2.5" /></span>}
      </>}>
      <SitePanel space={cur.id} name={cur.name} site={site} admin={admin} />
    </PopupButton>
  );
}

function SitePanel({ space, name, site, admin }: { space: string; name: string; site: Site; admin: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const options = useRead("shares.options").data;
  const f = useDateFormat();
  const [error, setError] = useState("");
  const [sub, setSub] = useState("");
  const [audience, setAudience] = useState<"anyone" | "pin" | "accounts" | "people">("anyone");
  const run = async (fn: () => Promise<unknown>) => { try { setError(""); await fn(); await refresh(qc); } catch (e) { setError(e instanceof Error ? e.message : ""); } };
  const aud = options.accounts ? (["anyone", "pin", "accounts", "people"] as const) : (["anyone", "pin"] as const);
  const address = (s: string) => `${location.protocol}//${s}.${options.base_domain ?? location.host}`;
  if (!site.share) {
    return (
      <div className="grid gap-3 p-1">
        <b>{t("siteMake")}</b>
        <TextField label={t("siteName")} description={t("siteNameRule")} value={sub} onChange={(v) => setSub(v.toLowerCase())} />
        <p className="m-0 text-[12px] text-muted">{sub ? address(sub) : ""} {!options.base_domain && t("siteNeedsDomain")}</p>
        <Select label={t("shareWho")} value={audience} onChange={(a) => setAudience(a as typeof audience)} options={aud.map((a) => ({ value: a, label: t(("aud_" + a) as Key) }))} />
        <div><Button kind="primary" isDisabled={sub.length < 3} onPress={() => void run(() => link.call("shares.create_space", { space, subdomain: sub, audience }))}>{t("shareCreate")}</Button></div>
        {error && <p role="alert" className="m-0 text-danger">{error}</p>}
      </div>
    );
  }
  const share = site.share;
  return (
    <div className="grid gap-3 p-1">
      <b>{t("siteTitle")} · {name}</b>
      <div className="flex items-center gap-2">
        <TextField label={t("siteAddress")} value={address(share.subdomain ?? "")} isReadOnly className="min-w-0 grow" />
        <Button onPress={() => void copyText(address(share.subdomain ?? ""), t("shareCopied"))}>{t("shareCopy")}</Button>
      </div>
      <p className="m-0 text-[13px]">{site.status?.current ? t("siteUpToDate") : t("siteOutOfDate", { n: site.status?.changed ?? 0 })} · {t("siteShowing", { n: share.release })}</p>
      {share.audience === "pin" && share.pin && <p className="m-0 text-[13px]"><b>{t("sharePin")}:</b> <code>{share.pin}</code></p>}
      {admin && (
        <>
          <Button kind={site.status?.current ? undefined : "primary"} onPress={() => void run(() => link.call("shares.publish", { id: share.id }))}>{t("sitePublishNow")}</Button>
          <Releases id={share.id} onChoose={(n) => void run(() => link.call("shares.publish", { id: share.id, release: n }))} fmt={f.time} />
          <Select label={t("shareWho")} value={share.audience} onChange={(a) => void run(() => link.call("shares.update", { id: share.id, audience: a as typeof audience }))} options={aud.map((a) => ({ value: a, label: t(("aud_" + a) as Key) }))} />
          <Button kind="danger" onPress={async () => { if (await askConfirm(t("shareRevokeSure"), { action: t("siteStop") })) await run(() => link.call("shares.revoke", { id: share.id })); }}>{t("siteStop")}</Button>
        </>
      )}
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </div>
  );
}

function Releases({ id, onChoose, fmt }: { id: string; onChoose: (n: number) => void; fmt: (ms: number) => string }) {
  const { t } = useI18n();
  const list = useRead("shares.releases", { id }).data.releases;
  if (list.length < 2) return null;
  return (
    <div className="grid gap-1">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">{t("siteChoose")}</span>
      <ul className="m-0 grid list-none gap-1 p-0">
        {list.map((r) => (
          <li key={r.number} className="flex items-center justify-between gap-2 text-[13px]">
            <span>{t("shareReleaseNo", { n: r.number })} · {fmt(r.at)}</span>
            {r.current ? <Icon name="check" className="size-3.5 text-ok" /> : <Button size="sm" onPress={() => onChoose(r.number)}>{t("siteShowing", { n: r.number })}</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
