import type { ReactNode } from "react";
import { Cell, Column, Row, Table as AriaTable, TableBody, TableHeader, type Key } from "react-aria-components";
import { cn } from "../lib/cn";

export interface ColumnDef { id: string; label: string; className?: string; isRowHeader?: boolean }

/** A table whose rows can be activated (click, Enter): React Aria's grid, so arrows move between cells and a screen reader reads rows and columns. */
export function DataTable<T extends { id: Key }>({ label, columns, rows, cell, onOpen, empty, className }: {
  label: string; columns: ColumnDef[]; rows: T[]; cell: (row: T, column: string) => ReactNode; onOpen?: (id: string) => void; empty?: ReactNode; className?: string;
}) {
  return (
    <AriaTable aria-label={label} onRowAction={onOpen ? (k) => onOpen(String(k)) : undefined} className={cn("w-full border-separate border-spacing-0 text-start", className)}>
      <TableHeader>
        {columns.map((c) => <Column key={c.id} id={c.id} isRowHeader={c.isRowHeader} className={cn("border-b border-line px-3 py-2 text-start text-[12.5px] font-medium text-muted", c.className)}>{c.label}</Column>)}
      </TableHeader>
      <TableBody items={rows} renderEmptyState={() => <span className="block px-3 py-6 text-center text-muted">{empty}</span>}>
        {(row) => (
          <Row id={row.id} columns={columns} className="cursor-pointer outline-none data-[focus-visible]:outline-2 data-[focus-visible]:-outline-offset-2 data-[focus-visible]:outline-accent data-[hovered]:bg-hover">
            {(c) => <Cell className="border-b border-line px-3 py-2">{cell(row, c.id)}</Cell>}
          </Row>
        )}
      </TableBody>
    </AriaTable>
  );
}
