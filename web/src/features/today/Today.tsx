import { useQueryClient } from "@tanstack/react-query";
import { startTransition } from "react";
import { useCommand, useRead } from "../../api/hooks";
import { useDescribe } from "../../api/session";
import { useT, type Key } from "../../i18n/i18n";
import { todayLocal, useDateFormat } from "../../lib/format";
import { cn } from "../../lib/cn";
import { usePersistedValue, spaceState } from "../../app/ui-state";
import { Disclosure } from "../../ui/Disclosure";
import { PageGlyph } from "../../ui/PageGlyph";
import { Checkbox } from "../../ui/Check";
import { TextLink } from "../../ui/Link";
import { Icon } from "../../ui/Icon";
import { TaskRow } from "../tasks/TaskRow";
import type { MyTask } from "../../api/types";

const Panel = ({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) => (
  <section className={cn("mb-4 panel p-3", className)}><h2 className="m-0 mb-1.5 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>{children}</section>
);

export function Today() {
  const t = useT();
  const f = useDateFormat();
  const who = useDescribe().who!;
  const mine = useRead("tasks.my").data;
  const focus = useRead("tasks.focus").data;
  const space = usePersistedValue(spaceState);
  const pageTasks = useRead("pages.tasks", { space, limit: 40 }).data.items;
  const hour = new Date().getHours();
  const greeting = t(hour < 12 ? "gMorning" : hour < 18 ? "gAfternoon" : "gEvening");
  const count = (k: string) => mine.tasks.filter((x) => x.bucket === k).length;
  const groups: [string, string][] = [["overdue", t("overdue")], ["today", t("todayB")], ["upcoming", t("soon")], ["undated", t("undated")]];
  const any = mine.tasks.length > 0;

  return (
    <div className="mx-auto max-w-[900px] px-1">
      <h1 className="m-0 text-[28px] font-bold" dir="auto">{greeting}, {who.display || who.subject}</h1>
      <p className="mt-1 text-muted-foreground">{f.date(mine.today)}</p>
      {any && (
        <div className="my-4 grid grid-cols-4 gap-2.5">
          {[["open", String(mine.tasks.length), t("openN")], ["overdue", String(count("overdue")), t("overdue")], ["today", String(count("today")), t("todayB")], ["soon", String(count("upcoming")), t("soon")]].map(([k, n, label]) => (
            <div key={k} className={cn("panel p-3", k === "overdue" && n !== "0" && "border-danger text-danger")}><b className="block text-2xl">{n}</b><span className="text-[13px] text-muted-foreground">{label}</span></div>
          ))}
        </div>
      )}
      {!any && pageTasks.length === 0 && (
        <div className="grid place-items-center gap-1 py-16 text-center text-muted-foreground"><Icon name="sparkle" className="size-7" /><b>{t("nothingOpen")}</b><span>{t("nothingOpenHint")}</span></div>
      )}
      {focus.start.length > 0 && <Panel title={t("startHere")}>{focus.start.map((x) => <TaskRow key={x.id} task={x} today={mine.today} />)}</Panel>}
      {focus.also.length > 0 && <Panel title={t("alsoOpen")}>{focus.also.map((x) => <TaskRow key={x.id} task={x} today={mine.today} />)}</Panel>}
      {pageTasks.length > 0 && <Panel title={t("fromPages")}>{pageTasks.map((x) => <PageTaskRow key={x.page + x.block} item={x} />)}</Panel>}
      {any && (
        <Disclosure title={t("assignedAll")} className="mb-4 panel p-3">
                  {groups.map(([k, label]) => {
            const items = mine.tasks.filter((x) => x.bucket === k);
            return items.length ? <div key={k}><div className="px-1 pb-1 pt-3 text-xs font-semibold uppercase text-muted-foreground">{label}</div>{items.map((x: MyTask) => <TaskRow key={x.id} task={x} today={mine.today} />)}</div> : null;
          })}
        </Disclosure>
      )}
    </div>
  );
}

/** A checklist item written on a page, shown here where it can be ticked; the page is one click away. */
function PageTaskRow({ item }: { item: { page: string; title?: string; icon?: string | null; block: string; text: string; due?: string | null; priority?: string | null; notes?: string | null; project?: string | null; project_name?: string | null } }) {
  const t = useT();
  const qc = useQueryClient();
  const personal = useCommand("pages.set_task", ["pages.tasks"]);
  const knowledge = useCommand("knowledge.set_task", ["pages.tasks"]);
  const tick = (checked: boolean) => startTransition(async () => {
    if (item.project) await knowledge.run({ project: item.project, id: item.page, block: item.block, checked });
    else await personal.run({ id: item.page, block: item.block, checked });
    await qc.invalidateQueries({ queryKey: ["pages.tasks"] });
  });
  return (
    <div className="flex min-h-[42px] items-center gap-2.5 rounded-md px-2.5 py-1.5 hoverable">
      <Checkbox isDisabled={!item.block} aria-label={item.block ? item.text : item.text + " — " + t("saveToTick")} onChange={tick} />
      <span className="grid min-w-0 grow"><span className="truncate" dir="auto">{item.text}</span>{item.notes && <span className="truncate text-xs text-muted-foreground" dir="auto">{item.notes}</span>}</span>
      {item.priority && <span className={cn("rounded-chip border border-line px-2 py-0.5 text-xs", item.priority === "high" && "text-danger")}>{t(("pri_" + item.priority) as Key)}</span>}
      {item.due && <span className={cn("rounded-chip border border-line px-2 py-0.5 text-xs", item.due < todayLocal() && "text-danger")}>{item.due}</span>}
      <TextLink href={item.project ? `#/p/${item.project}?tab=knowledge&page=${item.page}` : `#/pages/${item.page}`}
        className="inline-flex items-center gap-1 rounded-chip border border-line px-2 py-0.5 text-xs"><PageGlyph icon={item.icon} className="size-3.5 text-muted-foreground" /><span dir="auto">{item.title || t("untitled")}</span></TextLink>
      {item.project_name && <span className="rounded-chip border border-line px-2 py-0.5 text-xs" dir="auto">{item.project_name}</span>}
    </div>
  );
}
