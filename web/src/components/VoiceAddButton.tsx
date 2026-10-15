import { useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from './Button';

export type VoiceDraft = {
  kind?: 'income' | 'expense';
  title?: string;
  amount?: string;
  currency_code?: string;
  note?: string;
  occurred_at?: string;
  category_id?: string;
  account_id?: string;
  account_hint?: string;
  category_hint?: string;
  transcript?: string;
};

type Props = {
  token: string;
  disabled?: boolean;
  onDraft: (draft: VoiceDraft) => void;
  onError: (message: string) => void;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const i = text.indexOf('base64,');
      resolve(i >= 0 ? text.slice(i + 7) : text);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function VoiceAddButton({ token, disabled, onDraft, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  async function toggle() {
    if (disabled || busy) return;
    if (recording && recRef.current) {
      recRef.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Voice add needs a browser that can record audio');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        void (async () => {
          setBusy(true);
          try {
            const b64 = await blobToBase64(blob);
            const res = await api.parseCashflowVoice(token, {
              mime: rec.mimeType || 'audio/webm',
              audio_base64: b64,
            });
            const ex = res.extract || {};
            onDraft({
              kind: ex.kind === 'income' ? 'income' : ex.kind === 'expense' ? 'expense' : undefined,
              title: ex.title,
              amount: ex.amount,
              currency_code: ex.currency_code,
              note: ex.note,
              occurred_at: ex.occurred_at,
              category_id: ex.category_id,
              account_id: ex.account_id,
              account_hint: ex.account_hint,
              category_hint: ex.category_hint,
              transcript: ex.transcript,
            });
          } catch (e) {
            onError(e instanceof Error ? e.message : 'Could not parse voice');
          } finally {
            setBusy(false);
          }
        })();
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Microphone permission required');
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => void toggle()} disabled={disabled || busy}>
      <Mic size={14} />
      {busy ? 'Listening…' : recording ? 'Stop' : 'Say it'}
    </Button>
  );
}
