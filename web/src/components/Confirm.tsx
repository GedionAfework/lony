import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button } from './Button';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  /** Text on the main button, e.g. "Delete". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the button red; use it for anything that removes data. */
  tone?: 'danger' | 'default';
  /** When set, the person must type this word before the button unlocks. */
  typeToConfirm?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Replaces the browser's confirm(): `if (!(await confirm({...}))) return;` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) return;
    const focusTimer = setTimeout(() => (pending.typeToConfirm ? inputRef.current : confirmRef.current)?.focus(), 30);
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
    }
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
    };
  }, [pending, close]);

  const danger = pending?.tone === 'danger';
  const locked = Boolean(pending?.typeToConfirm) && typed.trim().toUpperCase() !== pending?.typeToConfirm?.toUpperCase();

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending
        ? createPortal(
            <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
              <div className="modal-panel confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
                <div className={`confirm-icon ${danger ? 'danger' : ''}`}>{danger ? <AlertTriangle size={22} /> : <HelpCircle size={22} />}</div>
                <h3 id="confirm-title">{pending.title}</h3>
                {pending.body ? <div className="confirm-body">{pending.body}</div> : null}
                {pending.typeToConfirm ? (
                  <div className="field confirm-type">
                    <label htmlFor="confirm-type">
                      Type <strong>{pending.typeToConfirm}</strong> to confirm
                    </label>
                    <input
                      id="confirm-type"
                      ref={inputRef}
                      value={typed}
                      autoComplete="off"
                      onChange={(e) => setTyped(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !locked && close(true)}
                    />
                  </div>
                ) : null}
                <div className="confirm-actions">
                  <Button variant="secondary" onClick={() => close(false)}>
                    {pending.cancelLabel || 'Cancel'}
                  </Button>
                  <Button ref={confirmRef} className={danger ? 'btn-solid-danger' : undefined} disabled={locked} onClick={() => close(true)}>
                    {pending.confirmLabel || 'Confirm'}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
