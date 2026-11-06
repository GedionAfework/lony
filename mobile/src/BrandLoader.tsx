import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View } from 'react-native';
import { fonts, useTheme } from './theme';

const logo = require('../assets/lony-logo.png');

/**
 * Lony's loading screen: the logo breathing over a soft glow, the name, and a moving bar.
 * plainFont: before the app's fonts have loaded (first launch screen).
 */
export function BrandLoader({ full = false, label, plainFont = false }: { full?: boolean; label?: string; plainFont?: boolean }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let loops: Animated.CompositeAnimation[] = [];
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduce) => {
        if (cancelled || reduce) return;
        loops = [
          Animated.loop(
            Animated.sequence([
              Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
              Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ]),
          ),
          Animated.loop(Animated.timing(slide, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true })),
        ];
        loops.forEach((l) => l.start());
      });
    return () => {
      cancelled = true;
      loops.forEach((l) => l.stop());
    };
  }, [pulse, slide]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const glowScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] });
  const barX = slide.interpolate({ inputRange: [0, 1], outputRange: [-60, 130] });

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label || 'Loading'}
      style={{
        flex: full ? 1 : undefined,
        minHeight: full ? undefined : 320,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        backgroundColor: full ? colors.background : 'transparent',
      }}
    >
      <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 32,
            backgroundColor: colors.primary,
            opacity: Animated.multiply(glow, 0.18),
            transform: [{ scale: glowScale }],
          }}
        />
        <Animated.Image source={logo} style={{ width: 60, height: 60, borderRadius: 18, transform: [{ scale }] }} />
      </View>
      <Text style={{ color: colors.text, fontSize: 22, letterSpacing: -0.4, ...(plainFont ? { fontWeight: '800' as const } : { fontFamily: fonts.uiBold }) }}>Lony</Text>
      <View style={{ width: 120, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.primarySoft }}>
        <Animated.View style={{ width: 48, height: 4, borderRadius: 2, backgroundColor: colors.primary, transform: [{ translateX: barX }] }} />
      </View>
      {label ? <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{label}</Text> : null}
    </View>
  );
}
