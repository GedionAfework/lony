import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { fonts, radii, space, useTheme, type ThemeColors } from './theme';

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return <View style={[{ flex: 1, backgroundColor: colors.background }, style]}>{children}</View>;
}

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          backgroundColor: colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 18 }}>✓</Text>
      </View>
      <View>
        <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 22 }}>Lony</Text>
        {!compact ? (
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 10, letterSpacing: 2.5 }}>
            LEDGER
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function Card({
  children,
  style,
  accent,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  accent?: 'primary' | 'secondary' | 'tertiary' | 'none';
}) {
  const { colors } = useTheme();
  const border =
    accent === 'primary'
      ? colors.primary
      : accent === 'secondary'
        ? colors.secondary
        : accent === 'tertiary'
          ? colors.tertiary
          : colors.border;
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          padding: space.md,
          gap: 12,
          borderWidth: 1,
          borderColor: border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Money({
  value,
  currency,
  size = 'lg',
  tone = 'default',
}: {
  value: string;
  currency?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'default' | 'positive' | 'negative' | 'muted';
}) {
  const { colors } = useTheme();
  const color =
    tone === 'positive'
      ? colors.success
      : tone === 'negative'
        ? colors.secondary
        : tone === 'muted'
          ? colors.muted
          : colors.text;
  const fontSize = size === 'xl' ? 34 : size === 'lg' ? 24 : size === 'md' ? 16 : 12;
  return (
    <Text
      style={{
        color,
        fontSize,
        fontFamily: size === 'sm' ? fonts.mono : fonts.monoSemi,
        fontVariant: ['tabular-nums'],
      }}
    >
      {value}
      {currency ? ` ${currency}` : ''}
    </Text>
  );
}

export function StatusPill({ status }: { status: string }) {
  const { colors } = useTheme();
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    active: { bg: colors.successSoft, fg: colors.success, label: 'Active' },
    overdue: { bg: colors.errorSoft, fg: colors.error, label: 'Overdue' },
    pending: { bg: colors.warningSoft, fg: colors.warning, label: 'Pending' },
    repayment_pending: { bg: colors.warningSoft, fg: colors.warning, label: 'Awaiting confirm' },
    completed: { bg: colors.surfaceMuted, fg: colors.muted, label: 'Completed' },
    rejected: { bg: colors.errorSoft, fg: colors.error, label: 'Rejected' },
    cancelled: { bg: colors.surfaceMuted, fg: colors.muted, label: 'Cancelled' },
  };
  const s = map[status] ?? { bg: colors.surfaceMuted, fg: colors.muted, label: status };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        borderRadius: radii.full,
        backgroundColor: s.bg,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: s.fg }} />
      <Text style={{ color: s.fg, fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.3 }}>{s.label}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={{
        backgroundColor: colors.primary,
        borderRadius: radii.md,
        minHeight: 52,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        opacity: disabled ? 0.45 : 1,
      }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.md,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: 16,
        opacity: disabled ? 0.45 : 1,
      }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      style={{
        borderRadius: radii.md,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
        opacity: disabled ? 0.45 : 1,
      }}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surfaceMuted,
        borderRadius: radii.full,
        padding: 4,
        gap: 4,
      }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            style={{
              flex: 1,
              minHeight: 40,
              borderRadius: radii.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? colors.surface : 'transparent',
              borderWidth: active ? 1 : 0,
              borderColor: colors.border,
            }}
            onPress={() => onChange(opt.id)}
          >
            <Text
              style={{
                color: active ? colors.text : colors.muted,
                fontFamily: active ? fonts.monoSemi : fonts.mono,
                fontSize: 13,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({
  label,
  value,
  onChange,
  secure,
  keyboardType,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  placeholder?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={{
          color: colors.muted,
          fontFamily: fonts.uiSemi,
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType ?? 'default'}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={{
          backgroundColor: colors.surfaceMuted,
          color: colors.text,
          borderRadius: radii.md,
          paddingHorizontal: 14,
          paddingVertical: 14,
          fontSize: 16,
          fontFamily: fonts.ui,
          borderWidth: 1,
          borderColor: colors.border,
        }}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function Banner({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone: 'secondary' | 'tertiary' | 'primary';
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { colors } = useTheme();
  const bg = tone === 'secondary' ? colors.secondarySoft : tone === 'tertiary' ? colors.tertiarySoft : colors.primarySoft;
  const fg = tone === 'secondary' ? colors.secondary : tone === 'tertiary' ? colors.tertiary : colors.primary;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: radii.md,
        backgroundColor: bg,
        padding: 14,
      }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>{title}</Text>
        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 }}>{body}</Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          style={{
            backgroundColor: colors.surface,
            borderRadius: radii.full,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: colors.border,
          }}
          onPress={onAction}
        >
          <Text style={{ color: fg, fontFamily: fonts.uiSemi, fontSize: 12 }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ThemeToggle() {
  const { resolved, toggle, colors } = useTheme();
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      style={{
        minWidth: 44,
        minHeight: 44,
        borderRadius: radii.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 18 }}>{resolved === 'dark' ? '☀' : '☾'}</Text>
    </Pressable>
  );
}

export function useAppStyles() {
  const { colors } = useTheme();
  return useMemo(() => makeAppStyles(colors), [colors]);
}

function makeAppStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowTitle: { color: colors.text, fontSize: 16, fontFamily: fonts.uiSemi },
    smallButton: {
      backgroundColor: colors.primary,
      borderRadius: radii.md,
      minHeight: 44,
      paddingHorizontal: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    smallButtonText: { color: colors.onPrimary, fontFamily: fonts.uiBold },
    ghostButton: {
      borderRadius: radii.md,
      minHeight: 44,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostButtonText: { color: colors.tertiary, fontFamily: fonts.uiSemi },
    selectedRow: {
      backgroundColor: colors.primarySoft,
      borderRadius: radii.md,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    container: { padding: 16, paddingTop: 20, gap: 16, paddingBottom: 28 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      padding: 16,
      gap: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardTitle: { color: colors.text, fontSize: 20, fontFamily: fonts.uiSemi },
    hero: { color: colors.primary, fontSize: 24, fontFamily: fonts.uiBold },
    label: {
      color: colors.muted,
      fontSize: 12,
      fontFamily: fonts.uiSemi,
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radii.md,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonText: { color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 16 },
    secondaryButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radii.md,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryButtonText: { color: colors.text, fontFamily: fonts.uiSemi },
    link: { color: colors.tertiary, textAlign: 'center', paddingVertical: 8, fontFamily: fonts.uiSemi },
    muted: { color: colors.muted, fontSize: 14, fontFamily: fonts.ui },
    disclaimer: { color: colors.muted, fontSize: 13, lineHeight: 18, fontFamily: fonts.ui },
    checkbox: { color: colors.primary, fontFamily: fonts.mono, fontSize: 16 },
    error: { color: colors.error, fontSize: 14, fontFamily: fonts.ui },
    dev: { color: colors.secondary, fontSize: 13, fontFamily: fonts.mono },
    subtitle: { color: colors.muted, fontSize: 14, lineHeight: 20, fontFamily: fonts.ui },
  });
}
