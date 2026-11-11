import { useEffect, useState } from "react";
import { Dialog, Heading, Menu, MenuItem, Modal, ModalOverlay, Popover, Separator, SubmenuTrigger } from "react-aria-components";
import { useT } from "../i18n/i18n";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { ImageDialog } from "./ImageDialog";
import { RefDialog } from "./RefDialog";
import { connectOverlayHost, type MenuItems, type OverlayRequest } from "./overlays";

export function OverlayHost() {
  const t = useT();
  const [req, setReq] = useState<OverlayRequest | null>(null);
  useEffect(() => { connectOverlayHost(setReq); return () => connectOverlayHost(null); }, []);
  if (!req) return null;
  const close = () => setReq(null);

  if (req.kind === "text") {
    return (
      <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) { req.resolve(null); close(); } }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-[3px]">
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
      <ModalOverlay isOpen isDismissable onOpenChange={(o) => { if (!o) { req.resolve(false); close(); } }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-black/40 pt-[10vh] backdrop-blur-[3px]">
        <Modal className="w-[min(420px,94vw)] rounded-lg bg-surface p-5 shadow-2">
          <Dialog role="alertdialog" aria-label={req.label} className="outline-none">
            <Heading slot="title" className="m-0 mb-4 text-base font-semibold">{req.label}</Heading>
            <div className="flex justify-end gap-2">
              <Button autoFocus onClick={() => { req.resolve(false); close(); }}>{t("cancel")}</Button>
              <Button kind="danger" onClick={() => { req.resolve(true); close(); }}>{t("delete")}</Button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    );
  }

  if (req.kind === "ref") return <RefDialog onDone={(v) => { req.resolve(v); close(); }} />;
  if (req.kind === "image") return <ImageDialog label={req.label} onDone={(v) => { req.resolve(v); close(); }} />;

  // a context menu opens at a point: the popover's anchor is a virtual element at (x, y)
  const anchor = { getBoundingClientRect: () => new DOMRect(req.x, req.y, 0, 0), contextElement: document.body };
  return (
    <Popover isOpen onOpenChange={(o) => { if (!o) close(); }} triggerRef={{ current: anchor as unknown as HTMLElement }} placement="bottom start" className="z-[80] min-w-52 max-w-80 rounded-md border border-line-strong bg-surface p-1.5 shadow-2">
      <Menu aria-label="menu" className="outline-none" onAction={() => undefined} autoFocus="first">
        <Entries items={req.items} onDone={close} />
      </Menu>
    </Popover>
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
