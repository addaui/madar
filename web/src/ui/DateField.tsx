import { parseDate } from "@internationalized/date";
import { Button as AriaButton, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, DateInput, DatePicker, DateSegment, Dialog, Group, Heading, Popover } from "react-aria-components";
import { cn } from "../lib/cn";
import { popup } from "./base";
import { Icon } from "./Icon";

const asDate = (v: string) => { try { return v ? parseDate(v) : null; } catch { return null; } };

/** A date, typed segment by segment or picked from a calendar. The value is "YYYY-MM-DD", or "" for none; the order and digits follow the person's language. */
export function DateField({ label, value, onChange, isDisabled, name, className }: { label: string; value: string; onChange: (value: string) => void; isDisabled?: boolean; name?: string; className?: string }) {
  return (
    <DatePicker aria-label={label} value={asDate(value)} onChange={(d) => onChange(d ? d.toString() : "")} isDisabled={isDisabled} name={name} granularity="day" className={cn("grid gap-1", className)}>
      <Group className="field flex items-center gap-1 data-[disabled]:opacity-60">
        <DateInput className="flex grow items-center gap-0.5">
          {(segment) => <DateSegment segment={segment} className="rounded-sm px-0.5 tabular-nums outline-none data-[placeholder]:text-muted-foreground data-[focused]:bg-brand data-[focused]:text-brand-foreground" />}
        </DateInput>
        <AriaButton aria-label={label} className="grid size-6 place-items-center rounded-sm text-muted-foreground outline-none hoverable hover:text-text data-[disabled]:opacity-45"><Icon name="calendar" className="size-4" /></AriaButton>
      </Group>
      <Popover className={cn(popup, "p-3")} placement="bottom start" offset={4}>
        <Dialog className="outline-none">
          <Calendar className="grid gap-2">
            <header className="flex items-center justify-between gap-2">
              <AriaButton slot="previous" aria-label="‹" className="grid size-8 place-items-center rounded-sm outline-none hoverable"><Icon name="chevron" className="size-4 rotate-180 rtl:rotate-0" /></AriaButton>
              <Heading className="m-0 text-[14px] font-semibold" />
              <AriaButton slot="next" aria-label="›" className="grid size-8 place-items-center rounded-sm outline-none hoverable"><Icon name="chevron" className="size-4 rtl:rotate-180" /></AriaButton>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              <CalendarGridHeader>{(day) => <CalendarHeaderCell className="size-8 text-center text-[12px] font-medium text-muted-foreground">{day}</CalendarHeaderCell>}</CalendarGridHeader>
              <CalendarGridBody>
                {(date) => <CalendarCell date={date} className="grid size-8 cursor-pointer place-items-center rounded-sm text-[13px] tabular-nums outline-none hoverable data-[outside-month]:text-muted-foreground data-[outside-month]:opacity-50 data-[selected]:bg-brand data-[selected]:text-brand-foreground data-[today]:font-bold data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand data-[disabled]:opacity-30" />}
              </CalendarGridBody>
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </DatePicker>
  );
}
