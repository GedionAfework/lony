import { Pressable, Text, View } from 'react-native';
import { IconBack } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { Card, PrimaryButton, SecondaryButton } from './ui';

type Peer = {
  id: string;
  display_name: string;
  username?: string | null;
};

type Props = {
  peer: Peer;
  isSelf?: boolean;
  selfInitial?: string;
  onBack: () => void;
  onMessage: () => void;
  onCreateLoan?: () => void;
};

export function PeerProfileScreen({ peer, isSelf, selfInitial, onBack, onMessage, onCreateLoan }: Props) {
  const { colors } = useTheme();
  const avatarLetter = (isSelf ? selfInitial : peer.display_name.slice(0, 1))?.toUpperCase() || '?';
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
        </View>
        <PrimaryButton label="Message" onPress={onMessage} />
        {onCreateLoan ? <SecondaryButton label="New loan" onPress={onCreateLoan} /> : null}
      </Card>
    </View>
  );
}
