import { useQueryClient } from "@tanstack/react-query";
import { Button as AriaButton, Dialog, DialogTrigger, Menu, MenuItem, MenuTrigger, Popover, Separator } from "react-aria-components";
import { link } from "../api/link";
import { useRead } from "../api/hooks";
import { useHasOp } from "../api/session";
import { askConfirm, askText } from "../ui/overlays";
import { useT } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import { Inbox } from "./Inbox";
import { spaceState, usePersistedValue } from "./ui-state";

/** The sidebar's two menus. They carry the accessible-menu library, so the sidebar loads them after first paint. */
export function BellMenu() {
  const t = useT();
  const unread = useRead("inbox.list", { limit: 30 }).data.unread;
  return (
    <DialogTrigger>
      <AriaButton aria-label={t("inbox") + (unread ? ` (${unread})` : "")}
        className="relative inline-grid size-[34px] shrink-0 place-items-center rounded-[10px] text-muted outline-none hoverable hover:text-text pressed:bg-soft data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent">
        <Icon name="bell" />
        {unread > 0 && <span className="absolute end-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}
      </AriaButton>
      <Popover placement="bottom start" className="w-[340px] max-w-[92vw] rounded-md border border-line-strong bg-surface p-2.5 shadow-2">
        <Dialog aria-label={t("inbox")} className="outline-none"><Inbox /></Dialog>
      </Popover>
    </DialogTrigger>
  );
}

export function SpacesMenu() {
  const t = useT();
  const ws = useRead("workspaces.list").data;
  const qc = useQueryClient();
  const current = usePersistedValue(spaceState);
  const canCreate = useHasOp("workspaces.create"), canRename = useHasOp("workspaces.rename"), canDelete = useHasOp("workspaces.delete");
  const cur = ws.workspaces.find((w) => w.id === current) ?? ws.workspaces[0];
  if (!cur) return null;
  const name = cur.builtin ? t("mySpace") : cur.name;
  const refresh = () => qc.invalidateQueries();
  const act = async (id: string) => {
    if (id === "new") {
      const n = await askText(t("newWorkspace"));
      if (!n) return;
      const w = await link.call("workspaces.create", { name: n }) as { id?: string };
      if (w.id) spaceState.set(w.id);
    } else if (id === "rename") {
      const n = await askText(t("renameWs"), cur.name);
      if (n) await link.call("workspaces.rename", { id: cur.id, name: n });
    } else if (id === "delete") {
      if (!(await askConfirm(t("sure")))) return;
      await link.call("workspaces.delete", { id: cur.id });
    } else spaceState.set(id);
    await refresh();
  };
  return (
    <MenuTrigger>
      <AriaButton aria-label={t("spaces")}
        className="mx-3 mb-1 mt-0.5 flex items-center gap-2.5 rounded-[12px] border border-line bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-2.5 py-[7px] text-start outline-none hoverable group-data-[rail=true]/side:mx-2 group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0 data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent">
        <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-on-accent">{(Array.from(name)[0] ?? "S").toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate group-data-[rail=true]/side:hidden" dir="auto">{name}</span>
        <Icon name="down" className="size-[15px] text-muted group-data-[rail=true]/side:hidden" />
      </AriaButton>
      <Popover placement="bottom start" className="min-w-52 rounded-md border border-line-strong bg-surface p-1.5 shadow-2">
        <Menu className="outline-none" onAction={(id) => void act(String(id))}>
          {ws.workspaces.map((w) => (
            <MenuItem key={w.id} id={w.id} textValue={w.builtin ? t("mySpace") : w.name} className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 outline-none focus:bg-hover">
              <Icon name="folder" /><span className="grow truncate" dir="auto">{w.builtin ? t("mySpace") : w.name}</span>{w.id === cur.id && <Icon name="check" className="text-accent" />}
            </MenuItem>
          ))}
          {canCreate && <Separator className="my-1 h-px bg-line" />}
          {canCreate && <MenuItem id="new" textValue={t("newWorkspace")} className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 outline-none focus:bg-hover"><Icon name="plus" /><span className="grow">{t("newWorkspace")}</span></MenuItem>}
          {!cur.builtin && (canRename || canDelete) && <Separator className="my-1 h-px bg-line" />}
          {!cur.builtin && canRename && <MenuItem id="rename" textValue={t("renameWs")} className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 outline-none focus:bg-hover"><Icon name="edit" /><span className="grow">{t("renameWs")}</span></MenuItem>}
          {!cur.builtin && canDelete && <MenuItem id="delete" textValue={t("deleteWs")} className="flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-danger outline-none focus:bg-hover"><Icon name="trash" /><span className="grow">{t("deleteWs")}</span></MenuItem>}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
