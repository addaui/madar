import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useQueryClient } from "@tanstack/react-query";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { link } from "../../api/link";
import type { Project, Task } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { openContextMenu, type MenuItems } from "../../ui/overlays";
import { TaskCard } from "./TaskCard";

const COL_COLORS = ["var(--p-low,#5d8696)", "var(--info,#3d6f8e)", "var(--warn)", "#8b6fd1", "#d0629a"];

/** Where a card dropped on a column lands: before the card it was dropped on, else last. */
export function afterFor(siblings: Task[], id: string, over: string | null): string | null {
  const rest = siblings.filter((x) => x.id !== id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (over) { const i = rest.findIndex((x) => x.id === over); return i > 0 ? rest[i - 1]!.id : null; }
  return rest.length ? rest[rest.length - 1]!.id : null;
}

export function Board({ project, tasks, today, writer, selected, onOpen, itemsFor }: {
  project: Project; tasks: Task[]; today: string; writer: boolean; selected: string | undefined; onOpen: (id: string) => void; itemsFor: (task: Task) => MenuItems;
}) {
  const top = tasks.filter((x) => !x.parent && !x.archived);
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-x-auto pb-2 max-md:snap-x">
      {project.statuses.map((s, idx) => (
        <Column key={s.id} project={project} status={s} color={idx === project.statuses.length - 1 ? "var(--ok)" : COL_COLORS[Math.min(idx, COL_COLORS.length - 1)]!}
          items={top.filter((x) => x.status === s.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))} tasks={tasks} today={today} writer={writer} selected={selected} onOpen={onOpen} itemsFor={itemsFor} />
      ))}
    </div>
  );
}

function Column({ project, status, color, items, tasks, today, writer, selected, onOpen, itemsFor }: {
  project: Project; status: { id: string; name: string }; color: string; items: Task[]; tasks: Task[]; today: string; writer: boolean; selected: string | undefined;
  onOpen: (id: string) => void; itemsFor: (task: Task) => MenuItems;
}) {
  const t = useT();
  const qc = useQueryClient();
  const ref = useRef<HTMLElement>(null);
  const [over, setOver] = useState(false);
  const statuses = project.statuses;

  const move = (id: string, over: string | null) => startTransition(async () => {
    await link.call("tasks.move", { project: project.id, id, status: status.id, after: afterFor(items, id, over) });
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("tasks.") });
  });

  // a drop reads the latest items, so the handler is an Effect Event (React 19.2): the subscription is made once
  const dropped = useEffectEvent((id: string, overCard: string | null) => move(id, overCard));
  useEffect(() => {
    const el = ref.current;
    if (!el || !writer) return;
    return dropTargetForElements({
      element: el, getData: () => ({ status: status.id }), canDrop: ({ source }) => source.data.type === "task",
      onDragEnter: () => setOver(true), onDragLeave: () => setOver(false),
      onDrop: ({ source, location }) => {
        setOver(false);
        const card = location.current.dropTargets.find((d) => typeof d.data.card === "string")?.data.card;
        dropped(String(source.data.id), typeof card === "string" ? card : null);
      },
    });
  }, [writer, status.id]);

  const done = (task: Task) => {
    const to = task.completed_at ? statuses[0]!.id : statuses[statuses.length - 1]!.id;
    startTransition(async () => { await link.call("tasks.move", { project: project.id, id: task.id, status: to, after: null }); await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("tasks.") }); });
  };
  const add = (title: string) => startTransition(async () => {
    await link.call("tasks.create", { project: project.id, title, status: status.id } as never);
    await qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("tasks.") });
  });

  return (
    <section ref={ref} aria-label={status.name} data-status={status.id}
      className={cn("flex max-h-full w-[300px] shrink-0 flex-col rounded-lg bg-sunken p-2.5 max-md:w-[84%] max-md:snap-center", over && "outline outline-2 outline-accent")}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <span aria-hidden="true" className="size-2.5 rounded-full" ref={(el) => { if (el) el.style.background = color; }} />
        <span className="font-semibold" dir="auto">{status.name}</span>
        <span className="text-[13px] text-muted">{items.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {items.map((task) => (
          <TaskCard key={task.id} task={task} projectKey={project.key ?? null} subtasks={tasks.filter((x) => x.parent === task.id)} today={today} draggableOn={writer}
            selected={selected === task.id} onOpen={() => onOpen(task.id)} onDone={() => done(task)} onMenu={(x, y) => openContextMenu(x, y, itemsFor(task))} />
        ))}
      </div>
      {writer && (
        <form onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("title") as HTMLInputElement; const v = input.value.trim(); if (v) { add(v); input.value = ""; } }} className="pt-1">
          <input name="title" type="text" dir="auto" placeholder={"+  " + t("addPh")} aria-label={t("add") + ": " + status.name} className="field w-full" />
        </form>
      )}
    </section>
  );
}
