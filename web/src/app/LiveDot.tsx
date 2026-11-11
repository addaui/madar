import { useEffect, useState } from "react";
import { useT } from "../i18n/i18n";
import type { PulseState } from "@nuah/link-client";

/** Whether live updates are flowing. */
export function LiveDot() {
  const t = useT();
  const [state, setState] = useState<PulseState>("connecting");
  useEffect(() => {
    const on = (e: Event) => setState((e as CustomEvent<PulseState>).detail);
    window.addEventListener("madar:live", on);
    return () => window.removeEventListener("madar:live", on);
  }, []);
  const live = state === "live";
  return (
    <>
      <span aria-hidden="true" className={live ? "size-2 rounded-full bg-ok" : "size-2 rounded-full bg-warn"} />
      <span>{live ? t("live") : t("offline")}</span>
    </>
  );
}
