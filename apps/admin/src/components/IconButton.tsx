import type { ButtonHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  variant?: Variant;
  size?: 'sm' | 'md';
};

/** Icon-only control — ghost by default (no fill/border). */
export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className, ...rest }: Props) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={['icon-btn', `icon-btn-${variant}`, size === 'sm' ? 'icon-btn-sm' : '', className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      <Icon size={size === 'sm' ? 15 : 17} strokeWidth={1.75} />
    </button>
  );
}
