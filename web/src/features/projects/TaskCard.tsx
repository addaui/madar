import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef, useState } from "react";
import type { Task } from "../../api/types";
import { useT } from "../../i18n/i18n";
import { cn } from "../../lib/cn";
import { codeOf } from "../../lib/codes";
import { DueChip, PriorityChip } from "../tasks/TaskRow";
import { Icon } from "../../ui/Icon";

/** A card on the board. Draggable by pointer and (through the menu) by keyboard; `onOpen` shows the task beside the board. */
export function TaskCard({ task, projectKey, subtasks, today, draggableOn, selected, onOpen, onMenu, onDone }: {
  task: Task; projectKey: string | null; subtasks: Task[]; today: string; draggableOn: boolean; selected: boolean;
  onOpen: () => void; onMenu: (x: number, y: number) => void; onDone: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const done = !!task.completed_at;
  const subDone = subtasks.filter((s) => s.completed_at).length;
  const code = codeOf(projectKey, task.number);

  useEffect(() => {
    const el = ref.current;
    if (!el || !draggableOn) return;
    return combine(
      draggable({ element: el, getInitialData: () => ({ type: "task", id: task.id }), onDragStart: () => setDragging(true), onDrop: () => setDragging(false) }),
      // a card is also a place to drop: the dropped card goes before it
      dropTargetForElements({ element: el, getData: () => ({ card: task.id }), canDrop: ({ source }) => source.data.id !== task.id }),
    );
  }, [draggableOn, task.id]);

  return (
    <div ref={ref} data-task={task.id} role="button" tabIndex={0} aria-current={selected ? "true" : undefined}
      onClick={onOpen} onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className={cn("mb-2 cursor-pointer rounded-md border border-line bg-surface p-2.5 shadow-1 transition-shadow hover:shadow-2", done && "opacity-60", dragging && "opacity-40", selected && "border-accent")}>
      <div className="flex items-start gap-2">
        <button type="button" aria-label={done ? t("reopen") : t("markDone")} onClick={(e) => { e.stopPropagation(); onDone(); }}
          className={cn("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border", done ? "border-ok bg-ok text-white" : "border-line-strong")}>{done && <Icon name="check" className="size-3" />}</button>
        <span className={cn("min-w-0 grow break-words", done && "line-through")} dir="auto">{task.title}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 ps-[26px]">
        {code && <span dir="ltr" className="rounded-chip border border-line px-1.5 text-[11px] text-muted">{code}</span>}
        <PriorityChip band={task.band} />
        <DueChip due={task.due} today={today} done={done} />
        {subtasks.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted"><Icon name="subtask" className="size-3" />{subDone}/{subtasks.length}</span>}
      </div>
    </div>
  );
}
