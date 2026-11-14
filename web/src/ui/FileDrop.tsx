import type { ReactNode } from "react";
import { DropZone, FileTrigger, Text } from "react-aria-components";
import { cn } from "../lib/cn";
import { BaseButton } from "./Button";

/**
 * A place to drop a file or click to choose one (React Aria's DropZone and FileTrigger: keyboard, screen reader and the system file picker are handled).
 * `accept` is a list of MIME types; only a file of one of them is passed on.
 */
export function FileDrop({ accept, onFile, label, isDisabled, children, className }: { accept: string[]; onFile: (file: File) => void; label: string; isDisabled?: boolean; children: ReactNode; className?: string }) {
  const take = (f: File | undefined) => { if (f && accept.includes(f.type)) onFile(f); };
  return (
    <DropZone isDisabled={isDisabled} aria-label={label}
      getDropOperation={(types) => (accept.some((a) => types.has(a)) ? "copy" : "cancel")}
      onDrop={async (e) => { const item = e.items.find((i) => i.kind === "file"); if (item && item.kind === "file") take(await item.getFile()); }}
      className={cn("grid rounded-md border-2 border-dashed border-line-strong text-muted data-[drop-target]:border-accent data-[drop-target]:bg-soft data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent", className)}>
      <FileTrigger acceptedFileTypes={accept} onSelect={(files) => take(files?.[0])}>
        <BaseButton isDisabled={isDisabled} className="grid place-items-center gap-1.5 rounded-md px-4 py-6 text-center hoverable">{children}</BaseButton>
      </FileTrigger>
      <Text slot="label" className="sr-only">{label}</Text>
    </DropZone>
  );
}

/** A button that opens the file picker (no drop target). */
export function FilePicker({ accept, onFile, children }: { accept: string[]; onFile: (file: File) => void; children: ReactNode }) {
  return <FileTrigger acceptedFileTypes={accept} onSelect={(files) => { const f = files?.[0]; if (f && accept.includes(f.type)) onFile(f); }}>{children}</FileTrigger>;
}
