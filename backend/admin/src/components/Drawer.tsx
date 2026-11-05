import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  width?: number;
};

/** Slide-over panel from the right. Esc or the backdrop closes it. */
export function Drawer({ open, onClose, title, eyebrow, icon, actions, footer, children, width = 480 }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-root" role="presentation">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <header className="drawer-header">
          {icon ? <div className="drawer-icon">{icon}</div> : null}
          <div className="drawer-heading">
            {eyebrow ? <div className="drawer-eyebrow">{eyebrow}</div> : null}
            <h2>{title}</h2>
          </div>
          <div className="drawer-header-actions">
            {actions}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
              <X size={18} strokeWidth={2} />
            </button>
          </div>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <footer className="drawer-footer">{footer}</footer> : null}
      </aside>
    </div>
  );
}

/** Label/value rows used inside drawers and settings panels. */
export function DetailList({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="detail-list">
      {rows.map(([k, v], i) => (
        <div key={i} className="detail-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
