import { Pressable, View } from 'react-native';
import { IconMenu } from './icons';
import { radii, useTheme } from './theme';
import { BrandMark, ThemeToggle } from './ui';

type Props = {
  onMenu: () => void;
};

/** Shared top chrome: hamburger · logo · theme — used on every signed-in screen. */
export function AppHeader({ onMenu }: Props) {
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
      <ThemeToggle />
    </View>
  );
}
