import { useState } from "react";
import { useHasOp } from "../api/session";
import { useT } from "../i18n/i18n";
import { uploadFile, type UploadStep } from "../lib/upload";
import { Button } from "./Button";
import { TextField } from "./Field";
import { FilePicker } from "./FileDrop";
import { ModalFrame, ModalTitle } from "./Modal";
import { ProgressBar } from "./Progress";

/** An image by address or from this computer. An upload shows what it is doing (reading, sending, saving) with a progress bar, and what went wrong. */
export function ImageDialog({ label, onDone }: { label: string; onDone: (url: string | null) => void }) {
  const t = useT();
  const canUpload = useHasOp("files.upload");
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
    <ModalFrame label={label} onClose={() => onDone(null)} size="md" dismissable={!busy}>
          <form onSubmit={(e) => { e.preventDefault(); if (busy) return; const v = String(new FormData(e.currentTarget).get("url") ?? "").trim(); onDone(v || null); }}>
            <ModalTitle className="mb-3">{label}</ModalTitle>
            <TextField name="url" autoFocus isDisabled={busy} placeholder="https://…" label={t("imageAddr")} />
            {canUpload && (
              <div className="mt-2.5">
                <FilePicker accept={["image/png", "image/jpeg", "image/gif", "image/webp"]} onFile={(f) => void upload(f)}><Button icon="upload" isDisabled={busy}>{t("uploadImage")}</Button></FilePicker>
              </div>
            )}
            {(step || error) && (
              <div className="mt-3" aria-live="polite">
                <ProgressBar label={words || t("sendingFile")} value={error || step?.step === "save" ? (error ? 100 : undefined) : pct} className={error ? "[&>span]:bg-danger" : undefined} />
                <div className={error ? "mt-1.5 text-[12.5px] text-danger" : "mt-1.5 text-[12.5px] text-muted"}>{error ?? words}</div>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2"><Button isDisabled={busy} onPress={() => onDone(null)}>{t("cancel")}</Button><Button kind="primary" type="submit" isDisabled={busy}>{t("ok")}</Button></div>
          </form>
    </ModalFrame>
  );
}
