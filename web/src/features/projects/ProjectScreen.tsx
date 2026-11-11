import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect, useEffectEvent } from "react";
import { link } from "../../api/link";
import { useRead } from "../../api/hooks";
import { useDescribe } from "../../api/session";
import type { Task } from "../../api/types";
import { useI18n } from "../../i18n/i18n";
import { Stage, Topbar } from "../../app/Stage";
import { cn } from "../../lib/cn";
import { Button, IconButton } from "../../ui/Button";
import { Icon } from "../../ui/Icon";
import { askConfirm, askText, openContextMenu, type MenuItems } from "../../ui/overlays";
import type { ProjectSearch } from "../../app/router";
import { Board } from "./Board";
import { ListTab } from "./ListTab";
import { Overview } from "./Overview";
import { TaskDrawer } from "./TaskDrawer";
import { KnowledgeTab } from "./KnowledgeTab";
import { lazy, Suspense, useState } from "react";
import type { ProjectDialog } from "./ProjectDialogs";

const Dialogs = lazy(() => import("./ProjectDialogs"));

type Tab = NonNullable<ProjectSearch["tab"]>;

export function ProjectScreen({ projectId, search }: { projectId: string; search: ProjectSearch }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const describe = useDescribe();
  const project = useRead("projects.get", { project: projectId }).data;
  const members = useRead("projects.members", { project: projectId }).data.members;
  const tasks = useRead("tasks.list", { project: projectId, limit: 500 }).data.tasks;
  const labels = useRead("tasks.labels.list", { project: projectId }).data.labels;
  const today = useRead("tasks.focus").data.today;
  const can = (p: string) => (project.can ?? []).includes(p);
  const writer = can("projects.write"), manager = can("projects.manage");
  const tabs: Tab[] = ["board", "list", "overview", ...(describe.operations["knowledge.list"] ? (["knowledge"] as const) : [])];
  const tab: Tab = search.tab && tabs.includes(search.tab) ? search.tab : "board";
  const open = tasks.find((x) => x.id === search.task);
  const [dialog, setDialog] = useState<ProjectDialog | null>(null);

  const go = (next: ProjectSearch) => void navigate({ to: "/p/$projectId", params: { projectId }, search: next });
  const refresh = () => qc.invalidateQueries({ predicate: (q) => /^(tasks|projects|workspaces)\./.test(String(q.queryKey[0])) });

  // Escape closes the task beside the board
  const closeTask = useEffectEvent(() => go({ ...search, task: undefined }));
  useEffect(() => {
    if (!search.task) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[data-overlay-container] [role=dialog], [role=menu]")) closeTask(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [search.task]);

  const itemsFor = (task: Task): MenuItems => {
    const st = project.statuses;
    return [
      { label: t("open"), icon: "task", onclick: () => go({ ...search, tab: "board", task: task.id }) },
      writer && !task.parent ? { label: t(task.completed_at ? "reopen" : "markDone"), icon: "check", onclick: () => startTransition(async () => { await link.call("tasks.move", { project: projectId, id: task.id, status: task.completed_at ? st[0]!.id : st[st.length - 1]!.id, after: null }); await refresh(); }) } : null,
      writer ? { label: t("moveTo"), icon: "move", sub: () => st.map((c) => ({ label: c.name, icon: "move", checked: c.id === task.status, onclick: () => c.id !== task.status && startTransition(async () => { await link.call("tasks.move", { project: projectId, id: task.id, status: c.id, after: null }); await refresh(); }) })) } : null,
      writer ? "-" : null,
      writer ? { label: t("delete"), icon: "trash", danger: true, onclick: async () => { if (await askConfirm(t("sure"))) { await link.call("tasks.remove", { project: projectId, id: task.id }); await refresh(); } } } : null,
    ];
  };

  const rename = async () => { const n = await askText(t("rename"), project.name); if (n) { await link.call("projects.update", { project: projectId, name: n, expected_rev: project.rev }); await refresh(); } };
  const changeKey = async () => { const k = await askText(t("keyLabel"), project.key ?? ""); if (k) { await link.call("projects.update", { project: projectId, key: k.toUpperCase(), expected_rev: project.rev }); await refresh(); } };
  const remove = async () => { if (await askConfirm(t("sure"))) { await link.call("projects.delete", { project: projectId }); await refresh(); void navigate({ to: "/today" }); } };
  const leave = async () => { if (await askConfirm(t("leave") + "?")) { await link.call("projects.leave", { project: projectId }); await refresh(); void navigate({ to: "/today" }); } };
  const more = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(r.left, r.bottom, [
      { label: t("archived"), icon: "archive", onclick: () => setDialog("archived") },
      manager ? { label: t("audit"), icon: "history", onclick: () => setDialog("history") } : null,
      manager ? { label: t("projectSettings"), icon: "gear", onclick: () => setDialog("settings") } : null,
      manager ? { label: t("rename"), icon: "edit", onclick: () => void rename() } : null,
      manager ? { label: t("changeKey"), icon: "tag", onclick: () => void changeKey() } : null,
      "-",
      manager ? { label: t("delete"), icon: "trash", danger: true, onclick: () => void remove() } : { label: t("leave"), icon: "logout", danger: true, onclick: () => void leave() },
    ]);
  };

  const actions = (
    <>
      <Button kind="ghost" size="sm" icon="user" aria-label={t("members") + ` (${members.length})`} onClick={() => setDialog("members")}>{String(members.length)}</Button>
      {writer && tab !== "knowledge" && <Button kind="primary" size="sm" icon="plus" onClick={() => { go({ ...search, tab: "board" }); setTimeout(() => document.querySelector<HTMLInputElement>("section[data-status] input")?.focus(), 50); }}>{t("newTask")}</Button>}
      <IconButton icon="more" label={t("more")} onClick={more} />
    </>
  );

  return (
    <Stage
      topbar={<Topbar crumbs={<><Link to="/today" className="rounded-sm px-1.5 py-1 hover:bg-hover">{t("projects")}</Link><span aria-hidden="true">›</span><span aria-current="page" className="px-1.5 font-semibold text-text" dir="auto">{project.name}</span>{project.key && <span dir="ltr" className="ms-1 rounded-chip border border-line px-1.5 text-xs">{project.key}</span>}</>} actions={actions} />}
      pane={open && tab !== "knowledge" ? <TaskDrawer key={open.id} project={project} task={open} members={members} labels={labels} subtasks={tasks.filter((x) => x.parent === open.id)} writer={writer} onClose={() => go({ ...search, task: undefined })} /> : undefined}
      paneWidth={440}
    >
      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {tabs.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={x === tab} onClick={() => go({ tab: x })}
            className={cn("inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-muted", x === tab && "border-accent font-semibold text-text")}>
            <Icon name={x === "board" ? "board" : x === "list" ? "list" : x === "overview" ? "chart" : "book"} className="size-4" />{t(x)}
          </button>
        ))}
      </div>
      {tab === "board" && <Board project={project} tasks={tasks} today={today} writer={writer} selected={search.task} onOpen={(id) => go({ ...search, task: id })} itemsFor={itemsFor} />}
      {tab === "list" && <ListTab project={project} members={members} today={today} onOpen={(id) => go({ ...search, task: id })} />}
      {tab === "overview" && <Overview project={project} />}
      {tab === "knowledge" && <KnowledgeTab project={project} search={search} go={go} />}
      {dialog && <Suspense fallback={null}><Dialogs which={dialog} project={project} manager={manager} writer={writer} onClose={() => setDialog(null)} /></Suspense>}
    </Stage>
  );
}
