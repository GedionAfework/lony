import { View, type ViewStyle } from 'react-native';
import { useTheme } from './theme';

type IconProps = {
  size?: number;
  color?: string;
  style?: ViewStyle;
};

export function IconHome({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'flex-end' }, style]}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: s * 0.42,
          borderRightWidth: s * 0.42,
          borderBottomWidth: s * 0.36,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: c,
          marginBottom: -1,
        }}
      />
      <View
        style={{
          width: s * 0.7,
          height: s * 0.48,
          borderWidth: 2,
          borderColor: c,
          borderTopWidth: 0,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
    </View>
  );
}

export function IconLoans({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  const barH = Math.max(2, Math.round(s * 0.12));
  return (
    <View style={[{ width: s, height: s, justifyContent: 'center', gap: s * 0.18 }, style]}>
      <View style={{ height: barH, width: s * 0.85, backgroundColor: c, borderRadius: barH, alignSelf: 'flex-start' }} />
      <View style={{ height: barH, width: s * 0.85, backgroundColor: c, borderRadius: barH, alignSelf: 'flex-end' }} />
      <View style={{ height: barH, width: s * 0.85, backgroundColor: c, borderRadius: barH, alignSelf: 'flex-start' }} />
    </View>
  );
}

export function IconChat({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: s * 0.78,
          height: s * 0.58,
          borderRadius: s * 0.18,
          borderWidth: 2,
          borderColor: c,
        }}
      />
      <View
        style={{
          width: 0,
          height: 0,
          marginTop: -2,
          marginLeft: -s * 0.18,
          borderLeftWidth: s * 0.12,
          borderRightWidth: s * 0.12,
          borderTopWidth: s * 0.16,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderTopColor: c,
        }}
      />
    </View>
  );
}

export function IconMenu({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  const barH = Math.max(2, Math.round(s * 0.1));
  return (
    <View style={[{ width: s, height: s, justifyContent: 'center', gap: s * 0.18 }, style]}>
      <View style={{ height: barH, width: '100%', backgroundColor: c, borderRadius: barH }} />
      <View style={{ height: barH, width: '100%', backgroundColor: c, borderRadius: barH }} />
      <View style={{ height: barH, width: '100%', backgroundColor: c, borderRadius: barH }} />
    </View>
  );
}

export function IconSun({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  const core = s * 0.36;
  const ray = Math.max(2, s * 0.1);
  const rayLen = s * 0.18;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={{
            position: 'absolute',
            width: ray,
            height: s * 0.78,
            backgroundColor: c,
            borderRadius: ray,
            transform: [{ rotate: `${deg}deg` }],
            opacity: 0.9,
          }}
        />
      ))}
      <View
        style={{
          width: core,
          height: core,
          borderRadius: core,
          backgroundColor: c,
          borderWidth: rayLen * 0.4,
          borderColor: 'transparent',
        }}
      />
    </View>
  );
}

export function IconMoon({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: s * 0.58,
          height: s * 0.58,
          borderRadius: s,
          borderWidth: Math.max(2, s * 0.12),
          borderColor: c,
          borderTopColor: 'transparent',
          borderRightColor: 'transparent',
          transform: [{ rotate: '-35deg' }],
          marginLeft: s * 0.08,
        }}
      />
    </View>
  );
}

export function IconGoogle({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View
      style={[
        {
          width: s,
          height: s,
          borderRadius: s,
          borderWidth: 2,
          borderColor: c,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View style={{ width: s * 0.28, height: s * 0.28, borderRadius: 2, backgroundColor: c }} />
    </View>
  );
}

export function IconTelegram({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: s * 0.55,
          borderTopWidth: s * 0.28,
          borderBottomWidth: s * 0.28,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: c,
          transform: [{ rotate: '-15deg' }],
        }}
      />
    </View>
  );
}

export function IconSearch({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  const ring = s * 0.55;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: ring,
          height: ring,
          borderRadius: ring,
          borderWidth: 2,
          borderColor: c,
          marginRight: s * 0.12,
          marginBottom: s * 0.12,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: s * 0.32,
          height: 2,
          backgroundColor: c,
          borderRadius: 2,
          right: s * 0.08,
          bottom: s * 0.18,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function IconPlus({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.onPrimary;
  const s = size;
  const thick = Math.max(2, Math.round(s * 0.14));
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View style={{ position: 'absolute', width: s * 0.7, height: thick, backgroundColor: c, borderRadius: thick }} />
      <View style={{ position: 'absolute', width: thick, height: s * 0.7, backgroundColor: c, borderRadius: thick }} />
    </View>
  );
}

export function IconBack({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: s * 0.42,
          height: s * 0.42,
          borderLeftWidth: 2.5,
          borderBottomWidth: 2.5,
          borderColor: c,
          transform: [{ rotate: '45deg' }],
          marginLeft: s * 0.12,
        }}
      />
    </View>
  );
}

export function IconSend({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.onPrimary;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: s * 0.55,
          borderTopWidth: s * 0.28,
          borderBottomWidth: s * 0.28,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: c,
          marginLeft: s * 0.08,
        }}
      />
    </View>
  );
}

export function IconMic({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'flex-end' }, style]}>
      <View
        style={{
          width: s * 0.32,
          height: s * 0.48,
          borderRadius: s,
          borderWidth: 2,
          borderColor: c,
          marginBottom: 2,
        }}
      />
      <View
        style={{
          width: s * 0.55,
          height: s * 0.22,
          borderWidth: 2,
          borderTopWidth: 0,
          borderColor: c,
          borderBottomLeftRadius: s,
          borderBottomRightRadius: s,
        }}
      />
      <View style={{ width: 2, height: s * 0.12, backgroundColor: c, marginTop: 1 }} />
    </View>
  );
}

export function IconAttach({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: s * 0.42,
          height: s * 0.55,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: c,
          transform: [{ rotate: '12deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: s * 0.22,
          height: 2,
          backgroundColor: c,
          top: s * 0.38,
          transform: [{ rotate: '12deg' }],
        }}
      />
    </View>
  );
}

export function IconEmoji({ size = 22, color, style }: IconProps) {
  const { colors } = useTheme();
  const c = color ?? colors.text;
  const s = size;
  const eye = Math.max(2, Math.round(s * 0.1));
  return (
    <View style={[{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View
        style={{
          width: s * 0.78,
          height: s * 0.78,
          borderRadius: s,
          borderWidth: 2,
          borderColor: c,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', gap: s * 0.16, marginBottom: s * 0.06 }}>
          <View style={{ width: eye, height: eye, borderRadius: eye, backgroundColor: c }} />
          <View style={{ width: eye, height: eye, borderRadius: eye, backgroundColor: c }} />
        </View>
        <View
          style={{
            width: s * 0.32,
            height: s * 0.16,
            borderBottomLeftRadius: s,
            borderBottomRightRadius: s,
            borderWidth: 2,
            borderTopWidth: 0,
            borderColor: c,
          }}
        />
      </View>
    </View>
  );
}
