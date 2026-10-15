import { formatMoney } from '../lib/format';

type Tone = 'default' | 'positive' | 'negative' | 'muted';
type Size = 'sm' | 'md' | 'lg' | 'xl';

type Props = {
  value: string | number | null | undefined;
  currency?: string | null;
  size?: Size;
  tone?: Tone;
  locale?: string | null;
  /** Value is already a formatted string; render as-is. */
  raw?: boolean;
};

export function Money({ value, currency, size = 'md', tone = 'default', locale, raw }: Props) {
  const text = raw ? String(value ?? '') : formatMoney(value, currency, locale || 'en');
  const classes = ['money', `money-${size}`, tone !== 'default' && `money-${tone}`].filter(Boolean).join(' ');
  return <span className={classes}>{text}</span>;
}
