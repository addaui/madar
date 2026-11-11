import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { usePulse } from "../api/session";
import { useT } from "../i18n/i18n";
import { Button } from "../ui/Button";
import { useApplyAppearance } from "./appearance";
import { openDialog } from "./dialogs";
import { Sidebar } from "./Sidebar";
import { drawerState, focusState, sideState, useDrawer, usePersistedValue } from "./ui-state";

function Failed({ error, resetErrorBoundary }: FallbackProps) {
  const t = useT();
  return (
    <div role="alert" className="grid h-full place-items-center p-8 text-center">
      <div className="grid gap-3"><b>{t("offline")}</b><p className="m-0 text-muted">{error instanceof Error ? error.message : String(error)}</p><Button onClick={resetErrorBoundary}>{t("retry")}</Button></div>
    </div>
  );
}

const DialogsHost = lazy(() => import("../features/dialogs/DialogsHost"));

const Loading = () => <div aria-busy="true" className="h-full" />;

/** `/` search, `?` help, `n` new task in a project, `Ctrl+\\` focus mode. Plain keys do nothing while typing in a field or while a window is open. */
function useShortcuts() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); focusState.set(focusState.get() === "1" ? "0" : "1"); return; }
      const a = document.activeElement;
      const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a as HTMLElement).isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[role=dialog],[role=menu]")) return;
      if (e.key === "/") { e.preventDefault(); openDialog("search"); }
      else if (e.key === "?") { e.preventDefault(); openDialog("shortcuts"); }
      else if ((e.key === "n" || e.key === "N") && path.startsWith("/p/")) { e.preventDefault(); document.querySelector<HTMLInputElement>("section[data-status] input")?.focus(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [navigate, path]);
}

/** The frame: the sidebar beside whatever the route shows. Each region fails and loads on its own. */
export function Shell() {
  useApplyAppearance();
  usePulse(true);
  const side = usePersistedValue(sideState);
  const focus = usePersistedValue(focusState) === "1";
  useShortcuts();
  const drawer = useDrawer();
  return (
    <div data-side={side} data-focus={focus ? "1" : "0"}
      className="grid h-dvh grid-cols-[var(--side)_minmax(0,1fr)] gap-[var(--gap)] bg-bg p-[var(--frame)] data-[side=closed]:grid-cols-[var(--rail)_minmax(0,1fr)] data-[focus=1]:grid-cols-1 max-md:grid-cols-1 max-md:p-0 max-md:data-[side=closed]:grid-cols-1">
      <div className="min-h-0" hidden={focus}>
        <ErrorBoundary FallbackComponent={Failed}><Suspense fallback={<Loading />}><Sidebar /></Suspense></ErrorBoundary>
      </div>
      <div className="min-h-0 min-w-0">
        <ErrorBoundary FallbackComponent={Failed}><Suspense fallback={<Loading />}><Outlet /></Suspense></ErrorBoundary>
      </div>
      {drawer && <button type="button" aria-label="close" onClick={() => drawerState.set(false)} className="fixed inset-0 z-40 hidden bg-black/40 max-md:block" />}
      <Suspense fallback={null}><DialogsHost /></Suspense>
    </div>
  );
}
