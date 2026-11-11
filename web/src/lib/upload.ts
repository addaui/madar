import { NuahError } from "@nuah/link-client";
import { link } from "../api/link";

export type UploadStep = { step: "read" | "send" | "save"; fraction: number };
export interface Stored { id: string; url: string }

/**
 * Sends a file from this computer to the Core and reports the steps (reading, sending, saving) so the screen can show a progress bar.
 * Resolves with the stored file; throws a NuahError (or Error) the caller shows.
 */
export async function uploadFile(f: File, onStep: (s: UploadStep) => void, { maxBytes = 4 * 1024 * 1024, project }: { maxBytes?: number; project?: string } = {}): Promise<Stored> {
  if (f.size > maxBytes) throw new NuahError({ category: "invalid", message: "fileTooBig" });
  onStep({ step: "read", fraction: 0 });
  const data = await new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onprogress = (e) => { if (e.lengthComputable) onStep({ step: "read", fraction: e.loaded / e.total }); };
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => no(new Error("read"));
    r.readAsDataURL(f);
  });
  onStep({ step: "send", fraction: 0 });
  const out = await link.call("files.upload", { name: f.name, data, ...(project ? { project } : {}) } as never, { onProgress: (fr) => onStep({ step: fr >= 1 ? "save" : "send", fraction: fr }) }) as Stored;
  return out;
}
