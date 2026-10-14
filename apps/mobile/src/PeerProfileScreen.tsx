import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { PeerTrust } from './api';
import { api } from './api';
import { AuthenticatedAvatar } from './AuthenticatedAvatar';
import { IconBack, IconCamera } from './icons';
import { t } from './i18n';
import { fonts, space, useTheme } from './theme';
import { Card, PrimaryButton, SecondaryButton } from './ui';
import { TrustGradeModal } from './TrustGradeModal';

type Peer = {
  id: string;
  display_name: string;
  username?: string | null;
  avatar_url?: string | null;
};

type Props = {
  token: string;
  peer: Peer;
  isSelf?: boolean;
  selfInitial?: string;
  avatarUrl?: string | null;
  avatarLocalUri?: string | null;
  avatarBusy?: boolean;
  onChangeAvatar?: () => void;
  onBack: () => void;
  onMessage: () => void;
  onCreateLoan?: () => void;
};

export function PeerProfileScreen({
  token,
  peer,
  isSelf,
  selfInitial,
  avatarUrl,
  avatarLocalUri,
  avatarBusy,
  onChangeAvatar,
  onBack,
  onMessage,
  onCreateLoan,
}: Props) {
  const { colors } = useTheme();
  const avatarLetter = (isSelf ? selfInitial : peer.display_name.slice(0, 1))?.toUpperCase() || '?';
  const photoPath = isSelf ? avatarUrl ?? peer.avatar_url : peer.avatar_url;
  const [trust, setTrust] = useState<PeerTrust | null>(null);
  const [bondLabel, setBondLabel] = useState<string | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);

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
          <Pressable
            onPress={isSelf && onChangeAvatar ? onChangeAvatar : undefined}
            disabled={!isSelf || !onChangeAvatar || avatarBusy}
            accessibilityRole={isSelf ? 'button' : undefined}
            accessibilityLabel={isSelf ? t(undefined, 'profile.changePhoto') || 'Change photo' : undefined}
            style={{ alignItems: 'center' }}
          >
            <View>
              <AuthenticatedAvatar
                path={photoPath}
                localUri={isSelf ? avatarLocalUri : undefined}
                token={token}
                size={88}
                fallbackLetter={avatarLetter}
              />
              {isSelf && onChangeAvatar ? (
                <View
                  style={{
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: colors.primary,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderWidth: 2,
                    borderColor: colors.surface,
                  }}
                >
                  <IconCamera size={13} color={colors.onPrimary} />
                </View>
              ) : null}
            </View>
          </Pressable>
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
            <Pressable
              onPress={() => setGradeOpen(true)}
              style={{ alignItems: 'center', gap: 4, marginTop: 4 }}
            >
              <Text style={{ color: colors.primary, fontFamily: fonts.uiBold, fontSize: 36 }}>
                {trust.grade}
              </Text>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
                {(
                  t(undefined, isSelf ? 'trust.youAreGrade' : 'trust.theyAreGrade') ||
                  (isSelf ? 'You are grade {grade} in Lony Trust' : 'Grade {grade} in Lony Trust')
                ).replace('{grade}', trust.grade)}
                {trust.band ? ` · ${trust.band}` : ''}
              </Text>
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' }}>
                {trust.available
                  ? `Repayment ${Math.round(trust.repayment_score)}${
                      trust.thin_history ? ' · limited history' : ''
                    } · ${trust.loan_sample_size} loan${trust.loan_sample_size === 1 ? '' : 's'} on Lony`
                  : t(undefined, 'trust.notEnough') || 'Not enough Lony activity to grade yet'}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <PrimaryButton label="Message" onPress={onMessage} />
        {onCreateLoan ? <SecondaryButton label="New loan" onPress={onCreateLoan} /> : null}
      </Card>
      <TrustGradeModal
        visible={gradeOpen}
        grade={trust?.grade}
        onClose={() => setGradeOpen(false)}
      />
    </View>
  );
}
