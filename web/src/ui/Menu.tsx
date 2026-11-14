import type { ReactNode } from "react";
import { Menu, MenuItem, MenuTrigger, Popover, Separator, SubmenuTrigger } from "react-aria-components";
import { cn } from "../lib/cn";
import { popup, popupItem } from "./base";
import { BaseButton, type BaseButtonProps } from "./Button";
import { Icon } from "./Icon";
import { PointPopover } from "./PointPopover";

/** One entry of a menu. `sub` makes it open a submenu, built when it is opened. */
export interface MenuEntry { label: string; icon?: string; danger?: boolean; checked?: boolean; disabled?: boolean; onclick?: () => void; sub?: () => (MenuEntry | "-" | null | undefined)[] }
export type MenuEntries = (MenuEntry | "-" | null | undefined)[];

const row = (e: MenuEntry) => (
  <>
    {e.icon ? <Icon name={e.icon} className="size-4 text-muted" /> : <span className="size-4" />}
    <span className="grow truncate" dir="auto">{e.label}</span>
    {e.checked && <Icon name="check" className="size-4 text-accent" />}
    {e.sub && <Icon name="chevron" className="size-4 text-muted rtl:-scale-x-100" />}
  </>
);

/** The rows of a menu (and of its submenus). The same rows serve a menu opened by a button and one opened at the pointer. */
export function MenuRows({ entries, onDone }: { entries: MenuEntries; onDone?: () => void }) {
  return entries.map((e, i) => {
    if (!e) return null;
    if (e === "-") return <Separator key={i} className="my-1 h-px bg-line" />;
    const cls = cn(popupItem, e.danger && "text-danger");
    if (e.sub) {
      const sub = e.sub;
      return (
        <SubmenuTrigger key={i}>
          <MenuItem textValue={e.label} className={cls}>{row(e)}</MenuItem>
          <Popover className={cn(popup, "min-w-48")}><Menu className="outline-none"><MenuRows entries={sub()} onDone={onDone} /></Menu></Popover>
        </SubmenuTrigger>
      );
    }
    return <MenuItem key={i} textValue={e.label} isDisabled={e.disabled} className={cls} onAction={() => { onDone?.(); e.onclick?.(); }}>{row(e)}</MenuItem>;
  });
}

/** A menu: a button that opens a list of actions. */
export function MenuButton({ label, entries, buttonProps, children, placement = "bottom start" }: { label: string; entries: MenuEntries; buttonProps?: Omit<BaseButtonProps, "aria-label" | "children">; children: ReactNode; placement?: "bottom start" | "bottom end" }) {
  return (
    <MenuTrigger>
      <BaseButton aria-label={label} {...buttonProps}>{children}</BaseButton>
      <Popover placement={placement} className={cn(popup, "min-w-52 max-w-80")}>
        <Menu aria-label={label} className="outline-none"><MenuRows entries={entries} /></Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** A menu at a point on the screen (a right click, a "more" button). */
export function PointMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntries; onClose: () => void }) {
  return (
    <PointPopover x={x} y={y} onClose={onClose} className={cn(popup, "min-w-52 max-w-80")}>
      <Menu aria-label="menu" className="outline-none" onAction={() => undefined} autoFocus="first"><MenuRows entries={entries} onDone={onClose} /></Menu>
    </PointPopover>
  );
}
