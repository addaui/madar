import type { ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { IconButton } from "../ui/Button";
import { drawerState, focusState, sideState, useDrawer, useIsNarrow, usePersistedValue } from "./ui-state";

/** The header above the raised surface: the sidebar toggle, breadcrumbs, the page's own actions and focus mode. */
export function Topbar({ crumbs, actions }: { crumbs: ReactNode; actions?: ReactNode }) {
  const t = useT();
  const side = usePersistedValue(sideState);
  const narrow = useIsNarrow(), drawer = useDrawer();
  return (
    <header className="flex min-h-10 items-center gap-0.5 px-3 pb-1 pt-1.5 max-md:px-2.5 group-data-[focus=1]/stage:hidden">
      <IconButton icon="side" label={t("toggleSide")} size="sm" className="size-[30px]" aria-pressed={narrow ? drawer : side === "open"} onClick={() => (narrow ? drawerState.set(!drawer) : sideState.set(side === "open" ? "closed" : "open"))} />
      <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-[13px] text-muted">{crumbs}</nav>
      <span className="grow" />
      {actions}
      <IconButton icon="focus" label={t("focusMode") + " (Ctrl+\\)"} className="size-[30px]" onClick={() => focusState.set("1")} />
    </header>
  );
}

/**
 * The page frame of a route: the header, the raised content, an optional status bar, and an optional side pane that runs the
 * full height beside them. In focus mode only the content shows.
 */
export function Stage({ topbar, status, pane, paneWidth = 340, children, flush }: { topbar: ReactNode; status?: ReactNode; pane?: ReactNode; paneWidth?: number; children: ReactNode; flush?: boolean }) {
  const t = useT();
  const focus = usePersistedValue(focusState) === "1";
  return (
    <div data-focus={focus ? "1" : "0"} data-pane={pane ? "1" : "0"} className="group/stage flex h-full min-h-0 min-w-0 gap-[var(--gap)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass,var(--surface))] panels:shadow-1">
        {topbar}
        <main id="main" className={cn("min-h-0 flex-1 overflow-auto px-7 pb-10 pt-1.5 max-md:px-4 workspace:rounded-lg workspace:bg-surface workspace:elevated", flush && "px-0 pb-0 pt-0")}>{children}</main>
        {status && <footer className="flex-none group-data-[focus=1]/stage:hidden">{status}</footer>}
      </div>
      {pane && (
        <aside ref={(el) => { if (el) el.style.setProperty("--pane-w", paneWidth + "px"); }}
          className="w-[var(--pane-w)] shrink-0 overflow-auto group-data-[focus=1]/stage:hidden max-[1180px]:fixed max-[1180px]:inset-y-3 max-[1180px]:end-3 max-[1180px]:z-30 max-[1180px]:w-[min(var(--pane-w),calc(100vw-24px))] max-[1180px]:rounded-lg max-[1180px]:bg-surface max-[1180px]:shadow-2 max-md:inset-0 max-md:w-full max-md:rounded-none">{pane}</aside>
      )}
      {focus && (
        <button type="button" onClick={() => focusState.set("0")} className="fixed bottom-4 end-4 z-50 inline-flex items-center gap-1.5 rounded-btn border border-line-strong bg-surface px-3 py-1.5 shadow-2">{t("exitFocus")}</button>
      )}
    </div>
  );
}
