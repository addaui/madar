import { Link } from "@tanstack/react-router";
import type { MyTask } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { useDateFormat } from "../../lib/format";
import { Icon } from "../../ui/Icon";

const BAND: Record<string, string> = { urgent: "text-danger", high: "text-[var(--p-high,var(--warn))]", medium: "text-warn", low: "text-muted" };

export function PriorityChip({ band }: { band: string | undefined }) {
  const t = useT();
  if (!band || band === "none") return null;
  return <span className={cn("rounded-chip border border-line px-2 py-0.5 text-xs font-semibold", BAND[band])}>{t(band as "low")}</span>;
}

export function DueChip({ due, today, done }: { due: string | null | undefined; today: string; done: boolean }) {
  const f = useDateFormat();
  if (!due) return null;
  const late = due < today && !done;
  return <span className={cn("inline-flex items-center gap-1 rounded-chip border border-line px-2 py-0.5 text-xs", late && "border-danger text-danger")}><Icon name="calendar" className="size-3" />{f.short(due)}</span>;
}

/** A task in a list: its title, priority, project and due date; it opens the task in its project. */
export function TaskRow({ task, today }: { task: MyTask; today: string }) {
  return (
    <Link to="/p/$projectId" params={{ projectId: task.project }} search={{ task: task.id }}
      className="flex min-h-[42px] items-center gap-2.5 rounded-md px-2.5 py-1.5 hoverable">
      <Icon name="task" className="text-muted" />
      <span className="min-w-0 grow truncate" dir="auto">{task.title}</span>
      <PriorityChip band={task.band} />
      <span className="rounded-chip border border-line px-2 py-0.5 text-xs" dir="auto">{task.project_name}</span>
      <DueChip due={task.due} today={today} done={!!task.completed_at} />
    </Link>
  );
}
