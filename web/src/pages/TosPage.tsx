import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { useToast } from '../components/Toast';

export function TosPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const { showError } = useToast();
  const [version, setVersion] = useState('');
  const [document, setDocument] = useState('Loading Terms of Service…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getTOS()
      .then((res) => {
        setVersion(res.version);
        setDocument(res.document);
      })
      .catch((e) => showError(e instanceof Error ? e.message : 'Could not load Terms'));
  }, [showError]);

  async function onAccept() {
    if (!token) {
      navigate(-1);
      return;
    }
    setBusy(true);
    try {
      await api.acceptTOS(token);
      navigate(-1);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not accept Terms');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1 className="page-title">Terms of Service</h1>
      {version ? <div className="page-subtitle">Version {version}</div> : null}
      <div className="card" style={{ maxHeight: 480, overflowY: 'auto' }}>
        <p className="text-secondary" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
          {document}
        </p>
      </div>
      <div className="flex-row">
        <Button onClick={onAccept} busy={busy}>
          {busy ? 'Saving…' : 'Accept Terms'}
        </Button>
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
    </div>
  );
}
