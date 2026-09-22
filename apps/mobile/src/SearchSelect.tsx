import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { filterCatalog, type CatalogOption } from './catalogs';
import { fonts, radii, space, useTheme } from './theme';

type Props = {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: CatalogOption[];
  placeholder?: string;
  disabled?: boolean;
  /** When false, show only the human label (default true keeps "USD · US Dollar"). */
  showId?: boolean;
};

export function SearchSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  showId = true,
}: Props) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterCatalog(options, query), [options, query]);
  const selected = options.find((o) => o.id === value);
  const display = selected ? (showId ? `${selected.id} · ${selected.label}` : selected.label) : placeholder;

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
        disabled={disabled}
        onPress={() => {
          setQuery('');
          setOpen(true);
        }}
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.md,
          paddingHorizontal: 14,
          paddingVertical: 14,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          opacity: disabled ? 0.45 : 1,
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={{ color: selected ? colors.text : colors.muted, fontFamily: fonts.ui, fontSize: 16 }}>
          {display}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
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
              <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 18 }}>{label}</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Text style={{ color: colors.tertiary, fontFamily: fonts.uiSemi, fontSize: 15 }}>Close</Text>
              </Pressable>
            </View>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search"
              placeholderTextColor={colors.muted}
              autoFocus
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
              data={filtered}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = item.id === value;
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.id);
                      setOpen(false);
                    }}
                    style={{
                      paddingHorizontal: space.md,
                      paddingVertical: 14,
                      backgroundColor: active ? colors.primarySoft : 'transparent',
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    }}
                  >
                    {showId ? (
                      <>
                        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>
                          {item.id}
                        </Text>
                        <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>{item.label}</Text>
                      </>
                    ) : (
                      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 15 }}>{item.label}</Text>
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={{ color: colors.muted, padding: space.md, fontFamily: fonts.ui }}>No matches</Text>
              }
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
