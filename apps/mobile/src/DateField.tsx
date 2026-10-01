import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconClose } from './icons';
import { fonts, radii, space, useTheme } from './theme';
import { useDatePrefs, useFormatDate } from './datePrefs';
import {
  daysInCalendarMonth,
  dateFromCalendarParts,
  getCalendarParts,
  monthLabelsForYear,
  parseIsoLocal,
  toIsoLocal,
  yearOptions,
} from './calendarMath';

type Props = {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
};

const CHIP_H = 44;
const LIST_H = 220;
const PAD = Math.floor((LIST_H - CHIP_H) / 2);

function clampIso(iso: string, minDate?: string, maxDate?: string): string {
  let out = iso;
  if (minDate && out < minDate) out = minDate;
  if (maxDate && out > maxDate) out = maxDate;
  return out;
}

export function isoToday(): string {
  return toIsoLocal(new Date());
}

/**
 * Date picker that shows year / month / day in the user's calendar system.
 * Stored value remains Gregorian YYYY-MM-DD for the API.
 */
export function DateField({
  label,
  value,
  onChange,
  placeholder = 'Select…',
  minDate,
  maxDate,
}: Props) {
  const { colors } = useTheme();
  const formatDate = useFormatDate();
  const prefs = useDatePrefs();
  const [open, setOpen] = useState(false);

  const selectedGregorian = useMemo(() => parseIsoLocal(value) ?? new Date(), [value]);
  const initialParts = useMemo(
    () => getCalendarParts(selectedGregorian, prefs.calendarId, prefs.locale),
    [selectedGregorian, prefs.calendarId, prefs.locale],
  );

  const [year, setYear] = useState(initialParts.year);
  const [month, setMonth] = useState(initialParts.month);
  const [day, setDay] = useState(initialParts.day);

  const yearListRef = useRef<FlatList<number>>(null);
  const monthListRef = useRef<FlatList<{ month: number; label: string }>>(null);
  const dayListRef = useRef<FlatList<number>>(null);

  const years = useMemo(() => yearOptions(prefs.calendarId, initialParts.year, 14), [prefs.calendarId, initialParts.year]);
  const months = useMemo(
    () => monthLabelsForYear(prefs.calendarId, year, prefs.locale),
    [prefs.calendarId, year, prefs.locale],
  );
  const maxDay = daysInCalendarMonth(prefs.calendarId, year, month, prefs.locale);
  const days = useMemo(() => Array.from({ length: maxDay }, (_, i) => i + 1), [maxDay]);

  useEffect(() => {
    if (day > maxDay) setDay(maxDay);
  }, [day, maxDay]);

  // When the user switches calendar preference, re-derive parts from the stored Gregorian value.
  useEffect(() => {
    const base = parseIsoLocal(value) ?? new Date();
    const p = getCalendarParts(base, prefs.calendarId, prefs.locale);
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
  }, [prefs.calendarId, value, prefs.locale]);

  const display = value
    ? formatDate(parseIsoLocal(value) ?? value)
    : '';

  function scrollToSelection(y: number, m: number, d: number, monthRows: { month: number }[]) {
    requestAnimationFrame(() => {
      const yi = Math.max(0, years.indexOf(y));
      yearListRef.current?.scrollToOffset({ offset: Math.max(0, yi * CHIP_H), animated: false });
      const mi = Math.max(0, monthRows.findIndex((row) => row.month === m));
      monthListRef.current?.scrollToOffset({ offset: Math.max(0, mi * CHIP_H), animated: false });
      dayListRef.current?.scrollToOffset({
        offset: Math.max(0, Math.min(d - 1, maxDay - 1) * CHIP_H),
        animated: false,
      });
    });
  }

  function openPicker() {
    const base = parseIsoLocal(value) ?? new Date();
    const p = getCalendarParts(base, prefs.calendarId, prefs.locale);
    setYear(p.year);
    setMonth(p.month);
    setDay(p.day);
    setOpen(true);
    const monthRows = monthLabelsForYear(prefs.calendarId, p.year, prefs.locale);
    setTimeout(() => scrollToSelection(p.year, p.month, p.day, monthRows), 50);
  }

  function apply() {
    const d = dateFromCalendarParts(prefs.calendarId, year, month, Math.min(day, maxDay), prefs.locale);
    if (!d) {
      setOpen(false);
      return;
    }
    onChange(clampIso(toIsoLocal(d), minDate, maxDate));
    setOpen(false);
  }

  function Chip({
    active,
    text,
    onPress,
    disabled,
  }: {
    active: boolean;
    text: string;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={{
          width: 72,
          height: CHIP_H,
          marginVertical: 0,
          borderRadius: radii.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? colors.primary : 'transparent',
          opacity: disabled ? 0.35 : 1,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: active ? colors.onPrimary : colors.text,
            fontFamily: active ? fonts.uiSemi : fonts.ui,
            fontSize: 13,
          }}
        >
          {text}
        </Text>
      </Pressable>
    );
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
          {display || placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="fade" transparent onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 20 }}>
          <Pressable
            style={{ ...StyleSheet.absoluteFill, backgroundColor: colors.overlay }}
            onPress={() => setOpen(false)}
          />
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              paddingBottom: space.md,
              paddingTop: space.sm,
              maxHeight: '80%',
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 }}>
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>Pick a date</Text>
              <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close" style={{ padding: 8 }}>
                <IconClose size={18} color={colors.text} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 8 }}>
              <FlatList
                ref={yearListRef}
                data={years}
                keyExtractor={(y) => `y-${y}`}
                showsVerticalScrollIndicator={false}
                style={{ height: LIST_H }}
                contentContainerStyle={{ paddingVertical: PAD }}
                getItemLayout={(_, index) => ({ length: CHIP_H, offset: CHIP_H * index, index })}
                renderItem={({ item }) => (
                  <Chip active={item === year} text={String(item)} onPress={() => setYear(item)} />
                )}
              />
              <FlatList
                ref={monthListRef}
                data={months}
                keyExtractor={(m) => `m-${m.month}`}
                showsVerticalScrollIndicator={false}
                style={{ height: LIST_H, minWidth: 120 }}
                contentContainerStyle={{ paddingVertical: PAD }}
                getItemLayout={(_, index) => ({ length: CHIP_H, offset: CHIP_H * index, index })}
                renderItem={({ item }) => (
                  <Chip
                    active={item.month === month}
                    text={item.label}
                    onPress={() => setMonth(item.month)}
                  />
                )}
              />
              <FlatList
                ref={dayListRef}
                data={days}
                keyExtractor={(d) => `d-${d}`}
                showsVerticalScrollIndicator={false}
                style={{ height: LIST_H }}
                contentContainerStyle={{ paddingVertical: PAD }}
                getItemLayout={(_, index) => ({ length: CHIP_H, offset: CHIP_H * index, index })}
                renderItem={({ item }) => (
                  <Chip active={item === day} text={String(item)} onPress={() => setDay(item)} />
                )}
              />
            </View>

            <Pressable
              onPress={apply}
              style={{
                marginHorizontal: 16,
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: radii.md,
                backgroundColor: colors.primary,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.onPrimary, fontFamily: fonts.uiSemi, fontSize: 16 }}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
