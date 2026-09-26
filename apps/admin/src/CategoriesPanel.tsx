import { FormEvent, useEffect, useState } from 'react';
import { api, type SystemCategory } from './api';

type Props = {
  token: string;
  onError: (message: string) => void;
};

export function CategoriesPanel({ token, onError }: Props) {
  const [rows, setRows] = useState<SystemCategory[]>([]);
  const [kind, setKind] = useState<'income' | 'expense' | ''>('');
  const [name, setName] = useState('');
  const [createKind, setCreateKind] = useState<'income' | 'expense'>('expense');
  const [busy, setBusy] = useState(false);

  async function reload() {
    setBusy(true);
    try {
      const res = await api.listCategories(token, kind);
      setRows(res.categories ?? []);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load categories');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, kind]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.createCategory(token, { kind: createKind, name: name.trim() });
      setName('');
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create category');
      setBusy(false);
    }
  }

  async function toggleActive(row: SystemCategory) {
    setBusy(true);
    try {
      await api.updateCategory(token, row.id, { active: !row.active });
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not update category');
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card row">
        <label>
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">All</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </label>
        <span className="muted">{rows.length} categories</span>
      </div>

      <form className="card row" onSubmit={onCreate}>
        <label>
          New kind
          <select
            value={createKind}
            onChange={(e) => setCreateKind(e.target.value as 'income' | 'expense')}
          >
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" />
        </label>
        <button className="btn primary" type="submit" disabled={busy || !name.trim()}>
          Add
        </button>
      </form>

      <div className="card" style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Slug</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.kind}</td>
                <td className="mono muted">{c.slug}</td>
                <td>
                  <span className={`badge ${c.active ? 'active' : 'suspended'}`}>
                    {c.active ? 'active' : 'off'}
                  </span>
                </td>
                <td>
                  <button className="btn" type="button" disabled={busy} onClick={() => toggleActive(c)}>
                    {c.active ? 'Disable' : 'Enable'}
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
