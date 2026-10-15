import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
};

/** Horizontal group of Button/IconButton with consistent spacing. */
export function ButtonGroup({ children, className, align = 'start' }: Props) {
  return (
    <div
      className={[
        'btn-group',
        align === 'center' ? 'btn-group-center' : '',
        align === 'end' ? 'btn-group-end' : '',
        className || '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
