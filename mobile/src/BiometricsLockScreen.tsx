import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, radii, space, useTheme } from './theme';

type Props = {
  busy?: boolean;
  label?: string;
  error?: string | null;
  onUnlock: () => void;
};

export function BiometricsLockScreen({ busy, label = 'Biometrics', error, onUnlock }: Props) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.background,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.lg,
          zIndex: 1000,
        },
      ]}
      accessibilityViewIsModal
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 28, marginBottom: 8 }}>Lony</Text>
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 15, textAlign: 'center', marginBottom: 28 }}>
        Unlock with {label} to continue
      </Text>
      {busy ? (
        <ActivityIndicator color={colors.primary} size="large" />
      ) : (
        <Pressable
          onPress={onUnlock}
          style={{
            backgroundColor: colors.primary,
            paddingHorizontal: 28,
            paddingVertical: 14,
            borderRadius: radii.md,
            minWidth: 180,
            alignItems: 'center',
          }}
          accessibilityRole="button"
          accessibilityLabel={`Unlock with ${label}`}
        >
          <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Unlock</Text>
        </Pressable>
      )}
      {error ? (
        <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 13, marginTop: 16, textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
