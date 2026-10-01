import { Fragment, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Inbox, Loader2 } from 'lucide-react';

export type TableColumn<T> = {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string | number;
  mono?: boolean;
  muted?: boolean;
};

type Props<T> = {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  title?: ReactNode;
  subtitle?: ReactNode;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  isRowActive?: (row: T) => boolean;
  renderExpanded?: (row: T) => ReactNode;
  isExpanded?: (row: T) => boolean;
  loading?: boolean;
  emptyIcon?: LucideIcon;
  emptyMessage?: string;
  footer?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  title,
  subtitle,
  toolbar,
  onRowClick,
  isRowActive,
  renderExpanded,
  isExpanded,
  loading,
  emptyIcon: EmptyIcon = Inbox,
  emptyMessage = 'Nothing to show yet.',
  footer,
  className,
  compact,
}: Props<T>) {
  const colSpan = columns.length;

  return (
    <div className={['lt-table-card', className || ''].filter(Boolean).join(' ')}>
      {title || subtitle || toolbar ? (
        <div className="lt-table-head">
          <div className="lt-table-head-text">
            {title ? <h3 className="lt-table-title">{title}</h3> : null}
            {subtitle ? <p className="lt-table-subtitle">{subtitle}</p> : null}
          </div>
          {toolbar ? <div className="lt-table-toolbar">{toolbar}</div> : null}
        </div>
      ) : null}

      <div className="lt-table-scroll">
        <table className={['lt-table', compact ? 'lt-table-compact' : ''].filter(Boolean).join(' ')}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width, textAlign: col.align || 'left' }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`sk-${i}`} className="lt-table-skeleton-row">
                    {columns.map((col) => (
                      <td key={col.key}>
                        <span className="lt-skel" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}

            {rows.map((row) => {
              const key = rowKey(row);
              const active = Boolean(isRowActive?.(row));
              const expanded = Boolean(isExpanded?.(row));
              return (
                <Fragment key={key}>
                  <tr
                    className={[
                      onRowClick ? 'lt-clickable' : '',
                      active ? 'lt-row-active' : '',
                      expanded ? 'lt-row-expanded' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={[col.mono ? 'mono' : '', col.muted ? 'muted' : ''].filter(Boolean).join(' ') || undefined}
                        style={{ textAlign: col.align || 'left' }}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                  {expanded && renderExpanded ? (
                    <tr className="lt-expand-row">
                      <td colSpan={colSpan}>
                        <div className="lt-expand-body">{renderExpanded(row)}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {!loading && rows.length === 0 ? (
          <div className="lt-table-empty">
            <EmptyIcon size={28} strokeWidth={1.4} />
            <p>{emptyMessage}</p>
          </div>
        ) : null}

        {loading && rows.length > 0 ? (
          <div className="lt-table-loading-bar" aria-hidden>
            <Loader2 size={14} className="spin" />
          </div>
        ) : null}
      </div>

      {footer ? <div className="lt-table-footer">{footer}</div> : null}
    </div>
  );
}

export type Column<T> = TableColumn<T>;
export const DataTable = Table;
