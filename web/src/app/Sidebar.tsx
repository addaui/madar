import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { lazy, Suspense } from "react";
import { link } from "../api/link";
import { useRead } from "../api/hooks";
import { useDescribe } from "../api/session";
import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { Avatar } from "../ui/Avatar";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Explorer } from "../features/pages/Explorer";
import { ownScope } from "../features/pages/scope";
import { openDialog } from "./dialogs";
import { LiveDot } from "./LiveDot";
import { drawerState, sideState, sideTabState, spaceState, useDrawer, useIsNarrow, usePersistedValue } from "./ui-state";

const BellMenu = lazy(() => import("./SidebarMenus").then((m) => ({ default: m.BellMenu })));
const SpacesMenu = lazy(() => import("./SidebarMenus").then((m) => ({ default: m.SpacesMenu })));

/** How long the pointer rests on the minimized sidebar before it opens over the page. */
const PEEK_MS = 800;

export function Sidebar() {
  const t = useT();
  const side = usePersistedValue(sideState);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const narrow = useIsNarrow(), drawer = useDrawer();
  const rail = !narrow && side === "closed" && !peek;
  // the list follows where you are: pages show your pages, a project shows the projects
  const path = useRouterState({ select: (r) => r.location.pathname });
  useEffect(() => { if (path.startsWith("/pages")) sideTabState.set("pages"); else if (path.startsWith("/p/")) sideTabState.set("tasks"); drawerState.set(false); }, [path]);
  const closed = side === "closed" && !narrow;

  return (
    <aside
      data-side={side} data-peek={peek} data-rail={rail} data-drawer={drawer}
      onPointerEnter={(e) => { if (closed && e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(() => setPeek(true), PEEK_MS); } }}
      onPointerLeave={() => { clearTimeout(timer.current); setPeek(false); }}
      className={cn(
        "group/side relative z-40 flex h-full min-h-0 flex-col overflow-hidden transition-[inline-size,box-shadow] duration-200 ease-out",
        "panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass-side,var(--surface))] panels:shadow-1",
        "max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:z-50 max-md:hidden max-md:w-[min(86vw,320px)] max-md:rounded-e-lg max-md:bg-surface max-md:shadow-2 max-md:data-[drawer=true]:flex",
        "w-[var(--side)] data-[side=closed]:w-[var(--rail)] data-[peek=true]:w-[272px] data-[peek=true]:rounded-lg data-[peek=true]:bg-surface data-[peek=true]:shadow-2",
      )}
    >
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4 group-data-[rail=true]/side:flex-col group-data-[rail=true]/side:px-2">
        <div className="flex items-center gap-[9px] text-[17px] font-bold tracking-tight">
          <Icon name="logo" className="size-[26px] text-accent" />
          <span className="group-data-[rail=true]/side:hidden">Madar</span>
        </div>
        <span className="grow group-data-[rail=true]/side:hidden" />
        <Suspense fallback={<span className="size-[34px]" />}><BellMenu /></Suspense>
      </div>
      <Suspense fallback={<span className="mx-3 mb-1 mt-0.5 block h-[38px]" />}><SpacesMenu /></Suspense>
      <SearchPill />
      <nav aria-label={t("today")} className="px-2.5 pb-1">
        <NavLink to="/today" icon="today" label={t("today")} />
      </nav>
      <SideTabs />
      <div role="tabpanel" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2.5 pb-2.5 group-data-[rail=true]/side:hidden">
        <SideList />
      </div>
      <Foot />
    </aside>
  );
}

function NavLink({ to, icon, label, params }: { to: string; icon: string; label: string; params?: Record<string, string> }) {
  return (
    <Link to={to} params={params} title={label}
      className="flex min-h-[38px] w-full items-center gap-2.5 rounded-[12px] px-3 text-text hover:bg-hover aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:shadow-[0_1px_2px_rgba(0,0,0,.08)] group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0">
      <Icon name={icon} className="text-muted" />
      <span className="min-w-0 flex-1 truncate group-data-[rail=true]/side:hidden" dir="auto">{label}</span>
    </Link>
  );
}

function SearchPill() {
  const t = useT();
  if (!useDescribe().operations["search.query"]) return null;
  return (
    <button type="button" onClick={() => openDialog("search")}
      className="mx-3 mb-2.5 mt-1.5 flex min-h-[38px] items-center gap-[9px] rounded-btn border border-line-strong bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-3 text-muted hover:bg-hover group-data-[rail=true]/side:mx-2 group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0">
      <Icon name="search" />
      <span className="group-data-[rail=true]/side:hidden">{t("search").replace("…", "")}</span>
      <kbd dir="ltr" className="ms-auto rounded border border-line px-1.5 text-xs group-data-[rail=true]/side:hidden">/</kbd>
    </button>
  );
}

function SideTabs() {
  const t = useT();
  const tab = usePersistedValue(sideTabState);
  const pages = !!useDescribe().operations["pages.list"];
  const item = (key: "tasks" | "pages", label: string, icon: string) => (
    <button type="button" role="tab" aria-selected={tab === key} onClick={() => sideTabState.set(key)}
      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2 py-1.5 text-[13px] text-muted hover:text-text aria-selected:bg-surface aria-selected:font-semibold aria-selected:text-text aria-selected:shadow-1">
      <Icon name={icon} className="size-[15px]" /><span>{label}</span>
    </button>
  );
  return (
    <div role="tablist" className="mx-3 mb-1 mt-1.5 flex gap-0.5 rounded-[11px] bg-sunken p-[3px] group-data-[rail=true]/side:hidden">
      {item("tasks", t("tasksTab"), "task")}
      {pages && item("pages", t("pages"), "pages")}
    </div>
  );
}

function SideList() {
  const tab = usePersistedValue(sideTabState);
  return tab === "pages" ? <PagesList /> : <ProjectsList />;
}

function ProjectsList() {
  const t = useT();
  const projects = useRead("projects.list").data.projects;
  const ws = useRead("workspaces.list").data;
  const space = usePersistedValue(spaceState);
  const place = new Map(ws.placements.map((p) => [p.project, p.workspace]));
  const mine = projects.filter((p) => (place.get(p.id) ?? "default") === (ws.workspaces.some((w) => w.id === space) ? space : "default"));
  return (
    <>
      <div className="mt-1.5 flex items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-muted"><span className="grow">{t("projects")}</span></div>
      {mine.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted">{t("noProjectsHere")}</p>}
      {mine.map((p) => <NavLink key={p.id} to="/p/$projectId" params={{ projectId: p.id }} icon="board" label={p.name} />)}
    </>
  );
}

function PagesList() {
  const navigate = useNavigate();
  const space = usePersistedValue(spaceState);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as { parent?: string } });
  const current = path.startsWith("/pages/") ? decodeURIComponent(path.slice(7)) : null;
  return <Explorer scope={ownScope(space)} nav={{ current, draft: current === "new", draftParent: search.parent,
    open: (id) => void navigate({ to: "/pages/$pageId", params: { pageId: id } }),
    newPage: (parent) => void navigate({ to: "/pages/$pageId", params: { pageId: "new" }, search: parent ? { parent } : {} }),
    closed: () => void navigate({ to: "/pages" }) }} />;
}

function Foot() {
  const t = useT();
  const d = useDescribe();
  const qc = useQueryClient();
  const who = d.who;
  if (!who) return null;
  // the session is the cookie; the generated input names a token, which only bearer use needs
  const signOut = async () => { await link.call("auth.sign_out", {} as never); await qc.invalidateQueries(); };
  return (
    <div className="flex items-center gap-2.5 p-2.5 group-data-[rail=true]/side:flex-col group-data-[rail=true]/side:px-2">
      <div className="flex min-w-0 flex-1 items-center gap-[9px] group-data-[rail=true]/side:flex-none">
        <Avatar subject={who.subject} name={who.display} mine />
        <div className="min-w-0 leading-tight group-data-[rail=true]/side:hidden">
          <b className="block truncate font-semibold" dir="auto">{who.display}</b>
          <small className="flex items-center gap-1.5 text-muted"><LiveDot /></small>
        </div>
      </div>
      <IconButton icon="help" label={t("kHelp") + " (?)"} className="group-data-[rail=true]/side:hidden" onClick={() => openDialog("shortcuts")} />
      <IconButton icon="gear" label={t("settings")} onClick={() => openDialog("settings")} />
      <IconButton icon="logout" label={t("signOut")} className="group-data-[rail=true]/side:hidden" onClick={signOut} />
    </div>
  );
}
