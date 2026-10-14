import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api, type PeerTrust, type SearchHit } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Avatar } from '../components/Avatar';
import { useToast } from '../components/Toast';

export function PeerProfilePage() {
  const { peerId } = useParams();
  const navigate = useNavigate();
  const { user, token, setUser } = useAuth();
  const { showError } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [peer, setPeer] = useState<SearchHit | null>(null);
  const [trust, setTrust] = useState<PeerTrust | null>(null);
  const [bondLabel, setBondLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isSelf = peerId === user?.id;

  useEffect(() => {
    if (!token || !peerId) return;
    setLoading(true);
    Promise.all([
      api.getPeerTrust(token, peerId).catch(() => null),
      api.listPeers(token).catch(() => null),
      api.listFriends(token).catch(() => null),
    ])
      .then(([trustRes, peersRes, friendsRes]) => {
        setTrust(trustRes?.trust ?? null);
        const hit = peersRes?.peers?.find((p) => p.id === peerId);
        if (hit) {
          setPeer({
            id: hit.id,
            display_name: hit.display_name,
            username: hit.username ?? null,
            avatar_url: hit.avatar_url,
          });
          setBondLabel(hit.bond === 'close' ? 'Close connection' : hit.bond === 'friend' ? 'Friends' : 'Connected');
        } else {
          const friend = friendsRes?.friends?.find((fr) => fr.peer.id === peerId);
          if (friend) setPeer(friend.peer);
          else if (isSelf && user) {
            setPeer({
              id: user.id,
              display_name: user.display_name,
              username: user.username ?? null,
              avatar_url: user.avatar_url,
            });
          }
          setBondLabel(null);
        }
      })
      .catch(() => showError('Could not load profile'))
      .finally(() => setLoading(false));
  }, [token, peerId, showError, isSelf, user]);

  function onPickAvatar(file: File) {
    if (!token) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      const b64 = idx >= 0 ? result.slice(idx + 1) : result;
      setBusy(true);
      try {
        const res = await api.uploadAvatar(token, {
          filename: file.name,
          mime: file.type || 'image/jpeg',
          attachment_base64: b64,
        });
        setUser(res.user);
        setPeer((prev) => (prev ? { ...prev, avatar_url: res.user.avatar_url } : prev));
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Could not upload photo');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  if (loading) return <div className="page">Loading…</div>;

  const displayName = isSelf ? 'Self' : peer?.display_name || 'User';
  const initial = (isSelf ? user?.display_name || 'U' : displayName).slice(0, 1).toUpperCase();
  const photo = isSelf ? user?.avatar_url : peer?.avatar_url;

  return (
    <div className="page page-narrow">
      <PageHeader title="Profile" back onBack={() => navigate(-1)} />
      <Card>
        <div className="flex-col" style={{ alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <button
            type="button"
            onClick={() => isSelf && fileRef.current?.click()}
            disabled={!isSelf || busy}
            style={{
              position: 'relative',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: isSelf ? 'pointer' : 'default',
            }}
            aria-label={isSelf ? 'Change photo' : undefined}
          >
            <Avatar src={photo} token={token} letter={initial} size={88} />
            {isSelf ? (
              <span
                style={{
                  position: 'absolute',
                  right: 0,
                  bottom: 0,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  background: 'var(--primary)',
                  color: 'var(--on-primary)',
                  display: 'grid',
                  placeItems: 'center',
                  border: '2px solid var(--surface)',
                }}
              >
                <Camera size={13} />
              </span>
            ) : null}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onPickAvatar(e.target.files[0])}
          />
          <div style={{ fontWeight: 800, fontSize: 20 }}>{displayName}</div>
          {peer?.username ? <div className="muted">@{peer.username}</div> : null}
          {bondLabel && !isSelf ? <div style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 13 }}>{bondLabel}</div> : null}
          {trust ? (
            <div className="flex-col" style={{ alignItems: 'center', gap: 4, marginTop: 4 }}>
              <div style={{ color: 'var(--primary)', fontWeight: 800, fontSize: 36 }}>{trust.grade}</div>
              <div style={{ fontWeight: 700 }}>Lony Trust · {trust.band}</div>
              <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                {trust.available
                  ? `Repayment ${Math.round(trust.repayment_score)}${trust.thin_history ? ' · limited history' : ''} · ${trust.loan_sample_size} loan${trust.loan_sample_size === 1 ? '' : 's'} on Lony`
                  : 'Not enough Lony activity to grade yet'}
              </div>
            </div>
          ) : null}
        </div>
        <Button onClick={() => navigate(`/chats/${peerId}`)} block>
          Message
        </Button>
        {!isSelf ? (
          <Button variant="secondary" onClick={() => navigate(`/loans/new?peer=${peerId}&role=lender`)} block>
            New loan
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
