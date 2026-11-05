import { useState, type ReactNode } from 'react';
import { FileJson, Plus, Search, X } from 'lucide-react';
import { Button } from './Button';
import { PermissionGate } from './PermissionGate';

export type StatusFilter = 'all' | 'active' | 'hidden';

export function statusOk(active: boolean, status: StatusFilter) {
  return status === 'all' || (status === 'active' ? active : !active);
}

type Props = {
  search: string;
  onSearch: (v: string) => void;
  placeholder: string;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  counts: { all: number; active: number };
  /** Extra filters rendered after the status switch (selects, segments…). */
  extra?: ReactNode;
  addLabel: string;
  addForm?: ReactNode;
  importer?: ReactNode;
  writePerm?: string;
};

/** One toolbar for every catalog list: search, status, filters, then add/import panels. */
export function CatalogBar({
  search,
  onSearch,
  placeholder,
  status,
  onStatus,
  counts,
  extra,
  addLabel,
  addForm,
  importer,
  writePerm = 'categories.write',
}: Props) {
  const [panel, setPanel] = useState<'add' | 'import' | null>(null);
  const hidden = counts.all - counts.active;

  return (
    <div className="catalog-bar">
      <div className="catalog-bar-row">
        <label className="catalog-search">
          <Search size={16} strokeWidth={2} />
          <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label="Search" />
          {search ? (
            <button type="button" onClick={() => onSearch('')} aria-label="Clear search">
              <X size={14} strokeWidth={2} />
            </button>
          ) : null}
        </label>

        <div className="seg" role="tablist" aria-label="Status">
          {(
            [
              ['all', 'All', counts.all],
              ['active', 'Active', counts.active],
              ['hidden', 'Hidden', hidden],
            ] as [StatusFilter, string, number][]
          ).map(([id, label, n]) => (
            <button key={id} type="button" role="tab" aria-selected={status === id} className={status === id ? 'active' : ''} onClick={() => onStatus(id)}>
              {label}
              <span className="seg-count">{n}</span>
            </button>
          ))}
        </div>

        {extra}

        <PermissionGate perm={writePerm}>
          <div className="catalog-bar-actions">
            {importer ? (
              <Button
                variant={panel === 'import' ? 'primary' : 'secondary'}
                icon={<FileJson size={15} strokeWidth={2} />}
                onClick={() => setPanel((p) => (p === 'import' ? null : 'import'))}
              >
                Import
              </Button>
            ) : null}
            {addForm ? (
              <Button
                variant={panel === 'add' ? 'secondary' : 'primary'}
                icon={panel === 'add' ? <X size={15} strokeWidth={2} /> : <Plus size={15} strokeWidth={2} />}
                onClick={() => setPanel((p) => (p === 'add' ? null : 'add'))}
              >
                {panel === 'add' ? 'Close' : addLabel}
              </Button>
            ) : null}
          </div>
        </PermissionGate>
      </div>

      {panel === 'add' && addForm ? <div className="catalog-bar-panel">{addForm}</div> : null}
      {panel === 'import' && importer ? <div className="catalog-bar-panel">{importer}</div> : null}
    </div>
  );
}
