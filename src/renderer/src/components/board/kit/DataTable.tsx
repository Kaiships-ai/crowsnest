import React from 'react'
import { cn } from '@/lib/utils'

export type DataColumn<Row> = {
  id: string
  header: React.ReactNode
  align?: 'start' | 'end'
  cell: (row: Row) => React.ReactNode
}

/** A board table: mono header row, one bordered row per item, numbers right-aligned. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  testId,
  rowTestId,
  rowData
}: {
  columns: DataColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  testId?: string
  rowTestId?: string
  /** `data-*` attributes a journey or test reads off each row. */
  rowData?: (row: Row) => Record<`data-${string}`, string | undefined>
}): React.ReactNode {
  const align = (column: DataColumn<Row>): string =>
    column.align === 'end' ? 'text-right' : 'text-left'
  return (
    <table data-testid={testId} className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border font-mono text-2xs text-muted-foreground">
          {columns.map((column) => (
            <th key={column.id} className={cn('px-2 py-1 font-normal', align(column))}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={rowKey(row)}
            data-testid={rowTestId}
            data-row-key={rowKey(row)}
            {...rowData?.(row)}
            className="border-b border-border"
          >
            {columns.map((column) => (
              <td key={column.id} className={cn('px-2 py-1.5 align-top', align(column))}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
