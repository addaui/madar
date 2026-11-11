import { createHashHistory, createRootRoute, createRoute, createRouter, redirect, RouterProvider } from "@tanstack/react-router";
import { lazy } from "react";
import { Shell } from "./Shell";
import { Stage, Topbar } from "./Stage";
import { Today } from "../features/today/Today";

import { useT } from "../i18n/i18n";
import { queryClient } from "../api/link";
import { reads, warm } from "../api/reads";
import { spaceState } from "./ui-state";

// the heavy screens load when first visited, so the first paint carries only the frame and Today
const PageScreen = lazy(() => import("../features/pages/PageScreen").then((m) => ({ default: m.PageScreen })));
const ProjectScreen = lazy(() => import("../features/projects/ProjectScreen").then((m) => ({ default: m.ProjectScreen })));

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", beforeLoad: () => { throw redirect({ to: "/today" }); } });

function TodayRoute() {
  const t = useT();
  return <Stage topbar={<Topbar crumbs={<span aria-current="page" className="px-1.5 font-semibold text-text">{t("today")}</span>} />}><Today /></Stage>;
}
const todayRoute = createRoute({
  getParentRoute: () => rootRoute, path: "today", component: TodayRoute,
  // the reads Today shows start together
  loader: () => { void warm(queryClient, reads.today(spaceState.get())).catch(() => undefined); },
});

function PagesIndex() {
  const t = useT();
  return (
    <Stage topbar={<Topbar crumbs={<span aria-current="page" className="px-1.5 font-semibold text-text">{t("pages")}</span>} />}>
      <div className="mx-auto mt-[8vh] grid max-w-md place-items-center gap-1 text-center text-muted"><b className="text-text">{t("pickPage")}</b><span>{t("pickPageHint")}</span></div>
    </Stage>
  );
}
const pagesRoute = createRoute({ getParentRoute: () => rootRoute, path: "pages", component: PagesIndex, loader: () => { void warm(queryClient, reads.pages(spaceState.get())).catch(() => undefined); } });
const pageRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "pages/$pageId",
  loader: ({ params }) => { void warm(queryClient, params.pageId === "new" ? reads.pages(spaceState.get()) : reads.page(spaceState.get(), params.pageId)).catch(() => undefined); },
  validateSearch: (s: Record<string, unknown>): { parent?: string } => ({ parent: typeof s.parent === "string" ? s.parent : undefined }),
  component: function PageRouteView() { const { pageId } = pageRoute.useParams(); const { parent } = pageRoute.useSearch(); return <PageScreen id={pageId} parent={parent} />; },
});

export interface ProjectSearch { tab?: "board" | "list" | "overview" | "knowledge"; task?: string; page?: string; parent?: string }
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "p/$projectId",
  loader: ({ params }) => { void warm(queryClient, reads.project(params.projectId)).catch(() => undefined); },
  validateSearch: (s: Record<string, unknown>): ProjectSearch => ({
    tab: ["board", "list", "overview", "knowledge"].includes(String(s.tab)) ? (s.tab as ProjectSearch["tab"]) : undefined,
    task: typeof s.task === "string" ? s.task : undefined,
    page: typeof s.page === "string" ? s.page : undefined,
    parent: typeof s.parent === "string" ? s.parent : undefined,
  }),
  component: function ProjectRouteView() { const { projectId } = projectRoute.useParams(); return <ProjectScreen projectId={projectId} search={projectRoute.useSearch()} />; },
});

const routeTree = rootRoute.addChildren([indexRoute, todayRoute, pagesRoute, pageRoute, projectRoute]);

export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}

export const AppRouter = () => <RouterProvider router={router} />;
