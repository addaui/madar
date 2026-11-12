import { useEffect, useState } from "react";
import { Dialog, Heading, Menu, MenuItem, Modal, ModalOverlay, Popover, Separator, SubmenuTrigger } from "react-aria-components";
import { useT } from "../i18n/i18n";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ImageDialog } from "./ImageDialog";
import { RefDialog } from "./RefDialog";
import { connectOverlayHost, type MenuItems, type OverlayRequest } from "./overlays";

export function OverlayHost() {
  const [req, setReq] = useState<Exclude<OverlayRequest, { kind: "toast" }> | null>(null);
  const [notes, setNotes] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    connectOverlayHost((r) => {
      if (r.kind !== "toast") { setReq(r); return; }
      const id = ++noteId;
      setNotes((n) => [...n, { id, text: r.text }]);
      setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 3600);
    });
    return () => connectOverlayHost(null);
  }, []);
  const toasts = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[90] grid justify-center gap-2">
      {notes.map((n) => <div key={n.id} className="rounded-btn bg-text px-3.5 py-2 text-[13px] text-bg shadow-2">{n.text}</div>)}
    </div>
  );
  if (!req) return toasts;
  const close = () => setReq(null);
  return <>{toasts}<Request req={req} close={close} /></>;
}

let noteId = 0;

function Request({ req, close }: { req: Exclude<OverlayRequest, { kind: "toast" }>; close: () => void }) {
  const t = useT();

  if (req.kind === "text") {
    return (
      <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) { req.resolve(null); close(); } }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-scrim pt-[10vh] backdrop-blur-[3px]">
        <Modal className="w-[min(460px,94vw)] rounded-lg bg-surface p-5 shadow-2">
          <Dialog aria-label={req.label} className="outline-none">
            <form onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("text") ?? "").trim(); req.resolve(v || null); close(); }}>
              <Heading slot="title" className="m-0 mb-3 text-lg font-semibold">{req.label}</Heading>
              <input name="text" type="text" autoFocus defaultValue={req.initial} dir="auto" aria-label={req.label} className="field w-full" />
              <div className="mt-4 flex justify-end gap-2">
                <Button onClick={() => { req.resolve(null); close(); }}>{t("cancel")}</Button>
                <Button kind="primary" type="submit">{t("ok")}</Button>
              </div>
            </form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }

  if (req.kind === "confirm") {
    return (
      <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) { req.resolve(false); close(); } }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-scrim pt-[10vh] backdrop-blur-[3px]">
        <Modal className="w-[min(420px,94vw)] rounded-lg bg-surface p-5 shadow-2">
          <Dialog role="alertdialog" aria-label={req.label} className="outline-none">
            <Heading slot="title" className="m-0 mb-1.5 text-base font-semibold">{t("sureTitle")}</Heading>
            <p className="m-0 mb-4 text-muted" dir="auto">{req.label}</p>
            <div className="flex justify-end gap-2">
              <Button autoFocus onClick={() => { req.resolve(false); close(); }}>{t("cancel")}</Button>
              <Button kind={req.danger ? "danger" : "primary"} onClick={() => { req.resolve(true); close(); }}>{req.action ?? t("delete")}</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }

  if (req.kind === "ref") return <RefDialog onDone={(v) => { req.resolve(v); close(); }} />;
  if (req.kind === "image") return <ImageDialog label={req.label} onDone={(v) => { req.resolve(v); close(); }} />;

  return <ContextMenu x={req.x} y={req.y} items={req.items} close={close} />;
}

/** A context menu opens at a point. React Aria positions against a real element, so a zero-size fixed anchor sits at (x, y); its position is set through the CSSOM because the CSP forbids style attributes. */
function ContextMenu({ x, y, items, close }: { x: number; y: number; items: MenuItems; close: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <span aria-hidden="true" ref={(el) => { if (el) { el.style.position = "fixed"; el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = "0"; el.style.height = "0"; } setAnchor(el); }} />
      {anchor && (
        <Popover isOpen onOpenChange={(o) => { if (!o) close(); }} triggerRef={{ current: anchor }} placement="bottom start" className="z-[80] min-w-52 max-w-80 rounded-md border border-line-strong bg-surface p-1.5 shadow-2">
          <Menu aria-label="menu" className="outline-none" onAction={() => undefined} autoFocus="first">
            <Entries items={items} onDone={close} />
          </Menu>
        </Popover>
      )}
    </>
  );
}

function Entries({ items, onDone }: { items: MenuItems; onDone: () => void }) {
  return items.map((e, i) => {
    if (!e) return null;
    if (e === "-") return <Separator key={i} className="my-1 h-px bg-line" />;
    const row = (
      <>
        {e.icon ? <Icon name={e.icon} className="size-4 text-muted" /> : <span className="size-4" />}
        <span className="grow truncate" dir="auto">{e.label}</span>
        {e.checked && <Icon name="check" className="size-4 text-accent" />}
        {e.sub && <Icon name="chevron" className="size-4 text-muted" />}
      </>
    );
    const cls = "flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5 outline-none focus:bg-hover data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 " + (e.danger ? "text-danger" : "");
    if (e.sub) {
      const sub = e.sub;
      return (
        <SubmenuTrigger key={i}>
          <MenuItem textValue={e.label} className={cls}>{row}</MenuItem>
          <Popover className="z-[80] min-w-48 rounded-md border border-line-strong bg-surface p-1.5 shadow-2"><Menu className="outline-none"><Entries items={sub()} onDone={onDone} /></Menu></Popover>
        </SubmenuTrigger>
      );
    }
    return <MenuItem key={i} textValue={e.label} isDisabled={e.disabled} className={cls} onAction={() => { onDone(); e.onclick?.(); }}>{row}</MenuItem>;
  });
}
