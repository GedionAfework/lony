import type { HTMLAttributes, ReactNode } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  tight?: boolean;
  accent?: boolean;
};

export function Card({ children, tight, accent, className, ...rest }: Props) {
  const classes = ['card', tight && 'card-tight', accent && 'card-accent-primary', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

export function CardRow({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['card-row', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}
