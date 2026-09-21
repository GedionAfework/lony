import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fonts, radii, space, useTheme } from './theme';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type Props = {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
};

function parseIso(value: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    return null;
  }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function DateField({ label, value, onChange, placeholder = 'Select date' }: Props) {
  const { colors } = useTheme();
  const now = new Date();
  const parsed = parseIso(value);
  const [open, setOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [year, setYear] = useState(parsed?.y ?? now.getFullYear());
  const [month, setMonth] = useState(parsed?.m ?? now.getMonth() + 1);
  const [day, setDay] = useState(parsed?.d ?? now.getDate());

  const years = useMemo(() => {
    const start = now.getFullYear() - 1;
    return Array.from({ length: 12 }, (_, i) => start + i);
  }, [now]);

  const maxDay = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  function openPicker() {
    const p = parseIso(value);
    setYear(p?.y ?? now.getFullYear());
    setMonth(p?.m ?? now.getMonth() + 1);
    setDay(Math.min(p?.d ?? now.getDate(), daysInMonth(p?.y ?? now.getFullYear(), p?.m ?? now.getMonth() + 1)));
    setManual(false);
    setOpen(true);
  }

  function apply() {
    const d = Math.min(day, daysInMonth(year, month));
    onChange(toIso(year, month, d));
    setOpen(false);
  }

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
      <Pressable
        onPress={openPicker}
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.md,
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={{ color: value ? colors.text : colors.muted, fontFamily: fonts.ui, fontSize: 16 }}>
          {value || placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.xl,
              borderTopRightRadius: radii.xl,
              padding: space.md,
              gap: 12,
              maxHeight: '80%',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 18 }}>{label}</Text>
              <Pressable onPress={() => setOpen(false)}>
                <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi }}>Close</Text>
              </Pressable>
            </View>

            {!manual ? (
              <>
                <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>Year</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {years.map((y) => (
                      <Chip key={y} label={String(y)} active={y === year} onPress={() => setYear(y)} />
                    ))}
                  </View>
                </ScrollView>
                <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>Month</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 48 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {MONTHS.map((name, i) => (
                      <Chip
                        key={name}
                        label={name.slice(0, 3)}
                        active={i + 1 === month}
                        onPress={() => {
                          setMonth(i + 1);
                          setDay((d) => Math.min(d, daysInMonth(year, i + 1)));
                        }}
                      />
                    ))}
                  </View>
                </ScrollView>
                <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>Day</Text>
                <ScrollView style={{ maxHeight: 160 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {days.map((d) => (
                      <Chip key={d} label={String(d)} active={d === day} onPress={() => setDay(d)} />
                    ))}
                  </View>
                </ScrollView>
                <Pressable onPress={() => setManual(true)}>
                  <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center' }}>
                    Enter manually
                  </Text>
                </Pressable>
                <Pressable
                  onPress={apply}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: radii.md,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Use date</Text>
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={value}
                  onChangeText={onChange}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  style={{
                    backgroundColor: colors.surfaceMuted,
                    borderRadius: radii.md,
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    color: colors.text,
                    fontFamily: fonts.ui,
                    fontSize: 16,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                  }}
                />
                <Pressable onPress={() => setManual(false)}>
                  <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, textAlign: 'center' }}>
                    Use picker
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setOpen(false)}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: radii.md,
                    minHeight: 48,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Done</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radii.full,
        backgroundColor: active ? colors.primary : colors.surfaceMuted,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: active ? colors.primary : colors.border,
        minWidth: 40,
        alignItems: 'center',
      }}
    >
      <Text
        style={{
          color: active ? colors.onPrimary : colors.text,
          fontFamily: fonts.uiSemi,
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
