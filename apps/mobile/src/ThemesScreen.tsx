import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  THEME_COLOR_FIELDS,
  lightColors,
  type ThemeColors,
  type ThemePreset,
  fonts,
  radii,
  space,
  useTheme,
} from './theme';
import { Card, Field, PrimaryButton, SecondaryButton, SectionLabel } from './ui';

type Props = {
  onBack: () => void;
};

function PhonePreview({ palette, active }: { palette: ThemeColors; active?: boolean }) {
  return (
    <View
      style={{
        alignSelf: 'center',
        width: 72,
        height: 118,
        borderRadius: 14,
        borderWidth: active ? 2 : 1.5,
        borderColor: active ? palette.primary : '#94A3B8',
        backgroundColor: '#0F172A',
        padding: 4,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flex: 1,
          borderRadius: 10,
          backgroundColor: palette.background,
          overflow: 'hidden',
        }}
      >
        <View style={{ height: 10, backgroundColor: palette.nav, borderBottomWidth: 1, borderBottomColor: palette.border }} />
        <View style={{ flex: 1, padding: 6, gap: 5 }}>
          <View style={{ height: 6, width: '70%', borderRadius: 3, backgroundColor: palette.text, opacity: 0.85 }} />
          <View style={{ height: 4, width: '50%', borderRadius: 2, backgroundColor: palette.muted, opacity: 0.7 }} />
          <View
            style={{
              marginTop: 4,
              height: 28,
              borderRadius: 6,
              backgroundColor: palette.surfaceMuted,
              borderWidth: 1,
              borderColor: palette.border,
            }}
          />
          <View
            style={{
              marginTop: 'auto',
              height: 16,
              borderRadius: 6,
              backgroundColor: palette.primary,
            }}
          />
        </View>
      </View>
    </View>
  );
}

function ThemeTile({
  theme,
  active,
  onPress,
  onEdit,
  onDelete,
}: {
  theme: ThemePreset;
  active: boolean;
  onPress: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ width: '33.33%', padding: 6 }}>
      <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 8 }}>
        <PhonePreview palette={theme.colors} active={active} />
        <Text
          numberOfLines={2}
          style={{
            color: active ? colors.primary : colors.text,
            fontFamily: fonts.uiSemi,
            fontSize: 11,
            textAlign: 'center',
            lineHeight: 14,
          }}
        >
          {theme.name}
        </Text>
        {active ? (
          <Text style={{ color: colors.primary, fontFamily: fonts.ui, fontSize: 10 }}>Active</Text>
        ) : (
          <View style={{ height: 14 }} />
        )}
      </Pressable>
      {theme.kind === 'custom' ? (
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 4 }}>
          {onEdit ? (
            <Pressable onPress={onEdit}>
              <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 11 }}>Edit</Text>
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable onPress={onDelete}>
              <Text style={{ color: colors.warning, fontFamily: fonts.uiSemi, fontSize: 11 }}>Del</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function ThemesScreen({ onBack }: Props) {
  const {
    colors,
    themeId,
    presets,
    customThemes,
    setThemeId,
    saveCustomTheme,
    deleteCustomTheme,
  } = useTheme();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('My theme');
  const [draft, setDraft] = useState<ThemeColors>({ ...lightColors });
  const [editingId, setEditingId] = useState<string | null>(null);

  const all = useMemo(() => [...presets, ...customThemes], [presets, customThemes]);

  function startCreate() {
    setEditingId(null);
    setName('My theme');
    setDraft({ ...colors });
    setCreating(true);
  }

  function startEdit(t: ThemePreset) {
    if (t.kind !== 'custom') return;
    setEditingId(t.id);
    setName(t.name);
    setDraft({ ...t.colors });
    setCreating(true);
  }

  async function onSave() {
    const id = editingId || `custom_${Date.now()}`;
    await saveCustomTheme({
      id,
      name: name.trim() || 'Custom theme',
      kind: 'custom',
      colors: draft,
    });
    setCreating(false);
    setEditingId(null);
  }

  if (creating) {
    return (
      <View style={{ gap: space.md }}>
        <Pressable onPress={() => setCreating(false)}>
          <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>← Themes</Text>
        </Pressable>
        <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>
          {editingId ? 'Edit theme' : 'Create theme'}
        </Text>
        <View style={{ alignItems: 'center' }}>
          <PhonePreview palette={draft} active />
        </View>
        <Card>
          <Field label="Name" value={name} onChange={setName} />
          <SectionLabel>Colors</SectionLabel>
          {THEME_COLOR_FIELDS.map((f) => (
            <View key={f.key} style={{ gap: 6 }}>
              <Text
                style={{
                  color: colors.muted,
                  fontFamily: fonts.uiSemi,
                  fontSize: 12,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                }}
              >
                {f.label}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radii.sm,
                    backgroundColor: draft[f.key],
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
                <TextInput
                  value={draft[f.key]}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v.trim() }))}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surfaceMuted,
                    color: colors.text,
                    fontFamily: fonts.mono,
                    fontSize: 14,
                    borderRadius: radii.md,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
              </View>
            </View>
          ))}
          <PrimaryButton label="Save theme" onPress={() => void onSave()} />
          <SecondaryButton label="Cancel" onPress={() => setCreating(false)} />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      <Pressable onPress={onBack}>
        <Text style={{ color: colors.primary, fontFamily: fonts.uiSemi, fontSize: 14 }}>← Settings</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 22 }}>Themes</Text>

      <PrimaryButton label="Create custom theme" onPress={startCreate} />

      <Card>
        <SectionLabel>Built-in</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
          {presets.map((t) => (
            <ThemeTile
              key={t.id}
              theme={t}
              active={themeId === t.id}
              onPress={() => setThemeId(t.id)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <SectionLabel>Your themes</SectionLabel>
        {customThemes.length === 0 ? (
          <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>None yet</Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 }}>
            {customThemes.map((t) => (
              <ThemeTile
                key={t.id}
                theme={t}
                active={themeId === t.id}
                onPress={() => setThemeId(t.id)}
                onEdit={() => startEdit(t)}
                onDelete={() => void deleteCustomTheme(t.id)}
              />
            ))}
          </View>
        )}
      </Card>

      {!all.some((t) => t.id === themeId) ? (
        <Text style={{ color: colors.warning, fontFamily: fonts.ui, fontSize: 13 }}>
          Active theme missing — pick any theme above.
        </Text>
      ) : null}
    </View>
  );
}
