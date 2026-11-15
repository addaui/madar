import { useEffect, useState } from "react";
import { useT } from "../i18n/i18n";
import { Button } from "./Button";
import { TextField } from "./Field";
import { ImageDialog } from "./ImageDialog";
import { RefDialog } from "./RefDialog";
import { notify, ToastHost } from "./Toast";
import { PointMenu } from "./Menu";
import { ModalFrame, ModalTitle } from "./Modal";
import { ProgressBar } from "./Progress";
import { connectOverlayHost, type OverlayRequest } from "./overlays";

export function OverlayHost() {
  const [req, setReq] = useState<Exclude<OverlayRequest, { kind: "toast" }> | null>(null);
  useEffect(() => {
    connectOverlayHost((r) => { if (r.kind === "toast") notify(r.text); else setReq(r); });
    return () => connectOverlayHost(null);
  }, []);
  return <><ToastHost />{req && <Request req={req} close={() => setReq(null)} />}</>;
}

function Request({ req, close }: { req: Exclude<OverlayRequest, { kind: "toast" }>; close: () => void }) {
  const t = useT();

  if (req.kind === "text") {
    return (
      <ModalFrame label={req.label} onClose={() => { req.resolve(null); close(); }} size="md">
        <form onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("text") ?? "").trim(); req.resolve(v || null); close(); }}>
          <ModalTitle className="mb-3">{req.label}</ModalTitle>
          <TextField name="text" autoFocus defaultValue={req.initial} dir="auto" label={req.label} />
          <div className="mt-4 flex justify-end gap-2">
            <Button onPress={() => { req.resolve(null); close(); }}>{t("cancel")}</Button>
            <Button kind="primary" type="submit">{t("ok")}</Button>
          </div>
        </form>
      </ModalFrame>
    );
  }

  if (req.kind === "confirm") {
    return (
      <ModalFrame label={req.label} role="alertdialog" onClose={() => { req.resolve(false); close(); }}>
        <ModalTitle className="mb-1.5 text-base">{t("sureTitle")}</ModalTitle>
        <p className="m-0 mb-4 text-muted" dir="auto">{req.label}</p>
        <div className="flex justify-end gap-2">
          <Button autoFocus onPress={() => { req.resolve(false); close(); }}>{req.cancel ?? t("cancel")}</Button>
          <Button kind={req.danger ? "danger" : "primary"} onPress={() => { req.resolve(true); close(); }}>{req.action ?? t("delete")}</Button>
        </div>
      </ModalFrame>
    );
  }

  if (req.kind === "countdown") return <Countdown label={req.label} seconds={req.seconds} done={(v) => { req.resolve(v); close(); }} />;

  if (req.kind === "ref") return <RefDialog onDone={(v) => { req.resolve(v); close(); }} />;
  if (req.kind === "image") return <ImageDialog label={req.label} onDone={(v) => { req.resolve(v); close(); }} />;

  return <PointMenu x={req.x} y={req.y} entries={req.items} onClose={close} />;
}

/** A bar that empties over the seconds, the number of seconds left, and a button that stops it. */
function Countdown({ label, seconds, done }: { label: string; seconds: number; done: (finished: boolean) => void }) {
  const t = useT();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.min(seconds * 1000, Date.now() - start)), 100);
    return () => clearInterval(id);
  }, [seconds]);
  useEffect(() => { if (elapsed >= seconds * 1000) done(true); }, [elapsed, seconds, done]);
  const left = Math.max(1, Math.ceil((seconds * 1000 - elapsed) / 1000));
  return (
    <ModalFrame label={label} role="alertdialog" onClose={() => done(false)}>
      <ModalTitle className="mb-1.5 text-base">{t("deletingIn", { n: left })}</ModalTitle>
      <p className="m-0 mb-3 text-muted" dir="auto">{label}</p>
      <ProgressBar label={t("deletingIn", { n: left })} value={100 - (elapsed / (seconds * 1000)) * 100} className="mb-4" />
      <div className="flex justify-end"><Button autoFocus onPress={() => done(false)}>{t("stop")}</Button></div>
    </ModalFrame>
  );
}
