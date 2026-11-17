import { useRead } from "../../api/hooks";
import type { Project } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { cn } from "../../lib/cn";

const BAND_COLORS: Record<string, string> = { urgent: "var(--danger)", high: "var(--p-high,#d4691a)", medium: "var(--warn)", low: "var(--p-low,#5d8696)" };

/** Counts, bars by column and priority, and completions over the last 30 days. */
export function Overview({ project }: { project: Project }) {
  const t = useT();
  const s = useRead("tasks.stats", { project: project.id, days: 30 }).data;
  const max = (o: Record<string, number | undefined>) => Math.max(1, ...Object.values(o).map((v) => v ?? 0));
  const days = s.completed_per_day;
  const peak = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="mx-auto grid max-w-[900px] gap-4">
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
        {([["total", s.total], ["openN", s.open], ["doneN", s.done], ["overdueN", s.overdue]] as const).map(([k, n]) => (
          <div key={k} className={cn("panel p-3", k === "overdueN" && n > 0 && "border-danger text-danger")}><b className="block text-2xl">{n}</b><span className="text-[13px] text-muted-foreground">{t(k === "total" ? "total" : k)}</span></div>
        ))}
      </div>
      <Bars title={t("byColumn")} rows={project.statuses.map((x) => [x.name, s.by_status[x.id] ?? 0, "var(--accent)"])} max={max(s.by_status)} />
      <Bars title={t("byPriority")} rows={(["urgent", "high", "medium", "low"] as const).map((b) => [t(b), s.by_band[b] ?? 0, BAND_COLORS[b]!])} max={max(s.by_band)} />
      <section className="panel p-3">
        <h2 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{t("completions")}</h2>
        <svg viewBox={`0 0 ${Math.max(1, days.length) * 12} 60`} role="img" aria-label={t("completions")} className="h-16 w-full">
          {days.map((d, i) => <rect key={d.date} x={i * 12 + 1} y={60 - (d.n / peak) * 56} width={9} height={(d.n / peak) * 56} rx={2} fill="var(--accent)"><title>{d.date}: {d.n}</title></rect>)}
        </svg>
      </section>
    </div>
  );
}

function Bars({ title, rows, max }: { title: string; rows: (string | number)[][]; max: number }) {
  return (
    <section className="panel p-3">
      <h2 className="m-0 mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      <div className="grid gap-1.5">
        {rows.map(([label, n, color]) => (
          <div key={String(label)} className="grid grid-cols-[120px_1fr_32px] items-center gap-2.5 text-[13px]">
            <span className="truncate" dir="auto">{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-sunken"><span className="block h-full rounded-full" ref={(el) => { if (el) { el.style.width = (Number(n) / max) * 100 + "%"; el.style.background = String(color); } }} /></span>
            <span className="text-end text-muted-foreground">{n}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
