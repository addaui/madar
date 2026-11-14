import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n/i18n";
import { cn } from "../lib/cn";
import { BaseButton, Button, IconButton } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { contextState, drawerState, focusState, sideState, useDrawer, usePersistedValue, useSideMode, useTier } from "./ui-state";

/**
 * The five regions of the Face (ADR 0067): the navigation sidebar and the context sidebar either side of the workspace, the topbar above it and
 * the bottom bar below it. The Shell owns the places; a screen declares what goes in them (`Topbar`, `BottomBar`, `ContextSidebar`) and its own
 * content is the workspace. Each declaration is a portal into a place the Shell drew, so a screen keeps its own state and loading while the Shell
 * alone decides whether the context sidebar is a column, a rail or a sheet.
 */
export interface ContextInfo {
  /** What the open button is called. */
  label: string;
  icon: string;
  width: number;
  /** It is here because you picked something (a task): it opens by itself and stays open. The others wait for you. */
  transient: boolean;
}

interface Regions {
  topbar: HTMLElement | null; setTopbar: (el: HTMLElement | null) => void;
  bottom: HTMLElement | null; setBottom: (el: HTMLElement | null) => void;
  context: HTMLElement | null; setContext: (el: HTMLElement | null) => void;
  info: ContextInfo | null; setInfo: (i: ContextInfo | null) => void;
  /** The context sidebar is open over the workspace (a rail that the pointer rests on, or a sheet on a phone). */
  peek: boolean; setPeek: (open: boolean) => void;
}
const RegionsContext = createContext<Regions | null>(null);
const useRegions = (): Regions => {
  const r = use(RegionsContext);
  if (!r) throw new Error("A region is used outside the Shell.");
  return r;
};

export function RegionsProvider({ children }: { children: ReactNode }) {
  const [topbar, setTopbar] = useState<HTMLElement | null>(null);
  const [bottom, setBottom] = useState<HTMLElement | null>(null);
  const [context, setContext] = useState<HTMLElement | null>(null);
  const [info, setInfoState] = useState<ContextInfo | null>(null);
  const [peek, setPeek] = useState(false);
  const setInfo = (i: ContextInfo | null) => { setInfoState(i); setPeek(!!i?.transient); };
  return <RegionsContext value={{ topbar, setTopbar, bottom, setBottom, context, setContext, info, setInfo, peek, setPeek }}>{children}</RegionsContext>;
}

/** How the context sidebar is shown now (ADR 0065 tiers): a column, a rail, or a sheet. */
function useContextView() {
  const r = useRegions();
  const tier = useTier();
  const pinned = usePersistedValue(contextState) === "open";
  const info = r.info;
  const roomy = tier === "wide" || tier === "medium";
  const column = !!info && roomy && (info.transient || pinned);
  return {
    info, tier, column, sheet: tier === "phone",
    rail: !!info && !column && tier !== "phone",
    open: column || r.peek,
    toggle: () => { if (roomy && !info?.transient) contextState.set(pinned ? "closed" : "open"); else r.setPeek(!r.peek); },
    topbar: r.topbar, context: r.context, setContext: r.setContext, setPeek: r.setPeek, peek: r.peek,
  };
}

/** The strip above the workspace. */
/** `title` names the screen for the browser tab and for screen readers (the visible name is in the breadcrumbs). */
export function Topbar({ title, crumbs, actions }: { title: string; crumbs: ReactNode; actions?: ReactNode }) {
  const t = useT();
  useEffect(() => { document.title = title ? title + " · Madar" : "Madar"; return () => { document.title = "Madar"; }; }, [title]);
  const side = usePersistedValue(sideState);
  const { auto, phone } = useSideMode();
  const drawer = useDrawer();
  const ctx = useContextView();
  const overlay = phone || auto;   // on a screen too small for the navigation sidebar open, the toggle opens it over the workspace
  const header = (
    <header className="flex min-h-10 items-center gap-0.5 px-3 pb-1 pt-1.5 max-md:px-2.5 group-data-[focus=1]/stage:hidden">
      <IconButton icon="side" label={t("toggleSide")} size="sm" className="size-[30px]" aria-pressed={overlay ? drawer : side === "open"} onPress={() => (overlay ? drawerState.set(!drawer) : sideState.set(side === "open" ? "closed" : "open"))} />
      <h1 className="sr-only">{title}</h1>
      <nav aria-label="breadcrumb" className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap text-[13px] text-muted">{crumbs}</nav>
      <span className="grow" />
      {actions}
      <IconButton icon="focus" label={t("focusMode") + " (Ctrl+\\)"} className="size-[30px]" onPress={() => focusState.set("1")} />
      {ctx.info && <IconButton icon="side" label={t("toggleInfo")} className="size-[30px] -scale-x-100 rtl:scale-x-100" aria-pressed={ctx.open} onPress={ctx.toggle} />}
    </header>
  );
  return ctx.topbar ? createPortal(header, ctx.topbar) : null;
}

/** The strip below the workspace. */
export function BottomBar({ children }: { children: ReactNode }) {
  const { bottom } = useRegions();
  return bottom ? createPortal(<footer className="flex-none group-data-[focus=1]/stage:hidden">{children}</footer>, bottom) : null;
}

/** What belongs to where the screen is. A screen without one has none. */
export function ContextSidebar({ label, icon = "side", width = 340, transient = false, children }: { label: string; icon?: string; width?: number; transient?: boolean; children: ReactNode }) {
  const { context, setInfo } = useRegions();
  useEffect(() => {
    setInfo({ label, icon, width, transient });
    return () => setInfo(null);
  }, [label, icon, width, transient, setInfo]);
  return context ? createPortal(children, context) : null;
}

const RAIL_MS = 250;

/** The place the context sidebar is drawn: nothing when the screen has none. A rail is one icon in a narrow strip; the sidebar opens over the workspace while the pointer rests on it. */
function ContextRegion() {
  const t = useT();
  const { info, tier, column, sheet, rail, open, peek, context, setContext, setPeek } = useContextView();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const width = info ? (tier === "medium" ? Math.min(info.width, 380) : info.width) : 0;
  useEffect(() => { context?.style.setProperty("--pane-w", width + "px"); }, [context, width]);
  if (!info) return null;
  const transient = info.transient, label = info.label, icon = info.icon;

  const leave = (e: React.PointerEvent<HTMLElement>) => {
    clearTimeout(timer.current);
    const a = document.activeElement;
    const typing = a && e.currentTarget.contains(a) && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || (a as HTMLElement).isContentEditable);
    if (!typing && !transient) setPeek(false);   // never while you are writing in it
  };
  return (
    <>
      {rail && (
        <div className="relative w-10 shrink-0 pt-1.5 group-data-[focus=1]/stage:hidden">
          <BaseButton aria-label={label} aria-expanded={open}
            onPress={() => { if (tier === "medium" || tier === "wide") contextState.set("open"); else setPeek(true); }}
            onHoverStart={(e) => { if (e.pointerType === "mouse") { clearTimeout(timer.current); timer.current = setTimeout(() => setPeek(true), RAIL_MS); } }}
            onHoverEnd={() => clearTimeout(timer.current)}
            className="grid size-9 place-items-center rounded-sm border border-line bg-surface text-muted hoverable hover:text-text"><Icon name={icon} /></BaseButton>
        </div>
      )}
      {sheet && peek && <IconButton icon="close" label={t("close")} className="fixed end-3 top-3 z-40 bg-surface shadow-1" onPress={() => setPeek(false)} />}
      <aside ref={setContext} hidden={!column && !peek} onPointerLeave={rail ? leave : undefined}
        className={cn("group-data-[focus=1]/stage:hidden",
          column ? "w-[var(--pane-w)] shrink-0 overflow-auto" : sheet ? "fixed inset-0 z-30 overflow-auto bg-surface" : "fixed inset-y-3 end-3 z-30 w-[min(var(--pane-w),calc(100vw-24px))] overflow-auto rounded-lg bg-surface shadow-2")} />
    </>
  );
}

/** What is between the navigation sidebar's edge and the window's: the topbar, the workspace and the bottom bar in one column, and the context sidebar beside it. */
export function Frame({ flush = false, children }: { flush?: boolean; children: ReactNode }) {
  const t = useT();
  const { setTopbar, setBottom } = useRegions();
  const focus = usePersistedValue(focusState) === "1";
  return (
    <div data-focus={focus ? "1" : "0"} className="group/stage flex h-full min-h-0 min-w-0 gap-[var(--gap)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass,var(--surface))] panels:shadow-1">
        <div ref={setTopbar} className="contents" />
        <main id="main" tabIndex={-1} className={cn("min-h-0 flex-1 overflow-auto px-7 pb-10 pt-1.5 max-md:px-4 workspace:rounded-lg workspace:bg-surface workspace:elevated", flush && "px-0 pb-0 pt-0")}>{children}</main>
        <div ref={setBottom} className="contents" />
      </div>
      <ContextRegion />
      {focus && (
        <Button className="fixed bottom-4 end-4 z-50 shadow-2" onPress={() => focusState.set("0")}>{t("exitFocus")}</Button>
      )}
    </div>
  );
}

export {};
declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The workspace has no padding (a page's sheet scrolls by itself). */
    flush?: boolean;
  }
}
