import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { BaseButton } from "./Button";
import { Tooltip } from "./Tooltip";
import { toast } from "./overlays";

/** Copies text and says so. Where copying is not allowed the text itself is shown, so it can be copied by hand. */
export async function copyText(text: string, copied: string) {
  try { await navigator.clipboard.writeText(text); toast(copied + ": " + text); } catch { toast(text); }
}

/** A readable id (`MDR-12`) as a small button that copies it. */
export function CopyCode({ code, className }: { code: string; className?: string }) {
  const t = useT();
  return (
    <Tooltip label={t("copyId")}>
      <BaseButton aria-label={t("copyId") + ": " + code} onPress={() => void copyText(code, t("copied"))}
        className={cn("hit rounded-chip border border-line px-1.5 text-[11px] text-muted hoverable hover:text-text", className)}><span dir="ltr" translate="no">{code}</span></BaseButton>
    </Tooltip>
  );
}
