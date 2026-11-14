import { usePulseState } from "../api/session";
import { useT } from "../i18n/i18n";

/** Whether live updates are flowing: live, connecting, or offline (and retrying by itself). */
export function LiveDot() {
  const t = useT();
  const state = usePulseState();
  return (
    <>
      <span aria-hidden="true" className={state === "live" ? "size-2 shrink-0 rounded-full bg-ok" : "size-2 shrink-0 rounded-full bg-warn"} />
      <span className="truncate">{state === "live" ? t("live") : state === "connecting" ? t("connecting") : t("offline")}</span>
    </>
  );
}
