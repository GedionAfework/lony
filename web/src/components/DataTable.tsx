import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyBody?: string;
};

export function DataTable<T>({ columns, rows, rowKey, onRowClick, emptyTitle, emptyBody }: Props<T>) {
  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <EmptyState title={emptyTitle ?? 'Nothing here yet'} body={emptyBody} />
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ textAlign: c.align ?? 'left', width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(row)}>
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
