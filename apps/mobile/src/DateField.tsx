import { useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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

const CHIP_W = 56;

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
  const yearListRef = useRef<FlatList<number>>(null);
  const monthListRef = useRef<FlatList<number>>(null);

  const years = useMemo(() => {
    const start = now.getFullYear() - 1;
    return Array.from({ length: 12 }, (_, i) => start + i);
  }, []);

  const monthIndexes = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const maxDay = daysInMonth(year, month);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  function openPicker() {
    const p = parseIso(value);
    const y = p?.y ?? now.getFullYear();
    const m = p?.m ?? now.getMonth() + 1;
    const d = Math.min(p?.d ?? now.getDate(), daysInMonth(y, m));
    setYear(y);
    setMonth(m);
    setDay(d);
    setManual(false);
    setOpen(true);
    requestAnimationFrame(() => {
      const yi = Math.max(0, years.indexOf(y));
      yearListRef.current?.scrollToIndex({ index: yi, animated: false, viewPosition: 0.5 });
      monthListRef.current?.scrollToIndex({ index: m - 1, animated: false, viewPosition: 0.5 });
    });
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
                <FlatList
                  ref={yearListRef}
                  horizontal
                  data={years}
                  keyExtractor={(y) => String(y)}
                  showsHorizontalScrollIndicator={false}
                  style={{ maxHeight: 48 }}
                  getItemLayout={(_, index) => ({ length: CHIP_W + 8, offset: (CHIP_W + 8) * index, index })}
                  onScrollToIndexFailed={(info) => {
                    yearListRef.current?.scrollToOffset({
                      offset: info.averageItemLength * info.index,
                      animated: false,
                    });
                  }}
                  renderItem={({ item: y }) => (
                    <View style={{ marginRight: 8 }}>
                      <Chip label={String(y)} active={y === year} onPress={() => setYear(y)} />
                    </View>
                  )}
                />
                <Text style={{ color: colors.muted, fontFamily: fonts.uiSemi, fontSize: 12 }}>Month</Text>
                <FlatList
                  ref={monthListRef}
                  horizontal
                  data={monthIndexes}
                  keyExtractor={(m) => String(m)}
                  showsHorizontalScrollIndicator={false}
                  style={{ maxHeight: 48 }}
                  getItemLayout={(_, index) => ({ length: CHIP_W + 8, offset: (CHIP_W + 8) * index, index })}
                  onScrollToIndexFailed={(info) => {
                    monthListRef.current?.scrollToOffset({
                      offset: info.averageItemLength * info.index,
                      animated: false,
                    });
                  }}
                  renderItem={({ item: m }) => (
                    <View style={{ marginRight: 8 }}>
                      <Chip
                        label={MONTHS[m - 1].slice(0, 3)}
                        active={m === month}
                        onPress={() => {
                          setMonth(m);
                          setDay((d) => Math.min(d, daysInMonth(year, m)));
                        }}
                      />
                    </View>
                  )}
                />
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
        minWidth: CHIP_W,
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
