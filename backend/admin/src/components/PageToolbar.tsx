import type { ReactNode } from 'react';

type Props = {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
};

/** Top action bar: filter/actions pinned top-right; primary tools below or left. */
export function PageToolbar({ left, right, className }: Props) {
  return (
    <div className={['page-toolbar', className || ''].filter(Boolean).join(' ')}>
      {right ? <div className="page-toolbar-top">{right}</div> : null}
      {left ? <div className="page-toolbar-body">{left}</div> : null}
    </div>
  );
}
