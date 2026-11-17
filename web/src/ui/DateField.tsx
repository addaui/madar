import { CalendarDate, getWeeksInMonth, parseDate, startOfMonth, startOfWeek, today, getLocalTimeZone } from "@internationalized/date";
import { createContext, use, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { BaseButton, Button, IconButton } from "./Button";
import { Icon } from "./Icon";
import { PopupButton } from "./Popup";

/** The calendar the person chose (Gregorian, Hijri or both), for every date field under it. */
const CalendarContext = createContext<string>("gregory");
export function CalendarProvider({ calendar, children }: { calendar: string; children: ReactNode }) { return <CalendarContext value={calendar}>{children}</CalendarContext>; }

const asDate = (v: string): CalendarDate | null => { try { return v ? parseDate(v) : null; } catch { return null; } };
const iso = (d: CalendarDate) => d.toString();

/** How a date reads: in the app's language (never the browser's), in the calendar the person chose. */
function readable(d: CalendarDate, lang: string, calendar: string, o: Intl.DateTimeFormatOptions): string {
  const js = new Date(d.year, d.month - 1, d.day);
  const fmt = (cal: string) => new Intl.DateTimeFormat(`${lang}-u-ca-${cal}`, o).format(js);
  return calendar === "both" ? `${fmt("gregory")} · ${fmt("islamic-umalqura")}` : fmt(calendar === "hijri" ? "islamic-umalqura" : "gregory");
}

/**
 * A date, picked from a month grid in the app's language and digits, the same on every browser and system (a browser's own date input follows the
 * browser's language, not the app's). The value is "YYYY-MM-DD", or "" for none. Arrow keys move by day and week, Page Up and Down by month.
 */
export function DateField({ label, value, onChange, isDisabled, name, className }: {
  label: string; value: string; onChange: (value: string) => void; isDisabled?: boolean; name?: string; className?: string;
}) {
  const { lang, t } = useI18n();
  const calendar = use(CalendarContext);
  const current = asDate(value);
  return (
    <div className={cn("grid gap-1", className)}>
      {name && <input type="hidden" name={name} value={current ? iso(current) : ""} />}
      <PopupButton label={label} width={300} buttonProps={{ isDisabled, className: "field flex w-full items-center justify-between gap-2 text-start tabular-nums disabled:opacity-60" }}
        trigger={<><span className={cn("truncate", !current && "text-muted-foreground")} dir="auto">{current ? readable(current, lang, calendar, { dateStyle: "medium" }) : t("noDate")}</span><Icon name="calendar" className="size-4 shrink-0 text-muted-foreground" /></>}>
        {(close) => <Month selected={current} lang={lang} calendar={calendar} onPick={(d) => { onChange(d ? iso(d) : ""); close(); }} />}
      </PopupButton>
    </div>
  );
}

function Month({ selected, lang, calendar, onPick }: { selected: CalendarDate | null; lang: string; calendar: string; onPick: (d: CalendarDate | null) => void }) {
  const { t } = useI18n();
  const now = today(getLocalTimeZone());
  const [cursor, setCursor] = useState(startOfMonth(selected ?? now));
  const grid = useRef<HTMLDivElement>(null);
  const id = useId();
  const num = new Intl.NumberFormat(lang, { useGrouping: false });
  const first = startOfWeek(cursor, lang);
  const weeks = getWeeksInMonth(cursor, lang);
  const days = Array.from({ length: weeks * 7 }, (_, i) => first.add({ days: i }));
  const move = (to: CalendarDate) => {
    if (to.month !== cursor.month || to.year !== cursor.year) setCursor(startOfMonth(to));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLElement>(`[data-iso="${iso(to)}"]`)?.focus());
  };
  const key = (e: React.KeyboardEvent, d: CalendarDate) => {
    const by: Record<string, { days?: number; months?: number }> = { ArrowLeft: { days: lang === "ar" ? 1 : -1 }, ArrowRight: { days: lang === "ar" ? -1 : 1 }, ArrowUp: { days: -7 }, ArrowDown: { days: 7 }, PageUp: { months: -1 }, PageDown: { months: 1 } };
    const step = by[e.key];
    if (step) { e.preventDefault(); move(d.add(step)); }
  };
  // one day is in the tab order (the chosen one, else today, else the first of the month); the arrow keys move from it
  const inGrid = (x: CalendarDate | null) => (x && days.some((y) => iso(y) === iso(x)) && x.month === cursor.month ? iso(x) : null);
  const tabStop = inGrid(selected) ?? inGrid(now) ?? iso(cursor);
  const title = readable(cursor, lang, calendar === "both" ? "gregory" : calendar, { month: "long", year: "numeric" });
  const weekdays = days.slice(0, 7).map((d) => readable(d, lang, "gregory", { weekday: "short" }));
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <IconButton icon="chevron" label={t("prevMonth")} className="rotate-180 rtl:rotate-0" onPress={() => setCursor(cursor.subtract({ months: 1 }))} />
        <b id={id} aria-live="polite" className="text-[14px]">{title}</b>
        <IconButton icon="chevron" label={t("nextMonth")} className="rtl:rotate-180" onPress={() => setCursor(cursor.add({ months: 1 }))} />
      </div>
      <div ref={grid} role="group" aria-labelledby={id} className="grid grid-cols-7 gap-0.5 text-center text-[13px]">
        {weekdays.map((w, i) => <span key={i} aria-hidden="true" className="py-1 text-xs text-muted-foreground">{w}</span>)}
        {days.map((d) => {
          const inMonth = d.month === cursor.month, on = !!selected && iso(d) === iso(selected), isToday = iso(d) === iso(now);
          return (
            <BaseButton key={iso(d)} data-iso={iso(d)} aria-pressed={on} aria-current={isToday ? "date" : undefined} aria-label={readable(d, lang, calendar, { dateStyle: "full" })}
              excludeFromTabOrder={iso(d) !== tabStop} onKeyDown={(e) => key(e, d)} onPress={() => onPick(d)}
              className={cn("grid size-9 place-items-center rounded-sm tabular-nums hoverable", !inMonth && "text-muted-foreground opacity-50", isToday && !on && "border border-line", on && "bg-brand font-semibold text-brand-foreground hover:bg-brand")}>
              {num.format(d.day)}
            </BaseButton>
          );
        })}
      </div>
      <div className="flex justify-between">
        <Button kind="ghost" size="sm" onPress={() => onPick(now)}>{t("today")}</Button>
        <Button kind="ghost" size="sm" onPress={() => onPick(null)}>{t("clear")}</Button>
      </div>
    </div>
  );
}
