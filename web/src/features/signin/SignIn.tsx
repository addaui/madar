import { useQueryClient } from "@tanstack/react-query";
import { NuahError } from "@nuah/link-client";
import { useActionState } from "react";
import { link } from "../../api/link";
import { useT } from "../../i18n/i18n";
import { Button } from "../../ui/Button";
import { Icon } from "../../ui/Icon";

/** The sign-in form: a React 19 Action. The session goes into an HttpOnly cookie (`X-Nuah-Session: cookie`). */
export function SignIn() {
  const t = useT();
  const client = useQueryClient();
  const [error, submit, pending] = useActionState(async (_prev: string | null, form: FormData): Promise<string | null> => {
    try {
      await link.call("auth.sign_in", { name: String(form.get("name") ?? ""), password: String(form.get("password") ?? "") }, { headers: { "X-Nuah-Session": "cookie" } });
      await client.invalidateQueries({ queryKey: ["describe"] });
      return null;
    } catch (e) {
      return e instanceof NuahError ? e.message : t("offline");
    }
  }, null);

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form action={submit} className="grid w-[min(400px,100%)] gap-3.5 rounded-lg bg-surface p-8 shadow-2">
        <div className="flex items-center gap-2.5 text-[17px] font-bold"><Icon name="logo" className="size-[26px] text-accent" />Madar</div>
        <p className="m-0 text-muted">{t("signInHint")}</p>
        <input name="name" type="text" required autoComplete="username" placeholder={t("name")} aria-label={t("name")} dir="auto" className="field" />
        <input name="password" type="password" required autoComplete="current-password" placeholder={t("password")} aria-label={t("password")} className="field" />
        <p role="alert" className="m-0 min-h-[1.2em] text-danger">{error}</p>
        <Button kind="primary" type="submit" disabled={pending} className="justify-center">{t("signIn")}</Button>
      </form>
    </div>
  );
}
