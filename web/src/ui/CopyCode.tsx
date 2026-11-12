import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { toast } from "./overlays";

/** Copies text and says so. Where copying is not allowed the text itself is shown, so it can be copied by hand. */
export async function copyText(text: string, copied: string) {
  try { await navigator.clipboard.writeText(text); toast(copied + ": " + text); } catch { toast(text); }
}

/** A readable id (`MDR-12`) as a small button that copies it. */
export function CopyCode({ code, className }: { code: string; className?: string }) {
  const t = useT();
  return (
    <button type="button" dir="ltr" translate="no" title={t("copyId")} aria-label={t("copyId") + ": " + code} onClick={(e) => { e.stopPropagation(); void copyText(code, t("copied")); }}
      className={cn("rounded-chip border border-line px-1.5 text-[11px] text-muted hoverable hover:text-text", className)}>{code}</button>
  );
}
