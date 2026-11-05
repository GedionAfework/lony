import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './api';
import { IconBack } from './icons';
import { fonts, radii, space, useTheme, type ThemeColors } from './theme';
import { PrimaryButton } from './ui';

type Props = {
  token?: string | null;
  onAccepted?: () => void;
  onBack?: () => void;
  requireAccept?: boolean;
  /** The version this person already accepted, if any. */
  acceptedVersion?: string | null;
  acceptedAt?: string | null;
};

/** Bold spans inside a line: **like this**. */
function Inline({ text, style, boldStyle }: { text: string; style: object; boldStyle: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <Text key={i} style={boldStyle}>
            {p.slice(2, -2)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/** Just enough Markdown for the Terms: headings, bullets, bold, rules and paragraphs. */
function TermsBody({ markdown, styles }: { markdown: string; styles: ReturnType<typeof makeStyles> }) {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) return;
    if (/^#\s/.test(line)) return; // the screen already shows the title
    if (/^---+$/.test(line.trim())) {
      out.push(<View key={i} style={styles.rule} />);
      return;
    }
    const h = /^(#{2,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push(
        <Text key={i} style={h[1].length === 2 ? styles.h2 : styles.h3}>
          {h[2].replace(/\*\*/g, '')}
        </Text>,
      );
      return;
    }
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b) {
      out.push(
        <View key={i} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>•</Text>
          <Inline text={b[1]} style={[styles.body, { flex: 1 }]} boldStyle={styles.bold} />
        </View>,
      );
      return;
    }
    out.push(<Inline key={i} text={line.replace(/\s{2,}$/, '')} style={styles.body} boldStyle={styles.bold} />);
  });
  return <View style={{ gap: 8 }}>{out}</View>;
}

export function TermsScreen({ token, onAccepted, onBack, requireAccept, acceptedVersion, acceptedAt }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [version, setVersion] = useState('');
  const [document, setDocument] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAccepted, setJustAccepted] = useState(false);

  useEffect(() => {
    api
      .getTOS()
      .then((res) => {
        setVersion(res.version);
        setDocument(res.document);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load Terms'));
  }, []);

  // Accepting is a one-time step per version: once done, the button is gone.
  const alreadyAccepted = justAccepted || (Boolean(acceptedVersion) && Boolean(version) && acceptedVersion === version);

  async function accept() {
    if (!token) {
      onAccepted?.();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.acceptTOS(token);
      setJustAccepted(true);
      onAccepted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept Terms');
    } finally {
      setBusy(false);
    }
  }

  const acceptedOn = acceptedAt ? new Date(acceptedAt) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        {onBack ? (
          <Pressable onPress={onBack} disabled={busy} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} style={[styles.back, busy && { opacity: 0.45 }]}>
            <IconBack size={18} color={colors.text} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Terms of Service</Text>
          {version ? <Text style={styles.meta}>Version {version.replace(/^tos-/, '')}</Text> : null}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {document ? <TermsBody markdown={document} styles={styles} /> : <Text style={styles.body}>Loading…</Text>}
      </ScrollView>

      {alreadyAccepted ? (
        <View style={styles.acceptedBox}>
          <View style={styles.acceptedTick}>
            <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 13 }}>✓</Text>
          </View>
          <Text style={styles.acceptedText}>
            {acceptedOn && !justAccepted && !Number.isNaN(acceptedOn.getTime())
              ? `You accepted these terms on ${acceptedOn.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
              : 'You accepted these terms'}
          </Text>
        </View>
      ) : requireAccept ? (
        <PrimaryButton label={busy ? 'Saving…' : 'I accept the Terms'} onPress={accept} disabled={busy || !document} />
      ) : null}
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { flex: 1, gap: space.sm },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
    back: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    title: { fontFamily: fonts.uiBold, fontSize: 22, color: colors.text },
    meta: { fontFamily: fonts.ui, fontSize: 12.5, color: colors.muted },
    error: { fontFamily: fonts.ui, color: colors.error },
    scroll: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface },
    scrollContent: { padding: space.md, paddingBottom: space.lg },
    h2: { fontFamily: fonts.uiBold, fontSize: 16.5, color: colors.text, marginTop: 10 },
    h3: { fontFamily: fonts.uiSemi, fontSize: 15, color: colors.text, marginTop: 6 },
    body: { fontFamily: fonts.ui, fontSize: 14, lineHeight: 21, color: colors.textSecondary },
    bold: { fontFamily: fonts.uiSemi, color: colors.text },
    bulletRow: { flexDirection: 'row', gap: 8, paddingLeft: 4 },
    bulletDot: { fontFamily: fonts.uiBold, fontSize: 14, lineHeight: 21, color: colors.primary },
    rule: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
    acceptedBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 14,
      borderRadius: radii.lg,
      backgroundColor: colors.successSoft,
    },
    acceptedTick: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.success },
    acceptedText: { flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.success },
  });
}
