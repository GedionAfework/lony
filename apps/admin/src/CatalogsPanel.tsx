import { FormEvent, useEffect, useState } from 'react';
import {
  api,
  type CatalogInstitution,
  type CatalogType,
} from './api';

type Props = {
  token: string;
  onError: (message: string) => void;
};

export function CatalogsPanel({ token, onError }: Props) {
  const [types, setTypes] = useState<CatalogType[]>([]);
  const [institutions, setInstitutions] = useState<CatalogInstitution[]>([]);
  const [kindFilter, setKindFilter] = useState<'account_type' | 'institution_type' | ''>('account_type');
  const [typeCodeFilter, setTypeCodeFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [typeLabel, setTypeLabel] = useState('');
  const [typeKind, setTypeKind] = useState<'account_type' | 'institution_type'>('account_type');
  const [instLabel, setInstLabel] = useState('');
  const [instTypeKind, setInstTypeKind] = useState<'account_type' | 'institution_type'>('account_type');
  const [instTypeCode, setInstTypeCode] = useState('bank');
  const [instCountry, setInstCountry] = useState('');

  async function reload() {
    setBusy(true);
    try {
      const [t, i] = await Promise.all([
        api.listCatalogTypes(token, kindFilter),
        api.listCatalogInstitutions(token, kindFilter || '', typeCodeFilter),
      ]);
      setTypes(t.types ?? []);
      setInstitutions(i.institutions ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load catalogs');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kindFilter, typeCodeFilter]);

  async function onCreateType(e: FormEvent) {
    e.preventDefault();
    if (!typeLabel.trim()) return;
    setBusy(true);
    try {
      await api.createCatalogType(token, { kind: typeKind, label: typeLabel.trim() });
      setTypeLabel('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create type');
      setBusy(false);
    }
  }

  async function onCreateInstitution(e: FormEvent) {
    e.preventDefault();
    if (!instLabel.trim() || !instTypeCode.trim()) return;
    setBusy(true);
    try {
      await api.createCatalogInstitution(token, {
        label: instLabel.trim(),
        type_kind: instTypeKind,
        type_code: instTypeCode.trim(),
        country_code: instCountry.trim() || undefined,
      });
      setInstLabel('');
      setInstCountry('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create institution');
      setBusy(false);
    }
  }

  async function toggleType(row: CatalogType) {
    setBusy(true);
    try {
      await api.updateCatalogType(token, row.id, { active: !row.active });
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update type');
      setBusy(false);
    }
  }

  async function toggleInstitution(row: CatalogInstitution) {
    setBusy(true);
    try {
      await api.updateCatalogInstitution(token, row.id, { active: !row.active });
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update institution');
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <label>
          Type kind
          <select
            value={kindFilter}
            onChange={(e) => {
              setKindFilter(e.target.value as typeof kindFilter);
              setTypeCodeFilter('');
            }}
          >
            <option value="">All</option>
            <option value="account_type">Account types</option>
            <option value="institution_type">Institution types</option>
          </select>
        </label>
        <label>
          Institution type code
          <input
            value={typeCodeFilter}
            onChange={(e) => setTypeCodeFilter(e.target.value)}
            placeholder="e.g. bank"
          />
        </label>
        <button type="button" className="btn" disabled={busy} onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <form className="card stack" onSubmit={onCreateType}>
          <strong>Add type</strong>
          <p className="muted" style={{ margin: 0 }}>
            Account types (bank, wallet…) or lender institution types.
          </p>
          <label>
            Kind
            <select
              value={typeKind}
              onChange={(e) => setTypeKind(e.target.value as typeof typeKind)}
            >
              <option value="account_type">Account type</option>
              <option value="institution_type">Institution type</option>
            </select>
          </label>
          <label>
            Label
            <input value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} required />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            Create type
          </button>
        </form>

        <form className="card stack" onSubmit={onCreateInstitution}>
          <strong>Add institution</strong>
          <p className="muted" style={{ margin: 0 }}>
            Global by default. Optional country code for regional hints later.
          </p>
          <label>
            Applies to
            <select
              value={instTypeKind}
              onChange={(e) => setInstTypeKind(e.target.value as typeof instTypeKind)}
            >
              <option value="account_type">Account type</option>
              <option value="institution_type">Institution type</option>
            </select>
          </label>
          <label>
            Type code
            <input value={instTypeCode} onChange={(e) => setInstTypeCode(e.target.value)} required />
          </label>
          <label>
            Label
            <input value={instLabel} onChange={(e) => setInstLabel(e.target.value)} required />
          </label>
          <label>
            Country (optional)
            <input
              value={instCountry}
              onChange={(e) => setInstCountry(e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="US"
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            Create institution
          </button>
        </form>
      </div>

      <div className="card">
        <strong>Types ({types.length})</strong>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Code</th>
              <th>Label</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {types.map((row) => (
              <tr key={row.id}>
                <td>{row.kind}</td>
                <td>
                  <code>{row.code}</code>
                </td>
                <td>{row.label}</td>
                <td>{row.active ? 'yes' : 'no'}</td>
                <td>
                  <button type="button" className="btn" disabled={busy} onClick={() => void toggleType(row)}>
                    {row.active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong>Institutions ({institutions.length})</strong>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Code</th>
              <th>Label</th>
              <th>Country</th>
              <th>Active</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {institutions.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.type_kind}/{row.type_code}
                </td>
                <td>
                  <code>{row.code}</code>
                </td>
                <td>{row.label}</td>
                <td>{row.country_code || '—'}</td>
                <td>{row.active ? 'yes' : 'no'}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void toggleInstitution(row)}
                  >
                    {row.active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
