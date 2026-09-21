import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { IconMenu } from './icons';
import { radii, useTheme } from './theme';
import { BrandMark } from './ui';

type Props = {
  onMenu: () => void;
  /** Optional right-side control (e.g. chat search). Theme lives in Settings. */
  right?: ReactNode;
};

export function AppHeader({ onMenu, right }: Props) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <Pressable
        onPress={onMenu}
        accessibilityRole="button"
        accessibilityLabel="Open menu"
        style={{
          width: 40,
          height: 40,
          borderRadius: radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.surfaceMuted,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <IconMenu size={18} color={colors.text} />
      </Pressable>
      <BrandMark compact />
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}
