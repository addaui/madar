import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { link } from "../../api/link";
import { useDescribe, useHasOp } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/Field";
import { askConfirm, toast } from "../../ui/overlays";

interface Key { id: string; name: string; created_at: number }

/**
 * Settings, API keys and agents (ADR 0101): a person makes a key for an agent or a script; it acts as them, with all their rights,
 * until revoked. The key is shown once, with the MCP address and a client setup ready to paste.
 */
export function ApiKeys() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const can = useHasOp("auth.keys.create");
  const mcpOn = ((useDescribe() as { plugins?: { id: string }[] }).plugins ?? []).some((p) => p.id === "@nuah/mcp");
  const list = useQuery({ queryKey: ["auth.keys.list"], queryFn: () => link.call("auth.keys.list" as never, {} as never) as Promise<{ keys: Key[] }>, enabled: can });
  const [name, setName] = useState("");
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  if (!can) return null;
  const address = `${location.origin}/mcp`;
  const refresh = () => qc.invalidateQueries({ queryKey: ["auth.keys.list"] });
  const make = async () => {
    const n = name.trim() || t("apiKeyDefaultName");
    const out = (await link.call("auth.keys.create" as never, { name: n } as never)) as { key: string; name: string };
    setMade({ key: out.key, name: n });
    setName("");
    await refresh();
  };
  const revoke = async (k: Key) => {
    if (!(await askConfirm(t("apiKeyRevokeAsk", { name: k.name }), { action: t("apiKeyRevoke") }))) return;
    await link.call("auth.keys.revoke" as never, { id: k.id } as never);
    if (made && made.name === k.name) setMade(null);
    await refresh();
  };
  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => toast(t("copied")), () => undefined);
  const setup = made ? JSON.stringify({ mcpServers: { madar: { type: "http", url: address, headers: { Authorization: `Bearer ${made.key}` } } } }, null, 2) : "";
  const day = (ms: number) => new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en", { dateStyle: "medium" }).format(new Date(ms));
  return (
    <section className="mb-4 grid gap-3 rounded-md border border-line p-3" aria-labelledby="keys-title">
      <h2 id="keys-title" className="m-0 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t("apiKeysTitle")}</h2>
      <p className="m-0 text-sm text-muted-foreground">{t("apiKeysIntro")}</p>
      {mcpOn && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm">{t("apiKeysMcp")}</span>
          <span className="flex items-center gap-2"><code dir="ltr" className="rounded-sm bg-soft px-1.5 py-0.5 text-xs">{address}</code><Button size="sm" icon="copy" onPress={() => copy(address)}>{t("aboutCopy")}</Button></span>
        </div>
      )}
      {(list.data?.keys ?? []).length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0">
          {list.data!.keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-1">
              <span><span className="font-medium">{k.name}</span> <span className="text-xs text-muted-foreground">{day(k.created_at)}</span></span>
              <Button size="sm" onPress={() => void revoke(k)}>{t("apiKeyRevoke")}</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <TextField label={t("apiKeyName")} value={name} onChange={setName} maxLength={100} placeholder={t("apiKeyDefaultName")} className="grow" />
        <Button kind="primary" onPress={() => void make()}>{t("apiKeyMake")}</Button>
      </div>
      {made && (
        <div role="status" className="grid gap-2 rounded-md border border-line bg-soft p-3">
          <span className="text-sm font-medium">{t("apiKeyShownOnce")}</span>
          <span className="flex items-center gap-2"><code dir="ltr" className="min-w-0 break-all text-xs">{made.key}</code><Button size="sm" icon="copy" onPress={() => copy(made.key)}>{t("aboutCopy")}</Button></span>
          {mcpOn && <>
            <span className="text-sm">{t("apiKeySetup")}</span>
            <pre dir="ltr" className="m-0 overflow-auto rounded-sm bg-surface p-2 text-xs">{setup}</pre>
            <span><Button size="sm" icon="copy" onPress={() => copy(setup)}>{t("apiKeyCopySetup")}</Button></span>
          </>}
        </div>
      )}
    </section>
  );
}
