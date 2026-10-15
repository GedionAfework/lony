type Props = {
  text: string;
  className?: string;
  muted?: boolean;
};

/** Lightweight rich text for AI replies: paragraphs, bullets, **bold**, *italic*. */
export function RichText({ text, className, muted }: Props) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  if (blocks.length === 0) return <span className={className}> </span>;

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 10, color: muted ? 'var(--muted)' : undefined }}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        const isList = lines.every((l) => /^(\s*[-•*]|\s*\d+[.)])\s+/.test(l) || !l.trim());
        if (isList) {
          return (
            <ul key={bi} style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines
                .filter((l) => l.trim())
                .map((line, li) => {
                  const cleaned = line.replace(/^(\s*[-•*]|\s*\d+[.)])\s+/, '').trim();
                  return (
                    <li key={li} style={{ fontSize: 14, lineHeight: 1.5 }}>
                      <Inline text={cleaned} />
                    </li>
                  );
                })}
            </ul>
          );
        }
        return (
          <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lines.map((line, li) => (
              <p key={li} style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
                <Inline text={line} />
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = tokenizeInline(text);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'bold') return <strong key={i}>{p.text}</strong>;
        if (p.kind === 'italic') return <em key={i}>{p.text}</em>;
        return <span key={i}>{p.text}</span>;
      })}
    </>
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
    if (token.startsWith('**')) out.push({ kind: 'bold', text: token.slice(2, -2) });
    else out.push({ kind: 'italic', text: token.slice(1, -1) });
    last = m.index + token.length;
  }
  if (last < s.length) out.push({ kind: 'text', text: s.slice(last) });
  if (out.length === 0) out.push({ kind: 'text', text: s });
  return out;
}
