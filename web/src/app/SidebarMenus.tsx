import { useQueryClient } from "@tanstack/react-query";
import { link } from "../api/link";
import { useRead } from "../api/hooks";
import { useHasOp } from "../api/session";
import { askConfirm, askCountdown, askText } from "../ui/overlays";
import { useT } from "../i18n/i18n";
import { Icon } from "../ui/Icon";
import { MenuButton, type MenuEntries } from "../ui/Menu";
import { PopupButton } from "../ui/Popup";
import { openDialog } from "./dialogs";
import { Inbox } from "./Inbox";
import { spaceState, usePersistedValue } from "./ui-state";

/** The sidebar's two menus. They carry the accessible-menu library, so the sidebar loads them after first paint. */
export function BellMenu() {
  const t = useT();
  const unread = useRead("inbox.list", { limit: 30 }).data.unread;
  return (
    <PopupButton label={t("inbox") + (unread ? ` (${unread})` : "")} width={340}
      buttonProps={{ className: "relative inline-grid size-[var(--hit)] shrink-0 place-items-center rounded-sm text-muted-foreground hoverable hover:text-text data-[popup-open]:bg-soft" }}
      trigger={<><Icon name="bell" />{unread > 0 && <span className="absolute end-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? "9+" : unread}</span>}</>}>
      <Inbox />
    </PopupButton>
  );
}

export function SpacesMenu() {
  const t = useT();
  const ws = useRead("spaces.list").data;
  const qc = useQueryClient();
  const current = usePersistedValue(spaceState);
  const canCreate = useHasOp("spaces.create"), canRename = useHasOp("spaces.rename"), canDelete = useHasOp("spaces.delete"), canLeave = useHasOp("spaces.leave");
  const cur = ws.spaces.find((w) => w.id === current) ?? ws.spaces[0];
  if (!cur) return null;
  const name = cur.builtin ? t("mySpace") : cur.name;
  const refresh = () => qc.invalidateQueries();
  // Deleting a Space takes its projects with it, so it is asked twice: a plain yes or no, then a countdown that can still be stopped.
  const deleteSpace = async (warning: string) => {
    if (!(await askConfirm(warning, { action: t("yes"), cancel: t("no") }))) return;
    if (!(await askCountdown(cur.name))) return;
    await link.call("spaces.delete", { space: cur.id, cascade: true });
    spaceState.set("default");
    await refresh();
  };
  const entries: MenuEntries = [
    ...ws.spaces.map((w) => ({ label: w.builtin ? t("mySpace") : w.name, icon: "folder", checked: w.id === cur.id, onclick: () => { spaceState.set(w.id); void refresh(); } })),
    canCreate ? "-" : null,
    canCreate ? { label: t("newWorkspace"), icon: "plus", onclick: async () => {
      const n = await askText(t("newWorkspace"));
      if (!n) return;
      const w = await link.call("spaces.create", { name: n }) as { id?: string };
      if (w.id) spaceState.set(w.id);
      await refresh();
    } } : null,
    !cur.builtin ? "-" : null,
    !cur.builtin ? { label: t("spaceMembers"), icon: "mention", onclick: () => openDialog("spaceMembers") } : null,
    !cur.builtin && cur.role === "admin" ? { label: t("spaceFeatures"), icon: "layers", onclick: () => openDialog("spaceFeatures") } : null,
    !cur.builtin && canLeave ? { label: t("leaveSpace"), icon: "close", onclick: async () => {
      if (!(await askConfirm(t("sure")))) return;
      try { await link.call("spaces.leave", { space: cur.id }); spaceState.set("default"); await refresh(); } catch (e) {
        // the last admin cannot just go: the Space would be left with nobody, so leaving means deleting it
        if ((e as { reason?: string }).reason !== "spaces.last_admin") throw e;
        await deleteSpace(t("leaveDeletesSpace"));
      }
    } } : null,
    !cur.builtin && canRename ? { label: t("renameWs"), icon: "edit", onclick: async () => { const n = await askText(t("renameWs"), cur.name); if (n) { await link.call("spaces.rename", { space: cur.id, name: n }); await refresh(); } } } : null,
    !cur.builtin && canDelete ? { label: t("deleteWs"), icon: "trash", danger: true, onclick: () => void deleteSpace(t("deleteSpaceWarn")) } : null,
  ];
  return (
    <MenuButton label={t("spaces")} entries={entries}
      buttonProps={{ className: "mx-2.5 mb-1 flex min-h-[var(--row)] items-center gap-2.5 rounded-sm border border-line bg-[color-mix(in_srgb,var(--surface)_60%,transparent)] px-2.5 text-start hoverable group-data-[rail=true]/side:mx-2 group-data-[rail=true]/side:justify-center group-data-[rail=true]/side:px-0" }}>
      <span aria-hidden="true" className="grid size-[22px] shrink-0 place-items-center rounded-md bg-brand text-xs font-bold text-brand-foreground">{(Array.from(name)[0] ?? "S").toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate group-data-[rail=true]/side:hidden" dir="auto">{name}</span>
      <Icon name="down" className="size-[15px] text-muted-foreground group-data-[rail=true]/side:hidden" />
    </MenuButton>
  );
}
