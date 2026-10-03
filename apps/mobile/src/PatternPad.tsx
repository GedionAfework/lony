import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { fonts, radii, useTheme } from './theme';

const DOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

type Props = {
  value?: number[];
  onChange?: (pattern: number[]) => void;
  onComplete?: (patternKey: string) => void;
  /** Minimum dots before Done is enabled (default 4). */
  minLength?: number;
  showActions?: boolean;
  disabled?: boolean;
};

/** 3×3 Android-style pattern pad. Secret is stored as "0-1-4-7". */
export function PatternPad({
  value,
  onChange,
  onComplete,
  minLength = 4,
  showActions = true,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const [local, setLocal] = useState<number[]>([]);
  const pattern = value ?? local;

  function setPattern(next: number[]) {
    if (value == null) setLocal(next);
    onChange?.(next);
  }

  function tapDot(n: number) {
    if (disabled) return;
    if (pattern.includes(n)) return;
    setPattern([...pattern, n]);
  }

  function clear() {
    setPattern([]);
  }

  function done() {
    if (pattern.length < minLength) return;
    onComplete?.(pattern.join('-'));
  }

  const order = useMemo(() => {
    const map = new Map<number, number>();
    pattern.forEach((d, i) => map.set(d, i + 1));
    return map;
  }, [pattern]);

  return (
    <View style={{ gap: 16, alignItems: 'center' }}>
      <View
        style={{
          width: 240,
          height: 240,
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignContent: 'space-between',
        }}
      >
        {DOTS.map((n) => {
          const step = order.get(n);
          const on = step != null;
          return (
            <Pressable
              key={n}
              disabled={disabled}
              onPress={() => tapDot(n)}
              accessibilityLabel={`Pattern dot ${n + 1}${on ? `, step ${step}` : ''}`}
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? colors.primary : colors.surfaceMuted,
                borderWidth: 2,
                borderColor: on ? colors.primary : colors.border,
              }}
            >
              {on ? (
                <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiBold, fontSize: 16 }}>{step}</Text>
              ) : (
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    backgroundColor: colors.borderStrong,
                  }}
                />
              )}
            </Pressable>
          );
        })}
      </View>
      {showActions ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={clear}
            disabled={disabled || pattern.length === 0}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: radii.md,
              backgroundColor: colors.surfaceMuted,
              opacity: pattern.length === 0 ? 0.5 : 1,
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi }}>Clear</Text>
          </Pressable>
          <Pressable
            onPress={done}
            disabled={disabled || pattern.length < minLength}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: radii.md,
              backgroundColor: colors.primary,
              opacity: pattern.length >= minLength ? 1 : 0.5,
            }}
          >
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi }}>Done</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 12 }}>
        Connect at least {minLength} dots in order
      </Text>
    </View>
  );
}

export function patternKey(dots: number[]): string {
  return dots.join('-');
}
