import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Banknote, Paperclip, Send, Smile, User as UserIcon } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type ChatMessage, type Conversation, type ConversationMoney } from '../lib/api';
import { formatMoney } from '../lib/format';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];
const COMPOSER_EMOJIS = ['😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😭', '😡', '👍', '👎', '❤️', '🔥', '🙏', '👏', '🎉', '✅', '💯', '🤝', '💪', '✨', '📌', '💰', '🏦', '📱'];

function conversationMoneyItems(c: Conversation): ConversationMoney[] {
  if (c.money?.length) return c.money;
  if (c.money_role && (c.active_loan_id || c.loan_id)) {
    return [{ loan_id: c.active_loan_id || c.loan_id || '', role: c.money_role, amount: c.money_amount, currency: c.money_currency, due_at: c.money_due_at }];
  }
  return [];
}

function attachmentLabel(msg: ChatMessage): string {
  if (msg.attachment_kind === 'voice') return 'Voice message';
  if (msg.attachment_kind === 'image') return 'Photo';
  if (msg.attachment_kind === 'file') return msg.attachment_name || 'File';
  return 'Message';
}

function formatDaysLeft(iso?: string | null): string {
  if (!iso) return 'No due date';
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return 'No due date';
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const days = Math.round((startDue.getTime() - startToday.getTime()) / 86400000);
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Due today';
  if (days === -1) return '1 day overdue';
  return `${Math.abs(days)} days overdue`;
}

export function ChatThreadPage() {
  const { peerId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [reactFor, setReactFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastCreated = useRef<string | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isSelfChat = peerId === user?.id;

  const openThread = useCallback(async () => {
    if (!token || !peerId) return;
    setLoading(true);
    try {
      const res = await api.openConversation(token, { peer_id: peerId });
      setConversation(res.conversation);
      const msgs = await api.listMessages(token, res.conversation.id);
      setMessages(msgs.messages ?? []);
      lastCreated.current = msgs.messages?.length ? msgs.messages[msgs.messages.length - 1].created_at : undefined;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not open chat');
    } finally {
      setLoading(false);
    }
  }, [token, peerId, showError]);

  useEffect(() => {
    void openThread();
  }, [openThread]);

  const refresh = useCallback(async () => {
    if (!token || !conversation) return;
    try {
      const res = await api.listMessages(token, conversation.id, lastCreated.current);
      const incoming = res.messages ?? [];
      if (!incoming.length) return;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of incoming) {
          if (!seen.has(m.id)) merged.push(m);
          else {
            const idx = merged.findIndex((x) => x.id === m.id);
            if (idx >= 0) merged[idx] = m;
          }
        }
        return merged;
      });
      lastCreated.current = incoming[incoming.length - 1]?.created_at ?? lastCreated.current;
    } catch {
      /* ignore poll errors */
    }
  }, [token, conversation]);

  useEffect(() => {
    if (!conversation) return;
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, [conversation, refresh]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function sendText() {
    if (!token || !conversation) return;
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      const res = await api.sendMessage(token, conversation.id, { body, reply_to_message_id: replyTo?.id });
      setDraft('');
      setReplyTo(null);
      setShowEmoji(false);
      setMessages((prev) => [...prev, res.message]);
      lastCreated.current = res.message.created_at;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }

  async function sendFile(file: File) {
    if (!token || !conversation) return;
    setBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const idx = result.indexOf(',');
          resolve(idx >= 0 ? result.slice(idx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const kind = file.type.startsWith('image/') ? 'image' : 'file';
      const res = await api.sendMessage(token, conversation.id, {
        reply_to_message_id: replyTo?.id,
        attachment_kind: kind,
        attachment_name: file.name,
        attachment_mime: file.type || 'application/octet-stream',
        attachment_base64: b64,
      });
      setReplyTo(null);
      setMessages((prev) => [...prev, res.message]);
      lastCreated.current = res.message.created_at;
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not send file');
    } finally {
      setBusy(false);
    }
  }

  async function react(msg: ChatMessage, emoji: string) {
    if (!token) return;
    try {
      const remove = msg.reactions.some((r) => r.emoji === emoji && r.mine);
      const res = await api.reactMessage(token, msg.id, emoji, remove);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? res.message : m)));
      setReactFor(null);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not react');
    }
  }

  if (loading) return <div className="page">Loading…</div>;
  if (!conversation) return <div className="page">Chat unavailable.</div>;

  const peerTitle = isSelfChat ? 'Self' : conversation.peer.display_name;
  const peerInitial = isSelfChat ? (user?.display_name || 'U').slice(0, 1).toUpperCase() : conversation.peer.display_name.slice(0, 1).toUpperCase();
  const money = conversationMoneyItems(conversation);

  return (
    <div className="page page-narrow chat-thread">
      <div className="thread-header">
        <Button variant="icon" aria-label="Back" onClick={() => navigate('/chats')}>
          ←
        </Button>
        <button className="peer-bubble" onClick={() => !isSelfChat && navigate(`/people/${conversation.peer.id}`)}>
          <div className="avatar" style={isSelfChat ? { background: 'var(--primary-soft)', color: 'var(--primary)' } : undefined}>
            {peerInitial}
          </div>
          <span style={{ fontWeight: 700 }}>{peerTitle}</span>
        </button>
        {!isSelfChat ? (
          <Button variant="icon" aria-label="View profile" onClick={() => navigate(`/people/${conversation.peer.id}`)}>
            <UserIcon size={17} />
          </Button>
        ) : null}
      </div>

      {money.length > 0 ? (
        <div className="flex-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {money.map((m) => {
            const lent = m.role === 'lent';
            return (
              <button
                key={m.loan_id}
                className="money-pin"
                style={{ borderColor: lent ? 'var(--success)' : 'var(--warning)', color: lent ? 'var(--success)' : 'var(--warning)' }}
                onClick={() => navigate(`/loans/${m.loan_id}`)}
              >
                <Banknote size={14} />
                {formatMoney(m.amount, m.currency)} · {formatDaysLeft(m.due_at)}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="thread-scroll">
        {messages.map((msg) => (
          <div key={msg.id} className={`bubble-wrap ${msg.mine ? 'mine' : 'theirs'}`} onDoubleClick={() => setReactFor(msg.id)}>
            {msg.reply_to ? <div className="reply-box">{msg.reply_to.body || attachmentLabel(msg.reply_to)}</div> : null}
            <div className="bubble-body">
              {msg.body ? msg.body : msg.attachment_kind === 'image' ? `Image · ${msg.attachment_name || 'Attachment'}` : msg.attachment_kind === 'file' ? `File · ${msg.attachment_name || 'Attachment'}` : ''}
              {msg.attachment_url && msg.attachment_kind === 'image' ? <img src={msg.attachment_url} alt={msg.attachment_name || 'Image'} className="chat-image" /> : null}
              <div className="time-corner">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            {msg.reactions?.length ? (
              <div className="reaction-row">
                {msg.reactions.map((r) => (
                  <button key={r.emoji} className={`reaction-chip ${r.mine ? 'mine' : ''}`} onClick={() => react(msg, r.emoji)}>
                    {r.emoji} {r.count}
                  </button>
                ))}
              </div>
            ) : null}
            <button className="reply-hint" onClick={() => setReplyTo(msg)}>
              Reply
            </button>
            {reactFor === msg.id ? (
              <div className="reaction-picker">
                {REACTION_EMOJIS.map((e) => (
                  <button key={e} onClick={() => react(msg, e)}>
                    {e}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {replyTo ? (
        <div className="reply-bar">
          <div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700 }}>Replying</div>
            <div className="muted" style={{ fontSize: 13 }}>{replyTo.body || attachmentLabel(replyTo)}</div>
          </div>
          <button className="link-btn" onClick={() => setReplyTo(null)}>
            Cancel
          </button>
        </div>
      ) : null}

      {showEmoji ? (
        <div className="emoji-bar">
          {COMPOSER_EMOJIS.map((e) => (
            <button key={e} onClick={() => setDraft((d) => d + e)}>
              {e}
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer">
        <button className="icon-btn" aria-label="Emoji" onClick={() => setShowEmoji((v) => !v)}>
          <Smile size={18} />
        </button>
        <input
          className="composer-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void sendText();
            }
          }}
        />
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && sendFile(e.target.files[0])} />
        <button className="icon-btn" aria-label="Attach file" onClick={() => fileInputRef.current?.click()}>
          <Paperclip size={18} />
        </button>
        <Button variant="icon" aria-label="Send" onClick={sendText} disabled={busy || !draft.trim()}>
          <Send size={17} />
        </Button>
      </div>
    </div>
  );
}
