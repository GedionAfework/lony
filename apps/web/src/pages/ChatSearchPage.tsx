import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, type SearchHit } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';

export function ChatSearchPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const req = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const id = ++req.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const looksPhone = /^\+?[\d\s()-]{6,}$/.test(q);
        if (looksPhone) {
          const phone = q.startsWith('+') ? q.replace(/[^\d+]/g, '') : q.replace(/\D/g, '');
          const e164 = phone.startsWith('+') ? phone : `+${phone}`;
          const byPhone = await api.lookupPhone(token, e164);
          if (id !== req.current) return;
          if (byPhone.found && byPhone.user) {
            setHits([byPhone.user]);
            return;
          }
        }
        const res = await api.searchUsers(token, q);
        if (id !== req.current) return;
        setHits(res.users ?? []);
      } catch (e) {
        if (id !== req.current) return;
        showError(e instanceof Error ? e.message : 'Search failed');
        setHits([]);
      } finally {
        if (id === req.current) setBusy(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, token, showError]);

  return (
    <div className="page page-narrow">
      <PageHeader title="Find people" back onBack={() => navigate('/chats')} />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Username or phone"
        style={{ height: 48, width: '100%', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface-muted)', color: 'var(--text)', padding: '0 14px', fontSize: 15 }}
      />
      {busy ? <div className="spinner" style={{ marginTop: 12 }} /> : null}
      <div className="flex-col" style={{ marginTop: 12 }}>
        {hits.map((hit) => (
          <div key={hit.id} className="list-row clickable-row" onClick={() => navigate(`/chats/${hit.id}`)}>
            <div className="avatar">{hit.display_name.slice(0, 1).toUpperCase()}</div>
            <div className="main">
              <div className="title">{hit.display_name}</div>
              {hit.username ? <div className="sub">@{hit.username}</div> : null}
            </div>
          </div>
        ))}
        {!busy && query.trim().length >= 2 && hits.length === 0 ? <EmptyState title="No matches" body="Try a different username or phone number." /> : null}
      </div>
    </div>
  );
}
