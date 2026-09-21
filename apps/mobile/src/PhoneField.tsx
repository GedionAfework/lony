import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { COUNTRIES } from './catalogs';
import {
  countryForDial,
  dialForCountry,
  dialOptionsForCountries,
  splitE164,
  toE164,
} from './phone';
import { fonts, radii, space, useTheme } from './theme';

type Props = {
  label?: string;
  /** Full E.164 value (e.g. +251911234567). */
  value: string;
  country: string;
  onCountryChange: (country: string) => void;
  onChange: (e164: string) => void;
};

export function PhoneField({
  label = 'Phone',
  value,
  country,
  onCountryChange,
  onChange,
}: Props) {
  const { colors } = useTheme();
  const [pickCountry, setPickCountry] = useState(false);
  const [pickDial, setPickDial] = useState(false);
  const [query, setQuery] = useState('');

  const dialOpts = useMemo(() => dialOptionsForCountries(COUNTRIES), []);
  const parsed = useMemo(() => splitE164(value, country || 'ET'), [value, country]);
  const activeCountry = country || parsed.country;
  const dial = dialForCountry(activeCountry) || parsed.dial;
  const national = value ? parsed.national : '';

  useEffect(() => {
    if (!country || !value) return;
    const next = toE164(country, national);
    if (next && next !== value) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when country dropdown changes
  }, [country]);

  const filteredCountries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dialOpts;
    return dialOpts.filter((o) => (o.keywords ?? '').includes(q));
  }, [dialOpts, query]);

  function setNational(raw: string) {
    const digits = raw.replace(/\D/g, '');
    onChange(toE164(activeCountry, digits));
  }

  function chooseCountry(code: string) {
    onCountryChange(code);
    onChange(toE164(code, national));
    setPickCountry(false);
    setPickDial(false);
    setQuery('');
  }

  function chooseDial(code: string) {
    chooseCountry(code);
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
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => {
            setQuery('');
            setPickCountry(true);
          }}
          style={[
            styles.chip,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border, minWidth: 88 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Country"
        >
          <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 14 }}>
            {activeCountry || '—'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setQuery('');
            setPickDial(true);
          }}
          style={[
            styles.chip,
            { backgroundColor: colors.surfaceMuted, borderColor: colors.border, minWidth: 72 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Country code"
        >
          <Text style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 14 }}>
            +{dial || '—'}
          </Text>
        </Pressable>
        <TextInput
          value={national}
          onChangeText={setNational}
          keyboardType="phone-pad"
          placeholder="National number"
          placeholderTextColor={colors.muted}
          style={{
            flex: 1,
            backgroundColor: colors.surfaceMuted,
            borderRadius: radii.md,
            paddingHorizontal: 14,
            paddingVertical: 14,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            color: colors.text,
            fontFamily: fonts.ui,
            fontSize: 16,
          }}
        />
      </View>
      {value ? (
        <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 12 }}>{value}</Text>
      ) : null}

      <PickerModal
        visible={pickCountry}
        title="Country"
        colors={colors}
        query={query}
        onQuery={setQuery}
        onClose={() => setPickCountry(false)}
        data={filteredCountries}
        renderItem={(item) => (
          <Pressable onPress={() => chooseCountry(item.id)} style={styles.row}>
            <Text style={{ color: colors.text, fontFamily: fonts.ui, fontSize: 16, flex: 1 }}>
              {item.id} · {item.label.split(' (+')[0]}
            </Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.mono, fontSize: 14 }}>+{item.dial}</Text>
          </Pressable>
        )}
      />
      <PickerModal
        visible={pickDial}
        title="Country code"
        colors={colors}
        query={query}
        onQuery={setQuery}
        onClose={() => setPickDial(false)}
        data={filteredCountries}
        renderItem={(item) => (
          <Pressable
            onPress={() => {
              // If dial matches multiple countries, keep current when possible
              const next = countryForDial(item.dial, activeCountry) || item.id;
              chooseDial(next === activeCountry ? item.id : next);
            }}
            style={styles.row}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 16 }}>+{item.dial}</Text>
            <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 14, flex: 1, textAlign: 'right' }}>
              {item.id} · {item.label.split(' (+')[0]}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

function PickerModal({
  visible,
  title,
  colors,
  query,
  onQuery,
  onClose,
  data,
  renderItem,
}: {
  visible: boolean;
  title: string;
  colors: ReturnType<typeof useTheme>['colors'];
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  data: { id: string; dial: string; label: string }[];
  renderItem: (item: { id: string; dial: string; label: string }) => React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            maxHeight: '85%',
            paddingBottom: space.lg,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: space.md,
              paddingTop: space.md,
              paddingBottom: space.sm,
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 18 }}>{title}</Text>
            <Pressable onPress={onClose}>
              <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi }}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={onQuery}
            placeholder="Search…"
            placeholderTextColor={colors.muted}
            style={{
              marginHorizontal: space.md,
              marginBottom: space.sm,
              backgroundColor: colors.surfaceMuted,
              borderRadius: radii.md,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: colors.text,
              fontFamily: fonts.ui,
              fontSize: 16,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.border,
            }}
          />
          <FlatList
            data={data}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <>{renderItem(item)}</>}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.25)',
  },
});
