import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

type Props = {
  open: boolean;
  title: string;
  /** Leave out for a modal the user must complete (no close button, no click-away). */
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  compact?: boolean;
  /** Opaque backdrop, for when there is no page behind the modal. */
  solid?: boolean;
};

export function Modal({ open, title, onClose, children, footer, wide, compact, solid }: Props) {
  if (!open) return null;
  return createPortal(
    <div
      className={['modal-overlay', solid && 'solid'].filter(Boolean).join(' ')}
      onMouseDown={(e) => onClose && e.target === e.currentTarget && onClose()}
    >
      <div className={['modal-panel', wide && 'wide', compact && 'compact'].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose ? (
            <Button variant="icon" aria-label="Close" onClick={onClose}>
              <X size={16} />
            </Button>
          ) : null}
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
