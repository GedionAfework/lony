import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PeerTrust } from './api';
import { api } from './api';
import { IconBack } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { Card, PrimaryButton, SecondaryButton } from './ui';

type Peer = {
  id: string;
  display_name: string;
  username?: string | null;
};

type Props = {
  token: string;
  peer: Peer;
  isSelf?: boolean;
  selfInitial?: string;
  onBack: () => void;
  onMessage: () => void;
  onCreateLoan?: () => void;
};

export function PeerProfileScreen({
  token,
  peer,
  isSelf,
  selfInitial,
  onBack,
  onMessage,
  onCreateLoan,
}: Props) {
  const { colors } = useTheme();
  const avatarLetter = (isSelf ? selfInitial : peer.display_name.slice(0, 1))?.toUpperCase() || '?';
  const [trust, setTrust] = useState<PeerTrust | null>(null);
  const [bondLabel, setBondLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getPeerTrust(token, peer.id)
      .then((res) => {
        if (!cancelled) setTrust(res.trust);
      })
      .catch(() => {
        if (!cancelled) setTrust(null);
      });
    api
      .listPeers(token)
      .then((res) => {
        if (cancelled) return;
        const hit = (res.peers ?? []).find((p) => p.id === peer.id);
        if (!hit) {
          setBondLabel(null);
          return;
        }
        const label =
          hit.bond === 'close' ? 'Close connection' : hit.bond === 'friend' ? 'Friends' : 'Connected';
        setBondLabel(label);
      })
      .catch(() => {
        if (!cancelled) setBondLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [peer.id, token]);

  return (
    <View style={{ gap: space.md }}>
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <IconBack size={18} color={colors.text} />
      </Pressable>
      <Card>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 12 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radii.full,
              backgroundColor: colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 28 }}>
              {avatarLetter}
            </Text>
          </View>
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
            {isSelf ? 'Self' : peer.display_name}
          </Text>
          {peer.username ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>@{peer.username}</Text>
          ) : null}
          {bondLabel && !isSelf ? (
            <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 13 }}>{bondLabel}</Text>
          ) : null}
          {trust ? (
            <View style={{ alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 36 }}>
                {trust.grade}
              </Text>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                Lony Trust · {trust.band}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' }}>
                {trust.available
                  ? `Repayment ${Math.round(trust.repayment_score)}${
                      trust.thin_history ? ' · limited history' : ''
                    } · ${trust.loan_sample_size} loan${trust.loan_sample_size === 1 ? '' : 's'} on Lony`
                  : 'Not enough Lony activity to grade yet'}
              </Text>
            </View>
          ) : null}
        </View>
        <PrimaryButton label="Message" onPress={onMessage} />
        {onCreateLoan ? <SecondaryButton label="New loan" onPress={onCreateLoan} /> : null}
      </Card>
    </View>
  );
}
