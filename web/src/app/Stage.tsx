import { useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { drawerState, focusState, sideState, useDrawer, usePersistedValue, useSideMode, useTier } from "./ui-state";

/** The header above the raised surface: the sidebar toggle, breadcrumbs, the page's own actions and focus mode. */
export function Topbar({ crumbs, actions }: { crumbs: ReactNode; actions?: ReactNode }) {
  const t = useT();
  const side = usePersistedValue(sideState);
  const { auto, phone: narrow } = useSideMode();
  const drawer = useDrawer();
  const overlay = narrow || auto;   // on a screen too small for the sidebar open, the toggle opens it over the page
  return (
    <header className="flex min-h-10 items-center gap-0.5 px-3 pb-1 pt-1.5 max-md:px-2.5 group-data-[focus=1]/stage:hidden">
      <IconButton icon="side" label={t("toggleSide")} size="sm" className="size-[30px]" aria-pressed={overlay ? drawer : side === "open"} onClick={() => (overlay ? drawerState.set(!drawer) : sideState.set(side === "open" ? "closed" : "open"))} />
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
export function Stage({ topbar, status, pane, paneWidth = 340, paneLabel, paneIcon = "side", paneTransient, children, flush }: { topbar: ReactNode; status?: ReactNode; pane?: ReactNode; paneWidth?: number; paneLabel?: string; paneIcon?: string; paneTransient?: boolean; children: ReactNode; flush?: boolean }) {
  const t = useT();
  const focus = usePersistedValue(focusState) === "1";
  return (
    <div data-focus={focus ? "1" : "0"} data-pane={pane ? "1" : "0"} className="group/stage flex h-full min-h-0 min-w-0 gap-[var(--gap)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass,var(--surface))] panels:shadow-1">
        {topbar}
        <main id="main" tabIndex={-1} className={cn("min-h-0 flex-1 overflow-auto px-7 pb-10 pt-1.5 max-md:px-4 workspace:rounded-lg workspace:bg-surface workspace:elevated", flush && "px-0 pb-0 pt-0")}>{children}</main>
        {status && <footer className="flex-none group-data-[focus=1]/stage:hidden">{status}</footer>}
      </div>
      {pane && <PaneFrame width={paneWidth} label={paneLabel ?? t("toggleInfo")} icon={paneIcon} transient={paneTransient}>{pane}</PaneFrame>}
      {focus && (
        <button type="button" onClick={() => focusState.set("0")} className="fixed bottom-4 end-4 z-50 inline-flex items-center gap-1.5 rounded-btn border border-line-strong bg-surface px-3 py-1.5 shadow-2">{t("exitFocus")}</button>
      )}
    </div>
  );
}

const setWidth = (el: HTMLElement | null, w: number) => el?.style.setProperty("--pane-w", w + "px");
const RAIL_MS = 250;

/**
 * The side panel by screen size (see `Tier`): a column beside the workspace (narrower on a medium screen), a rail on a compact one that opens over the
 * workspace while the pointer rests on it and closes when the pointer leaves, and a full-screen sheet on a phone.
 */
function PaneFrame({ width, label, icon, transient, children }: { width: number; label: string; icon: string; transient?: boolean; children: ReactNode }) {
  const tier = useTier();
  if (tier === "phone") return <aside ref={(el) => setWidth(el, width)} className="fixed inset-0 z-30 overflow-auto bg-surface group-data-[focus=1]/stage:hidden">{children}</aside>;
  if (tier === "compact") return <PaneRail width={width} label={label} icon={icon} transient={transient}>{children}</PaneRail>;
  return <aside ref={(el) => setWidth(el, tier === "medium" ? Math.min(width, 380) : width)} className="w-[var(--pane-w)] shrink-0 overflow-auto group-data-[focus=1]/stage:hidden">{children}</aside>;
}

/** The rail: one icon button in a narrow strip. A panel that opened because you picked something (a task) starts open; the others wait for the pointer. */
function PaneRail({ width, label, icon, transient, children }: { width: number; label: string; icon: string; transient?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!!transient);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const leave = (e: React.PointerEvent<HTMLElement>) => {
    clearTimeout(timer.current);
    const a = document.activeElement;
    const typing = a && e.currentTarget.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a as HTMLElement).isContentEditable);
    if (!typing) setOpen(false);   // never while you are writing in it
  };
  return (
    <div className="relative w-11 shrink-0 group-data-[focus=1]/stage:hidden">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(true)}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), RAIL_MS); } }}
        onPointerLeave={() => clearTimeout(timer.current)}
        className="grid size-11 place-items-center rounded-lg bg-surface text-muted shadow-1 outline-none hover:text-text data-[focus-visible]:outline-2 focus-visible:outline-2 focus-visible:outline-accent"><Icon name={icon} /></button>
      {open && (
        <aside ref={(el) => setWidth(el, width)} onPointerLeave={leave}
          className="fixed inset-y-3 end-3 z-30 w-[min(var(--pane-w),calc(100vw-24px))] overflow-auto rounded-lg bg-surface shadow-2">{children}</aside>
      )}
    </div>
  );
}
