import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { lazy, Suspense } from "react";
import { link } from "../api/link";
import { useRead } from "../api/hooks";
import { useDescribe, useHasOp } from "../api/session";
import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { Avatar } from "../ui/Avatar";
import { BaseButton, IconButton } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { TextLink } from "../ui/Link";
import { askText, openContextMenu, type MenuItems } from "../ui/overlays";
import { copyText } from "../ui/CopyCode";
import { Icon } from "../ui/Icon";
import { Explorer } from "../features/pages/Explorer";
import { ownScope } from "../features/pages/scope";
import { openDialog } from "./dialogs";
import { LiveDot } from "./LiveDot";
import { drawerState, sideTabState, spaceState, useDrawer, usePersistedValue, useSideMode } from "./ui-state";

const BellMenu = lazy(() => import("./SidebarMenus").then((m) => ({ default: m.BellMenu })));
const SpacesMenu = lazy(() => import("./SidebarMenus").then((m) => ({ default: m.SpacesMenu })));

/** How long the pointer rests on the minimized sidebar before it opens over the page. */
const PEEK_MS = 800;

export function Sidebar() {
  const t = useT();
  const [hover, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { closed, auto } = useSideMode();
  const drawer = useDrawer();
  // a rail opens over the page while the pointer rests on it, or while the toggle holds it open (a screen too small for the sidebar open)
  const peek = hover || (auto && drawer);
  const rail = closed && !peek;
  // the list follows where you are: pages show your pages, a project shows the projects
  const path = useRouterState({ select: (r) => r.location.pathname });
  useEffect(() => { if (path.startsWith("/pages")) sideTabState.set("pages"); else if (path.startsWith("/p/")) sideTabState.set("tasks"); drawerState.set(false); }, [path]);

  return (
    <aside
      data-side={closed ? "closed" : "open"} data-peek={peek} data-rail={rail} data-drawer={drawer}
      onPointerEnter={(e) => { if (closed && e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(() => setPeek(true), PEEK_MS); } }}
      onPointerLeave={() => { clearTimeout(timer.current); setPeek(false); if (auto) drawerState.set(false); }}
      className={cn(
        "group/side relative z-40 flex h-full min-h-0 flex-col overflow-hidden transition-[inline-size,box-shadow] duration-200 ease-out",
        "panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass-side,var(--surface))] panels:shadow-1",
        "max-md:fixed max-md:inset-y-0 max-md:start-0 max-md:z-50 max-md:hidden max-md:w-[min(86vw,320px)] max-md:rounded-e-lg max-md:bg-surface max-md:shadow-2 max-md:data-[drawer=true]:flex",
        "w-[var(--side)] data-[rail=true]:w-[var(--rail)] data-[peek=true]:w-[272px] data-[peek=true]:rounded-lg data-[peek=true]:bg-surface data-[peek=true]:shadow-2",
      )}
    >
      <div className="flex items-center gap-2.5 px-3 pb-1.5 pt-2.5 group-data-[rail=true]/side:flex-col group-data-[rail=true]/side:px-2">
        <div className="flex items-center gap-[9px] text-[17px] font-bold tracking-tight">
          <Icon name="logo" className="size-[26px] text-brand" />
          <span className="group-data-[rail=true]/side:hidden">Madar</span>
        </div>
        <span className="grow group-data-[rail=true]/side:hidden" />
        <Suspense fallback={<span className="size-[var(--hit)]" />}><BellMenu /></Suspense>
      </div>
      <Suspense fallback={<span className="mx-2.5 mb-1 block h-[var(--row)]" />}><SpacesMenu /></Suspense>
      <SearchPill />
      <nav aria-label={t("today")} className="px-2.5 pb-0.5">
        <NavLink href="#/today" icon="today" label={t("today")} />
      </nav>
      <SideTabs />
      <Foot />
    </aside>
  );
}

function NavLink({ href, icon, label, items }: { href: string; icon: string; label: string; items?: () => MenuItems }) {
  const active = useRouterState({ select: (r) => "#" + r.location.pathname === href || r.location.pathname === href.slice(1) });
  return (
    <div className="contents" onContextMenu={items ? (e) => { e.preventDefault(); openContextMenu(e.clientX, e.clientY, items()); } : undefined}>
    <TextLink href={href} aria-current={active ? "page" : undefined} aria-label={label}
      className="flex min-h-[var(--row)] w-full items-center gap-2.5 rounded-sm px-2.5 text-text hoverable aria-[current=page]:bg-surface aria-[current=page]:font-semibold aria-[current=page]:shadow-[0_1px_2px_rgba(0,0,0,.08)] group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0">
      <Icon name={icon} className="text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate group-data-[rail=true]/side:hidden" dir="auto">{label}</span>
    </TextLink>
    </div>
  );
}

function SearchPill() {
  const t = useT();
  if (!useDescribe().operations["search.query"]) return null;
  return (
    <BaseButton onPress={() => openDialog("search")}
      className="mx-2.5 mb-1.5 mt-1 flex min-h-[var(--row)] items-center gap-2.5 rounded-btn border border-line-strong bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-3 text-muted-foreground hoverable group-data-[rail=true]/side:mx-2 group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0">
      <Icon name="search" />
      <span className="group-data-[rail=true]/side:hidden">{t("search").replace("…", "")}</span>
      <kbd dir="ltr" className="ms-auto rounded border border-line px-1.5 text-xs group-data-[rail=true]/side:hidden">/</kbd>
    </BaseButton>
  );
}

/** The navigation sidebar's two lists as tabs: your pages, and your projects. The list under the selected tab follows the route (see `Sidebar`). */
function SideTabs() {
  const t = useT();
  const tab = usePersistedValue(sideTabState);
  const pages = !!useDescribe().operations["pages.list"];
  const items = [...(pages ? [{ id: "pages", label: t("pages"), icon: "pages" }] : []), { id: "tasks", label: t("tasksTab"), icon: "task" }];
  return (
    <Tabs variant="segmented" label={t("sidebarLists")} items={items} selected={tab} onSelect={(k) => sideTabState.set(k as "tasks" | "pages")}
      className="flex min-h-0 flex-1 flex-col" listClassName="mx-2.5 my-1 group-data-[rail=true]/side:hidden" panelClassName="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2.5 pb-2.5 group-data-[rail=true]/side:hidden">
      <SideList />
    </Tabs>
  );
}

function SideList() {
  const tab = usePersistedValue(sideTabState);
  return tab === "pages" ? <PagesList /> : <ProjectsList />;
}

function ProjectsList() {
  const t = useT();
  const projects = useRead("projects.list").data.projects;
  const ws = useRead("spaces.list").data;
  const space = usePersistedValue(spaceState);
  const current = ws.spaces.some((w) => w.id === space) ? space : "default";
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canCreate = useHasOp("projects.create"), canMove = useHasOp("projects.move");
  const moveTo = async (project: string, to: string) => { await link.call("projects.move", { project, space: to }); await qc.invalidateQueries(); };
  const create = async () => {
    const name = await askText(t("newProject"));
    if (!name) return;
    const p = await link.call("projects.create", { name, space: current }) as { id: string };
    await qc.invalidateQueries();
    void navigate({ to: "/p/$projectId", params: { projectId: p.id } });
  };
  const menu = (p: { id: string; key?: string | null; space: string; level: string }) => (): MenuItems => {
    const go = (tab?: "knowledge" | "overview") => void navigate({ to: "/p/$projectId", params: { projectId: p.id }, search: tab ? { tab } : {} });
    return [
      { label: t("open"), icon: "board", onclick: () => go() },
      { label: t("knowledge"), icon: "page", onclick: () => go("knowledge") },
      { label: t("overview"), icon: "chart", onclick: () => go("overview") },
      p.key ? "-" : null,
      p.key ? { label: t("copyId") + " · " + p.key, icon: "link", onclick: () => void copyText(p.key!, t("copied")) } : null,
      canMove && p.level === "owner" ? "-" : null,
      canMove && p.level === "owner" ? { label: t("moveToSpace"), icon: "move", sub: () => ws.spaces.filter((w) => w.id !== p.space).map((w) => ({ label: w.builtin ? t("mySpace") : w.name, icon: "folder", onclick: () => void moveTo(p.id, w.id) })) } : null,
    ];
  };
  const mine = projects.filter((p) => p.space === current);
  return (
    <>
      <div className="mt-1 flex min-h-[var(--row)] items-center px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"><span className="grow">{t("projects")}</span>{canCreate && <IconButton icon="plus" size="sm" label={t("newProject")} onPress={() => void create()} />}</div>
      {mine.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted-foreground">{t("noProjectsHere")}</p>}
      {mine.map((p) => <NavLink key={p.id} href={`#/p/${p.id}`} icon="board" label={p.name} items={menu(p)} />)}
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
    <div className="flex items-center gap-2 px-2.5 py-1.5 group-data-[rail=true]/side:flex-col group-data-[rail=true]/side:px-2">
      <div className="flex min-w-0 flex-1 items-center gap-[9px] group-data-[rail=true]/side:flex-none">
        <Avatar subject={who.subject} name={who.display} mine size="sm" />
        <div className="min-w-0 leading-tight group-data-[rail=true]/side:hidden">
          <b className="block truncate font-semibold" dir="auto">{who.display}</b>
          <small className="flex items-center gap-1.5 text-muted-foreground"><LiveDot /></small>
        </div>
      </div>
      <IconButton size="sm" icon="help" label={t("kHelp") + " (?)"} className="group-data-[rail=true]/side:hidden" onPress={() => openDialog("shortcuts")} />
      <IconButton size="sm" icon="gear" label={t("settings")} onPress={() => openDialog("settings")} />
      <IconButton size="sm" icon="logout" label={t("signOut")} className="group-data-[rail=true]/side:hidden" onPress={signOut} />
    </div>
  );
}
