import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { api, type SearchHit } from './api';
import { fonts, radii, space, useTheme } from './theme';

type Props = {
  token: string;
  onOpenChat: (peer: SearchHit) => void;
  onError: (message: string) => void;
};

export function ChatSearchScreen({ token, onOpenChat, onError }: Props) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const req = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setBusy(false);
      return;
    }
    const id = ++req.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const looksPhone = /^\+?[\d\s()-]{6,}$/.test(q);
        if (looksPhone) {
          const phone = q.startsWith('+') ? q.replace(/[^\d+]/g, '') : q.replace(/\D/g, '');
          const e164 = phone.startsWith('+') ? phone : `+${phone}`;
          const byPhone = await api.lookupPhone(token, e164);
          if (id !== req.current) return;
          if (byPhone.found && byPhone.user) {
            setHits([byPhone.user]);
            return;
          }
        }
        const res = await api.searchUsers(token, q);
        if (id !== req.current) return;
        setHits(res.users ?? []);
      } catch (e) {
        if (id !== req.current) return;
        onError(e instanceof Error ? e.message : 'Search failed');
        setHits([]);
      } finally {
        if (id === req.current) setBusy(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [query, token, onError]);

  return (
    <View style={{ gap: space.md, flex: 1 }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Username or phone"
        placeholderTextColor={colors.muted}
        autoFocus
        autoCapitalize="none"
        keyboardType="default"
        style={{
          backgroundColor: colors.surfaceMuted,
          borderRadius: radii.md,
          paddingHorizontal: 14,
          paddingVertical: 12,
          color: colors.text,
          fontFamily: fonts.ui,
          fontSize: 16,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      />
      {busy ? <ActivityIndicator color={colors.primary} style={{ alignSelf: 'flex-start' }} /> : null}

      {hits.map((hit) => (
        <Pressable
          key={hit.id}
          onPress={() => onOpenChat(hit)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 12,
            paddingHorizontal: 12,
            backgroundColor: colors.surface,
            borderRadius: radii.lg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radii.full,
              backgroundColor: colors.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: colors.text, fontFamily: fonts.uiBold, fontSize: 17 }}>
              {hit.display_name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontFamily: fonts.uiSemi, fontSize: 16 }}>{hit.display_name}</Text>
            {hit.username ? (
              <Text style={{ color: colors.muted, fontFamily: fonts.ui, fontSize: 13 }}>@{hit.username}</Text>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}
