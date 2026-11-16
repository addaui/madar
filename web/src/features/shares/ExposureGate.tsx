import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { link } from "../../api/link";
import type { Ops } from "../../api/contract";
import { useDescribe } from "../../api/session";
import { useI18n } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { Disclosure } from "../../ui/Disclosure";
import { TextField } from "../../ui/Field";

type Options = Ops["shares.options"]["output"];
const CONSOLE_SIGN_IN = "/faces/console/#auth";

/** The way to turn sign-in on: the console's Sign-in tab, when this instance has a console. */
function SetUpSignIn() {
  const { t } = useI18n();
  const plugins = (useDescribe().plugins as { id: string; state?: string }[] | undefined) ?? [];
  const hasConsole = plugins.some((p) => p.id === "@nuah/console" && p.state === "active");
  return hasConsole
    ? <Button kind="primary" onPress={() => { location.href = CONSOLE_SIGN_IN; }}>{t("exposureSetUp")}</Button>
    : <p className="m-0 text-[13px] text-muted">{t("exposureNoConsole")}</p>;
}

/**
 * With no sign-in, whoever can open this address is the Owner, and a shared page is served from the same address (ADR 0085). So sharing is offered
 * only after an Admin allows it; this says why, points to turning sign-in on, and lets an Admin allow it. Where sharing is allowed it keeps a short notice.
 */
export function ExposureGate({ options, children }: { options: Options; children: ReactNode }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^shares\./.test(String(q.queryKey[0])) });
  const allow = async () => {
    try {
      setError("");
      // an Admin session comes from the instance's admin password; someone already an Admin needs none
      if (!options.can_allow) await link.call("auth.sign_in", { password } as never, { headers: { "X-Nuah-Session": "cookie" } });
      await link.call("shares.acknowledge", {});
      setPassword("");
      await qc.invalidateQueries({ queryKey: ["describe"] });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : ""); }
  };
  if (options.accounts) return <>{children}</>;
  if (options.public_ok) {
    return (
      <>
        <div role="note" className="mb-3 grid gap-2 rounded-md border border-line bg-soft p-3 text-[13px]">
          <span>{t("exposureOn")}</span>
          <div className="flex flex-wrap items-center gap-2"><SetUpSignIn />{options.can_allow && <Button onPress={() => void link.call("shares.unacknowledge", {}).then(refresh)}>{t("exposureStop")}</Button>}</div>
        </div>
        {children}
      </>
    );
  }
  return (
    <div className="grid gap-3 rounded-md border border-line p-3">
      <b>{t("exposureTitle")}</b>
      <p className="m-0 text-[13px]">{t("exposureWarn")}</p>
      <SetUpSignIn />
      <Disclosure title={t("exposureAnyway")} className="text-[13px]">
        <div className="mt-2 grid gap-2">
          <p className="m-0 text-muted">{t("exposureAnywayHint")}</p>
          {!options.can_allow && <TextField label={t("exposureAdminPassword")} type="password" value={password} onChange={setPassword} />}
          <div><Button isDisabled={!options.can_allow && password.length === 0} onPress={() => void allow()}>{t("exposureAllow")}</Button></div>
        </div>
      </Disclosure>
      {error && <p role="alert" className="m-0 text-danger">{error}</p>}
    </div>
  );
}
