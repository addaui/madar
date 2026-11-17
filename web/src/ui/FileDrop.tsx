import { useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { BaseButton } from "./Button";

const hidden = "sr-only";

/**
 * A place to drop a file or click to choose one: a button that opens the system file picker (a hidden file input), and a drop target around it.
 * `accept` is a list of MIME types; only a file of one of them is passed on.
 */
export function FileDrop({ accept, onFile, label, isDisabled, children, className }: { accept: string[]; onFile: (file: File) => void; label: string; isDisabled?: boolean; children: ReactNode; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const take = (f: File | undefined | null) => { if (f && accept.includes(f.type)) onFile(f); };
  return (
    <div role="group" aria-label={label} data-drop-target={over || undefined}
      onDragOver={(e) => { if (isDisabled) return; if (Array.from(e.dataTransfer.items).some((i) => i.kind === "file" && accept.includes(i.type))) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!isDisabled) take(e.dataTransfer.files[0]); }}
      className={cn("grid rounded-md border-2 border-dashed border-line-strong text-muted-foreground data-[drop-target]:border-brand data-[drop-target]:bg-soft", className)}>
      <input ref={input} type="file" accept={accept.join(",")} className={hidden} tabIndex={-1} aria-hidden="true" disabled={isDisabled} onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
      <BaseButton isDisabled={isDisabled} onPress={() => input.current?.click()} className="grid place-items-center gap-1.5 rounded-md px-4 py-6 text-center hoverable">{children}</BaseButton>
    </div>
  );
}

/** A button that opens the file picker (no drop target). */
export function FilePicker({ accept, onFile, children }: { accept: string[]; onFile: (file: File) => void; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={accept.join(",")} className={hidden} tabIndex={-1} aria-hidden="true" onChange={(e) => { const f = e.target.files?.[0]; if (f && accept.includes(f.type)) onFile(f); e.target.value = ""; }} />
      <span onClick={() => input.current?.click()} role="presentation">{children}</span>
    </>
  );
}
