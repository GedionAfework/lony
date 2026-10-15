import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AppLockMethod } from './appLock';
import { PatternPad } from './PatternPad';
import { fonts, radii, space, useTheme } from './theme';

type Props = {
  busy?: boolean;
  method: AppLockMethod;
  label?: string;
  error?: string | null;
  onUnlockBiometrics: () => void;
  onUnlockSecret: (secret: string) => void;
};

export function AppLockScreen({
  busy,
  method,
  label = 'Biometrics',
  error,
  onUnlockBiometrics,
  onUnlockSecret,
}: Props) {
  const { colors } = useTheme();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');

  const title =
    method === 'pin'
      ? 'Enter your 6-digit PIN'
      : method === 'pattern'
        ? 'Draw your pattern'
        : method === 'password'
          ? 'Enter your lock password'
          : `Unlock with ${label}`;

  const pinDots = useMemo(() => Array.from({ length: 6 }, (_, i) => i < pin.length), [pin]);

  function appendPin(d: string) {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 6) onUnlockSecret(next);
  }

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
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 15, textAlign: 'center', marginBottom: 24 }}>
        {title}
      </Text>

      {busy ? <ActivityIndicator color={colors.primary} size="large" /> : null}

      {!busy && method === 'biometrics' ? (
        <Pressable
          onPress={onUnlockBiometrics}
          style={{
            backgroundColor: colors.primary,
            paddingHorizontal: 28,
            paddingVertical: 14,
            borderRadius: radii.md,
            minWidth: 180,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Unlock</Text>
        </Pressable>
      ) : null}

      {!busy && method === 'pin' ? (
        <View style={{ gap: 16, width: '100%', maxWidth: 320, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {pinDots.map((on, i) => (
              <View
                key={i}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: on ? colors.primary : colors.border,
                }}
              />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, width: 240 }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => (
              <Pressable
                key={d || 'sp'}
                disabled={!d}
                onPress={() => {
                  if (d === '⌫') setPin((p) => p.slice(0, -1));
                  else if (d) appendPin(d);
                }}
                style={{
                  width: 68,
                  height: 52,
                  borderRadius: radii.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: d ? colors.surfaceMuted : 'transparent',
                  borderWidth: d ? 1 : 0,
                  borderColor: colors.border,
                }}
              >
                {d ? (
                  <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 20 }}>{d}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {!busy && method === 'pattern' ? (
        <PatternPad disabled={busy} onComplete={(key) => onUnlockSecret(key)} />
      ) : null}

      {!busy && method === 'password' ? (
        <View style={{ width: '100%', maxWidth: 320, gap: 12 }}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
            placeholderTextColor={colors.muted}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              borderRadius: radii.md,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: colors.text,
              fontFamily: fonts.ui,
              fontSize: 16,
            }}
            onSubmitEditing={() => onUnlockSecret(password)}
          />
          <Pressable
            onPress={() => onUnlockSecret(password)}
            style={{
              backgroundColor: colors.primary,
              paddingVertical: 14,
              borderRadius: radii.md,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Unlock</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <Text style={{ color: colors.error, fontFamily: fonts.ui, fontSize: 13, marginTop: 16, textAlign: 'center' }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
