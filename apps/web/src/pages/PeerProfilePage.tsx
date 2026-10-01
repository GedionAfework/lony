import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, type PeerTrust, type SearchHit } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

export function PeerProfilePage() {
  const { peerId } = useParams();
  const navigate = useNavigate();
  const { user, token } = useAuth();
  const { showError } = useToast();
  const [peer, setPeer] = useState<SearchHit | null>(null);
  const [trust, setTrust] = useState<PeerTrust | null>(null);
  const [bondLabel, setBondLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
          setPeer({ id: hit.id, display_name: hit.display_name, username: hit.username ?? null });
          setBondLabel(hit.bond === 'close' ? 'Close connection' : hit.bond === 'friend' ? 'Friends' : 'Connected');
        } else {
          const friend = friendsRes?.friends?.find((fr) => fr.peer.id === peerId);
          if (friend) setPeer(friend.peer);
          setBondLabel(null);
        }
      })
      .catch(() => showError('Could not load profile'))
      .finally(() => setLoading(false));
  }, [token, peerId, showError]);

  if (loading) return <div className="page">Loading…</div>;

  const displayName = isSelf ? 'Self' : peer?.display_name || 'User';
  const initial = (isSelf ? user?.display_name || 'U' : displayName).slice(0, 1).toUpperCase();

  return (
    <div className="page page-narrow">
      <PageHeader title="Profile" back onBack={() => navigate(-1)} />
      <Card>
        <div className="flex-col" style={{ alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <div className="avatar" style={{ width: 72, height: 72, fontSize: 28, background: 'var(--primary-soft)', color: 'var(--primary)' }}>
            {initial}
          </div>
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
