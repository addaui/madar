import { parseDate } from "@internationalized/date";
import { useId } from "react";
import { cn } from "../lib/cn";

const asDate = (v: string) => { try { return v ? parseDate(v).toString() : ""; } catch { return ""; } };

/**
 * A date. The browser's own date input: typed segment by segment or picked from its calendar, in the order and digits of the person's language,
 * and always reachable by keyboard and screen reader. The value is "YYYY-MM-DD", or "" for none.
 */
export function DateField({ label, value, onChange, isDisabled, name, className }: { label: string; value: string; onChange: (value: string) => void; isDisabled?: boolean; name?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cn("grid gap-1", className)}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} type="date" name={name} value={asDate(value)} disabled={isDisabled} onChange={(e) => onChange(e.target.value)}
        className="field w-full tabular-nums disabled:opacity-60 [&::-webkit-calendar-picker-indicator]:cursor-pointer" />
    </div>
  );
}
