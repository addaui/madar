import type { Key, KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ColumnDef { id: string; label: string; className?: string; isRowHeader?: boolean }

/** A table whose rows can be activated (click, Enter or Space). A real `<table>`, so a screen reader reads rows and columns; with `onOpen` each row is a tab stop and the up and down arrows move between rows. */
export function DataTable<T extends { id: Key }>({ label, columns, rows, cell, onOpen, empty, className }: {
  label: string; columns: ColumnDef[]; rows: T[]; cell: (row: T, column: string) => ReactNode; onOpen?: (id: string) => void; empty?: ReactNode; className?: string;
}) {
  const key = (id: string) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(id); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const to = e.key === "ArrowDown" ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
      if (to instanceof HTMLElement) { e.preventDefault(); to.focus(); }
    }
  };
  return (
    <table aria-label={label} className={cn("w-full border-separate border-spacing-0 text-start", className)}>
      <thead>
        <tr>{columns.map((c) => <th key={c.id} scope="col" className={cn("border-b border-line px-3 py-2 text-start text-[12.5px] font-medium text-muted-foreground", c.className)}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-6 text-center text-muted-foreground">{empty}</td></tr>}
        {rows.map((row) => {
          const id = String(row.id);
          return (
            <tr key={id} tabIndex={onOpen ? 0 : undefined} onClick={onOpen ? () => onOpen(id) : undefined} onKeyDown={onOpen ? key(id) : undefined}
              className={cn("outline-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand", onOpen && "cursor-pointer")}>
              {columns.map((c) => c.isRowHeader
                ? <th key={c.id} scope="row" className="border-b border-line px-3 py-2 text-start font-normal">{cell(row, c.id)}</th>
                : <td key={c.id} className="border-b border-line px-3 py-2">{cell(row, c.id)}</td>)}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
