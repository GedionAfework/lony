import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { fonts, space, useTheme, type ThemeColors } from './theme';
import { PrimaryButton, SecondaryButton } from './ui';

type Props = {
  token?: string | null;
  onAccepted?: () => void;
  onBack?: () => void;
  requireAccept?: boolean;
};

export function TermsScreen({ token, onAccepted, onBack, requireAccept }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [version, setVersion] = useState('');
  const [document, setDocument] = useState('Loading Terms of Service…');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTOS()
      .then((res) => {
        setVersion(res.version);
        setDocument(res.document);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load Terms'));
  }, []);

  async function accept() {
    if (!token) {
      onAccepted?.();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptTOS(token);
      onAccepted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept Terms');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Terms of Service</Text>
      {version ? <Text style={styles.meta}>Version {version}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.body}>{document}</Text>
      </ScrollView>
      <View style={styles.actions}>
        {requireAccept ? (
          <PrimaryButton label={busy ? 'Saving…' : 'Accept Terms'} onPress={accept} disabled={busy} />
        ) : null}
        {onBack ? <SecondaryButton label="Back" onPress={onBack} disabled={busy} /> : null}
        {!requireAccept && !onBack ? (
          <Pressable onPress={onAccepted}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, gap: space.sm },
    title: { fontFamily: fonts.uiBold, fontSize: 22, color: colors.text },
    meta: { fontFamily: fonts.ui, fontSize: 13, color: colors.muted },
    error: { fontFamily: fonts.ui, color: colors.error },
    scroll: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
    scrollContent: { padding: space.md },
    body: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 22, color: colors.textSecondary },
    actions: { gap: 8 },
    link: { fontFamily: fonts.uiSemi, color: colors.primary, textAlign: 'center', padding: 8 },
  });
}
