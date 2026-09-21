import { Pressable, Text, View } from 'react-native';
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
      <Pressable onPress={onBack}>
        <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 15 }}>Back</Text>
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
          {peer.username && !isSelf ? (
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14 }}>@{peer.username}</Text>
          ) : null}
        </View>
        <PrimaryButton label="Message" onPress={onMessage} />
        {!isSelf && onCreateLoan ? (
          <SecondaryButton label="Create loan" onPress={onCreateLoan} />
        ) : null}
      </Card>
    </View>
  );
}
