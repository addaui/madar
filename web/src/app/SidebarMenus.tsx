import { useQueryClient } from "@tanstack/react-query";
import { link } from "../api/link";
import { useRead } from "../api/hooks";
import { useHasOp } from "../api/session";
import { askConfirm, askText } from "../ui/overlays";
import { useT } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuEntries } from "../ui/Menu";
import { PopupButton } from "../ui/Popup";
import { Inbox } from "./Inbox";
import { spaceState, usePersistedValue } from "./ui-state";

/** The sidebar's two menus. They carry the accessible-menu library, so the sidebar loads them after first paint. */
export function BellMenu() {
  const t = useT();
  const unread = useRead("inbox.list", { limit: 30 }).data.unread;
  return (
    <PopupButton label={t("inbox") + (unread ? ` (${unread})` : "")} width={340}
      buttonProps={{ className: "relative inline-grid size-[var(--hit)] shrink-0 place-items-center rounded-sm text-muted hoverable hover:text-text data-[pressed]:bg-soft" }}
      trigger={<><Icon name="bell" />{unread > 0 && <span className="absolute end-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}</>}>
      <Inbox />
    </PopupButton>
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
  const entries: MenuEntries = [
    ...ws.workspaces.map((w) => ({ label: w.builtin ? t("mySpace") : w.name, icon: "folder", checked: w.id === cur.id, onclick: () => { spaceState.set(w.id); void refresh(); } })),
    canCreate ? "-" : null,
    canCreate ? { label: t("newWorkspace"), icon: "plus", onclick: async () => {
      const n = await askText(t("newWorkspace"));
      if (!n) return;
      const w = await link.call("workspaces.create", { name: n }) as { id?: string };
      if (w.id) spaceState.set(w.id);
      await refresh();
    } } : null,
    !cur.builtin && (canRename || canDelete) ? "-" : null,
    !cur.builtin && canRename ? { label: t("renameWs"), icon: "edit", onclick: async () => { const n = await askText(t("renameWs"), cur.name); if (n) { await link.call("workspaces.rename", { id: cur.id, name: n }); await refresh(); } } } : null,
    !cur.builtin && canDelete ? { label: t("deleteWs"), icon: "trash", danger: true, onclick: async () => { if (!(await askConfirm(t("sure")))) return; await link.call("workspaces.delete", { id: cur.id }); await refresh(); } } : null,
  ];
  return (
    <MenuButton label={t("spaces")} entries={entries}
      buttonProps={{ className: "mx-2.5 mb-1 flex min-h-[var(--row)] items-center gap-2.5 rounded-sm border border-line bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-2.5 text-start hoverable group-data-[rail=true]/side:mx-2 group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0" }}>
      <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-md bg-accent text-xs font-bold text-on-accent">{(Array.from(name)[0] ?? "S").toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate group-data-[rail=true]/side:hidden" dir="auto">{name}</span>
      <Icon name="down" className="size-[15px] text-muted group-data-[rail=true]/side:hidden" />
    </MenuButton>
  );
}
