import type { ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "../lib/cn";
import { popup, popupItem } from "./base";
import { BaseButton, type BaseButtonProps } from "./Button";
import { Icon } from "./Icon";

/** One entry of a menu. `sub` makes it open a submenu, built when it is opened. */
export interface MenuEntry { label: string; icon?: string; danger?: boolean; checked?: boolean; disabled?: boolean; onclick?: () => void; sub?: () => (MenuEntry | "-" | null | undefined)[] }
export type MenuEntries = (MenuEntry | "-" | null | undefined)[];

const row = (e: MenuEntry) => (
  <>
    {e.icon ? <Icon name={e.icon} className="size-4 text-muted-foreground" /> : <span className="size-4" />}
    <span className="grow truncate" dir="auto">{e.label}</span>
    {e.checked && <Icon name="check" className="size-4 text-brand" />}
    {e.sub && <Icon name="chevron" className="size-4 text-muted-foreground rtl:-scale-x-100" />}
  </>
);

const pop = "origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none";

/** The rows of a menu (and of its submenus). The same rows serve a menu opened by a button and one opened at the pointer. */
export function MenuRows({ entries, onDone }: { entries: MenuEntries; onDone?: () => void }) {
  return entries.map((e, i) => {
    if (!e) return null;
    if (e === "-") return <Menu.Separator key={i} className="my-1 h-px bg-line" />;
    const cls = cn(popupItem, e.danger && "text-danger");
    if (e.sub) {
      const sub = e.sub;
      return (
        <Menu.SubmenuRoot key={i}>
          <Menu.SubmenuTrigger label={e.label} className={cls}>{row(e)}</Menu.SubmenuTrigger>
          <Menu.Portal>
            <Menu.Positioner className="z-[85]" side="inline-end" align="start" alignOffset={-6}>
              <Menu.Popup className={cn(popup, "min-w-48 outline-none", pop)}><MenuRows entries={sub()} onDone={onDone} /></Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.SubmenuRoot>
      );
    }
    return <Menu.Item key={i} label={e.label} disabled={e.disabled} className={cls} onClick={() => { onDone?.(); e.onclick?.(); }}>{row(e)}</Menu.Item>;
  });
}

/** A menu: a button that opens a list of actions. */
export function MenuButton({ label, entries, buttonProps, children, placement = "bottom start" }: { label: string; entries: MenuEntries; buttonProps?: Omit<BaseButtonProps, "aria-label" | "children">; children: ReactNode; placement?: "bottom start" | "bottom end" }) {
  const [side, align] = placement.split(" ") as ["bottom", "start" | "end"];
  return (
    <Menu.Root>
      <Menu.Trigger render={<BaseButton aria-label={label} {...buttonProps} />}>{children}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side={side} align={align} sideOffset={4} className="z-[80]">
          <Menu.Popup aria-label={label} className={cn(popup, "min-w-52 max-w-80 outline-none", pop)}><MenuRows entries={entries} /></Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A menu at a point on the screen (a right click, a "more" button). */
export function PointMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntries; onClose: () => void }) {
  const anchor = { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  return (
    <Menu.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side="bottom" align="start" sideOffset={2} className="z-[80]">
          <Menu.Popup aria-label="menu" className={cn(popup, "min-w-52 max-w-80 outline-none", pop)}><MenuRows entries={entries} onDone={onClose} /></Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
