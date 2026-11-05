import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

/** **bold** spans inside a line. */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>,
  );
}

/** Just enough Markdown for the Terms: headings, bullets, bold, rules and paragraphs. */
function TermsBody({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: number) => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${key}`}>
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  markdown
    .replace(/\r/g, '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trimEnd();
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        bullets.push(bullet[1]);
        return;
      }
      flush(i);
      if (!line.trim() || /^#\s/.test(line)) return;
      if (/^---+$/.test(line.trim())) return void blocks.push(<hr key={i} />);
      const h = /^(#{2,3})\s+(.*)$/.exec(line);
      if (h) return void blocks.push(h[1].length === 2 ? <h2 key={i}>{h[2]}</h2> : <h3 key={i}>{h[2]}</h3>);
      blocks.push(<p key={i}>{inline(line)}</p>);
    });
  flush(-1);
  return <div className="terms-body">{blocks}</div>;
}

export function TosPage() {
  const { token, user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [version, setVersion] = useState('');
  const [document, setDocument] = useState('');
  const [busy, setBusy] = useState(false);
  const [justAccepted, setJustAccepted] = useState(false);

  useEffect(() => {
    api
      .getTOS()
      .then((res) => {
        setVersion(res.version);
        setDocument(res.document);
      })
      .catch((e) => showError(e instanceof Error ? e.message : 'Could not load Terms'));
  }, [showError]);

  // Accepting happens once per version; after that only a note is shown.
  const accepted = justAccepted || (Boolean(version) && user?.tos_version === version);
  const acceptedOn = user?.tos_accepted_at ? new Date(user.tos_accepted_at) : null;

  async function onAccept() {
    if (!token) {
      navigate(-1);
      return;
    }
    setBusy(true);
    try {
      await api.acceptTOS(token);
      setJustAccepted(true);
      await refreshMe().catch(() => undefined);
      navigate(-1);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not accept Terms');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <div className="terms-head">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="page-title">Terms of Service</h1>
          {version ? <div className="muted" style={{ fontSize: 13 }}>Version {version.replace(/^tos-/, '')}</div> : null}
        </div>
      </div>
      <div className="card terms-card">{document ? <TermsBody markdown={document} /> : <p className="muted">Loading…</p>}</div>
      {accepted ? (
        <div className="terms-accepted">
          <CheckCircle2 size={18} />
          {acceptedOn && !justAccepted && !Number.isNaN(acceptedOn.getTime())
            ? `You accepted these terms on ${acceptedOn.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`
            : 'You accepted these terms'}
        </div>
      ) : token ? (
        <Button onClick={onAccept} busy={busy} disabled={!document}>
          {busy ? 'Saving…' : 'I accept the Terms'}
        </Button>
      ) : null}
    </div>
  );
}
