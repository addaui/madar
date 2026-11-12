import { useRef, useState } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useHasOp } from "../api/session";
import { useT } from "../i18n/i18n";
import { uploadFile, type UploadStep } from "../lib/upload";
import { Button } from "./Button";

/** An image by address or from this computer. An upload shows what it is doing (reading, sending, saving) with a progress bar, and what went wrong. */
export function ImageDialog({ label, onDone }: { label: string; onDone: (url: string | null) => void }) {
  const t = useT();
  const canUpload = useHasOp("files.upload");
  const file = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<UploadStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null && !error;

  const upload = async (f: File) => {
    setError(null);
    try {
      const out = await uploadFile(f, setStep);
      setStep({ step: "save", fraction: 1 });
      onDone(out.url);
    } catch (e) {
      setError(e instanceof Error ? (e.message === "fileTooBig" ? t("fileTooBig") : e.message) : t("uploadFailed"));
    }
  };
  const pct = !step ? 0 : step.step === "read" ? step.fraction * 10 : step.step === "send" ? 10 + step.fraction * 80 : 95;
  const words = !step ? "" : step.step === "read" ? t("readingFile") : step.step === "send" ? `${t("sendingFile")} ${Math.round(step.fraction * 100)}%` : t("savingFile");

  return (
    <ModalOverlay isOpen isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={(o) => { if (!o && !busy) onDone(null); }} className="fixed inset-0 z-[60] grid place-items-start justify-center bg-scrim pt-[10vh] backdrop-blur-[3px]">
      <Modal className="w-[min(460px,94vw)] rounded-lg bg-surface p-5 shadow-2">
        <Dialog aria-label={label} className="outline-none">
          <form onSubmit={(e) => { e.preventDefault(); if (busy) return; const v = String(new FormData(e.currentTarget).get("url") ?? "").trim(); onDone(v || null); }}>
            <Heading slot="title" className="m-0 mb-3 text-lg font-semibold">{label}</Heading>
            <input name="url" type="text" autoFocus disabled={busy} placeholder="https://…" aria-label={t("imageAddr")} className="field w-full" />
            {canUpload && (
              <div className="mt-2.5">
                <Button icon="upload" disabled={busy} onClick={() => file.current?.click()}>{t("uploadImage")}</Button>
                <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
              </div>
            )}
            {(step || error) && (
              <div className="mt-3" aria-live="polite">
                <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="h-2 overflow-hidden rounded-full bg-sunken shadow-[inset_0_0_0_1px_var(--line)]">
                  <div className={error ? "h-full w-full rounded-full bg-danger" : step?.step === "save" ? "h-full w-1/3 animate-[progress-slide_1.1s_ease-in-out_infinite] rounded-full bg-accent" : "h-full rounded-full bg-accent transition-[width] duration-200"} ref={(el) => { if (el && !error && step?.step !== "save") el.style.width = pct + "%"; }} />
                </div>
                <div className={error ? "mt-1.5 text-[12.5px] text-danger" : "mt-1.5 text-[12.5px] text-muted"}>{error ?? words}</div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2"><Button disabled={busy} onClick={() => onDone(null)}>{t("cancel")}</Button><Button kind="primary" type="submit" disabled={busy}>{t("ok")}</Button></div>
          </form>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
