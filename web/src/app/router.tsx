import { createHashHistory, createRootRoute, createRoute, createRouter, redirect, RouterProvider } from "@tanstack/react-router";
import { lazy } from "react";
import { Shell } from "./Shell";
import { Topbar } from "./regions";
import { Today } from "../features/today/Today";
import { SearchScreen, type SearchParams } from "../features/search/SearchScreen";

import { useT } from "../i18n/i18n";
import { queryClient } from "../api/link";
import { reads, warm, type Read } from "../api/reads";
import { StageSkeleton } from "../ui/Skeleton";
import { spaceState } from "./ui-state";

// the heavy screens load when first visited, so the first paint carries only the frame and Today
const loadPageScreen = () => import("../features/pages/PageScreen");
const loadProjectScreen = () => import("../features/projects/ProjectScreen");
const PageScreen = lazy(() => loadPageScreen().then((m) => ({ default: m.PageScreen })));
const ProjectScreen = lazy(() => loadProjectScreen().then((m) => ({ default: m.ProjectScreen })));

/**
 * A route's loader waits for what the screen shows (its reads and its code), so a navigation keeps the screen you are on until the next
 * one can be drawn whole, and a screen never appears empty and fills in. A read that fails is left to the screen's own error handling.
 */
const ready = (reading: Read[], code?: () => Promise<unknown>) => Promise.all([warm(queryClient, reading), code?.()]).then(() => undefined, () => undefined);

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", beforeLoad: () => { throw redirect({ to: "/today" }); } });

function TodayRoute() {
  const t = useT();
  return <><Topbar title={t("today")} crumbs={<span aria-current="page" className="px-1.5 font-semibold text-text">{t("today")}</span>} /><Today /></>;
}
const todayRoute = createRoute({
  getParentRoute: () => rootRoute, path: "today", component: TodayRoute,
  // the reads Today shows start together
  loader: () => ready(reads.today(spaceState.get())),
});

function PagesIndex() {
  const t = useT();
  return (
    <>
      <Topbar title={t("pages")} crumbs={<span aria-current="page" className="px-1.5 font-semibold text-text">{t("pages")}</span>} />
      <div className="mx-auto mt-[8vh] grid max-w-md place-items-center gap-1 text-center text-muted"><b className="text-text">{t("pickPage")}</b><span>{t("pickPageHint")}</span></div>
    </>
  );
}
const pagesRoute = createRoute({ getParentRoute: () => rootRoute, path: "pages", component: PagesIndex, loader: () => ready(reads.pages(spaceState.get())) });
const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "pages/$pageId",
  staticData: { flush: true },
  loader: ({ params }) => ready(params.pageId === "new" ? reads.pages(spaceState.get()) : reads.page(spaceState.get(), params.pageId), loadPageScreen),
  validateSearch: (s: Record<string, unknown>): { parent?: string } => ({ parent: typeof s.parent === "string" ? s.parent : undefined }),
  component: function PageRouteView() { const { pageId } = pageRoute.useParams(); const { parent } = pageRoute.useSearch(); return <PageScreen id={pageId} parent={parent} />; },
});

const searchRoute = createRoute({
  getParentRoute: () => rootRoute, path: "search",
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    kind: ["page", "knowledge", "task"].includes(String(s.kind)) ? (s.kind as SearchParams["kind"]) : undefined,
    all: String(s.all) === "1" ? "1" : undefined,
  }),
  component: function SearchRouteView() { const p = searchRoute.useSearch(); return <SearchScreen q={p.q} kind={p.kind} all={p.all} />; },
});

export interface ProjectSearch { tab?: "board" | "list" | "overview" | "knowledge"; task?: string; page?: string; parent?: string }
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "p/$projectId",
  loader: ({ params }) => ready(reads.project(params.projectId), loadProjectScreen),
  validateSearch: (s: Record<string, unknown>): ProjectSearch => ({
    tab: ["board", "list", "overview", "knowledge"].includes(String(s.tab)) ? (s.tab as ProjectSearch["tab"]) : undefined,
    task: typeof s.task === "string" ? s.task : undefined,
    page: typeof s.page === "string" ? s.page : undefined,
    parent: typeof s.parent === "string" ? s.parent : undefined,
  }),
  component: function ProjectRouteView() { const { projectId } = projectRoute.useParams(); return <ProjectScreen projectId={projectId} search={projectRoute.useSearch()} />; },
});

const routeTree = rootRoute.addChildren([indexRoute, todayRoute, searchRoute, pagesRoute, pageRoute, projectRoute]);

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent", defaultPendingMs: 120, defaultPendingMinMs: 0, defaultPendingComponent: StageSkeleton });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

export const AppRouter = () => <RouterProvider router={router} />;
