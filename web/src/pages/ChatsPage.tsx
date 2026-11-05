import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type Conversation, type Friendship } from '../lib/api';
import { formatMoney } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { Avatar } from '../components/Avatar';
import { useConfirm } from '../components/Confirm';

function formatChatListTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday.getTime() - startMsg.getTime()) / 86400000);
  if (dayDiff <= 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (dayDiff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatsPage() {
  const { user, token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const confirm = useConfirm();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friends, setFriends] = useState<Friendship[]>([]);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    async function load() {
      try {
        const [convRes, friendRes] = await Promise.all([api.listConversations(token!), api.listFriends(token!)]);
        if (stop) return;
        setConversations(convRes.conversations ?? []);
        setFriends(friendRes.friends ?? []);
      } catch (e) {
        if (!stop) showError(e instanceof Error ? e.message : 'Could not load chats');
      }
    }
    void load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token, showError]);

  async function onDeleteChat(c: Conversation) {
    if (!token) return;
    const self = c.peer.id === user?.id;
    const ok = await confirm({
      title: self ? 'Clear saved messages?' : `Delete chat with ${c.peer.display_name}?`,
      body: self ? 'All your saved messages here will be removed.' : `Messages are removed for you only. ${c.peer.display_name} keeps their copy.`,
      confirmLabel: self ? 'Clear' : 'Delete chat',
      tone: 'danger',
    });
    if (!ok) return;
    const before = conversations;
    setConversations((list) => list.filter((x) => x.id !== c.id));
    try {
      await api.deleteConversation(token, c.id);
    } catch (e) {
      setConversations(before);
      showError(e instanceof Error ? e.message : 'Could not delete chat');
    }
  }

  if (!user) return null;

  const peerIds = new Set(conversations.map((c) => c.peer.id));
  const startRows = friends.filter((f) => !peerIds.has(f.peer.id));
  const byPeer = new Map<string, Conversation>();
  const selfConv = conversations.find((c) => c.peer.id === user.id);
  for (const c of conversations.filter((c) => c.peer.id !== user.id)) {
    const existing = byPeer.get(c.peer.id);
    if (!existing || (!c.loan_id && existing.loan_id)) byPeer.set(c.peer.id, c);
  }
  const threadRows = Array.from(byPeer.values()).sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));

  return (
    <div className="page page-narrow">
      <PageHeader
        title="Chats"
        right={
          <Button variant="secondary" onClick={() => navigate('/chats/search')}>
            <Search size={15} /> Find people
          </Button>
        }
      />

      <Card tight>
        <div className="list-row clickable-row" onClick={() => navigate(`/chats/${user.id}`)}>
          <div
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/people/${user.id}`);
            }}
          >
            <Avatar src={user.avatar_url} token={token} letter={user.display_name || 'U'} />
          </div>
          <div className="main">
            <div className="title">Self</div>
            <div className="sub">{selfConv?.last_message_preview || 'Notes and things to keep for yourself'}</div>
          </div>
          <div className="flex-col chat-meta">
            {selfConv?.last_message_at ? <span className="muted" style={{ fontSize: 11 }}>{formatChatListTime(selfConv.last_message_at)}</span> : null}
            {selfConv ? (
              <button className="icon-btn sm ghost chat-del" aria-label="Clear saved messages" title="Clear saved messages" onClick={(e) => { e.stopPropagation(); void onDeleteChat(selfConv); }}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        </div>

        {startRows.map((f) => (
          <div key={f.peer.id} className="list-row clickable-row" onClick={() => navigate(`/chats/${f.peer.id}`)}>
            <div
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/people/${f.peer.id}`);
              }}
            >
              <Avatar src={f.peer.avatar_url} token={token} letter={f.peer.display_name} />
            </div>
            <div className="main">
              <div className="title">{f.peer.display_name}</div>
              <div className="sub">Start chat</div>
            </div>
          </div>
        ))}

        {threadRows.map((c) => {
          const money = c.money?.length ? c.money : c.money_role && (c.active_loan_id || c.loan_id) ? [{ loan_id: c.active_loan_id || c.loan_id || '', role: c.money_role, amount: c.money_amount, currency: c.money_currency }] : [];
          return (
            <div key={c.id} className="list-row clickable-row" onClick={() => navigate(`/chats/${c.peer.id}`)}>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/people/${c.peer.id}`);
                }}
              >
                <Avatar src={c.peer.avatar_url} token={token} letter={c.peer.display_name} />
              </div>
              <div className="main">
                <div className="title flex-row" style={{ gap: 6 }}>
                  {c.peer.display_name}
                  {money.map((m) => (
                    <span key={m.loan_id} className={`pill pill-${m.role === 'lent' ? 'success' : 'warning'}`} style={{ fontSize: 11 }}>
                      {formatMoney(m.amount, m.currency)}
                    </span>
                  ))}
                </div>
                <div className="sub">{c.last_message_preview || '—'}</div>
              </div>
              <div className="flex-col chat-meta">
                <span className="muted" style={{ fontSize: 11 }}>{formatChatListTime(c.last_message_at)}</span>
                {c.last_message_mine && c.last_message_preview ? (
                  <span className={`ticks ${c.last_message_read ? 'read' : ''}`} title={c.last_message_read ? 'Read' : 'Sent'}>
                    {c.last_message_read ? '✓✓' : '✓'}
                  </span>
                ) : c.unread_count > 0 ? (
                  <span className="count-badge">{c.unread_count > 99 ? '99+' : c.unread_count}</span>
                ) : null}
                <button className="icon-btn sm ghost chat-del" aria-label="Delete chat" title="Delete chat" onClick={(e) => { e.stopPropagation(); void onDeleteChat(c); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}

        {startRows.length === 0 && threadRows.length === 0 ? (
          <EmptyState title="No conversations yet" body="Search for someone to start chatting." />
        ) : null}
      </Card>
    </div>
  );
}
