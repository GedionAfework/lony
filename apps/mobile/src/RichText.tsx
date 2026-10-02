import { Text, View, type TextStyle } from 'react-native';
import { fonts, useTheme } from './theme';

type Props = {
  text: string;
  style?: TextStyle;
  muted?: boolean;
};

/**
 * Lightweight rich text for AI replies: paragraphs, bullets, **bold**, *italic*.
 * Intentionally small — no full markdown parser.
 */
export function RichText({ text, style, muted }: Props) {
  const { colors } = useTheme();
  const color = muted ? colors.muted : colors.text;
  const base: TextStyle = {
    color,
    fontFamily: fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    ...style,
  };

  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) {
    return <Text style={base}> </Text>;
  }

  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^(\s*[-•*]|\s*\d+[.)])\s+/.test(l) || !l.trim());
        if (isList) {
          return (
            <View key={`b-${bi}`} style={{ gap: 4 }}>
              {lines
                .filter((l) => l.trim())
                .map((line, li) => {
                  const cleaned = line.replace(/^(\s*[-•*]|\s*\d+[.)])\s+/, '').trim();
                  return (
                    <View key={`l-${bi}-${li}`} style={{ flexDirection: 'row', gap: 8 }}>
                      <Text style={{ ...base, color: colors.primary, width: 12 }}>•</Text>
                      <View style={{ flex: 1 }}>
                        <InlineText text={cleaned} base={base} boldColor={colors.text} />
                      </View>
                    </View>
                  );
                })}
            </View>
          );
        }
        return (
          <View key={`b-${bi}`} style={{ gap: 4 }}>
            {lines.map((line, li) => (
              <InlineText key={`p-${bi}-${li}`} text={line} base={base} boldColor={colors.text} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

function InlineText({
  text,
  base,
  boldColor,
}: {
  text: string;
  base: TextStyle;
  boldColor: string;
}) {
  const parts = tokenizeInline(text);
  return (
    <Text style={base}>
      {parts.map((p, i) => {
        if (p.kind === 'bold') {
          return (
            <Text key={i} style={{ fontFamily: fonts.uiSemi, color: boldColor }}>
              {p.text}
            </Text>
          );
        }
        if (p.kind === 'italic') {
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {p.text}
            </Text>
          );
        }
        return <Text key={i}>{p.text}</Text>;
      })}
    </Text>
  );
}

function tokenizeInline(s: string): { kind: 'text' | 'bold' | 'italic'; text: string }[] {
  const out: { kind: 'text' | 'bold' | 'italic'; text: string }[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ kind: 'text', text: s.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith('**')) {
      out.push({ kind: 'bold', text: token.slice(2, -2) });
    } else {
      out.push({ kind: 'italic', text: token.slice(1, -1) });
    }
    last = m.index + token.length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  if (out.length === 0) out.push({ kind: 'text', text: s });
  return out;
}
