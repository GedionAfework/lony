import type { ReactNode } from 'react';
import {
  ArrowDownLeft,
  Briefcase,
  Car,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Plane,
  Receipt,
  ShoppingBag,
  Smartphone,
  Tv,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const HUES = ['#159E9E', '#E07B12', '#2F7DD3', '#8B5CF6', '#E0457B', '#0E8A6A', '#C9A227', '#5B6B82'];

const ICONS: [RegExp, LucideIcon][] = [
  [/food|grocer|restaurant|lunch|dinner|cafe|coffee|meal/i, Utensils],
  [/transport|taxi|ride|fuel|car|bus|uber/i, Car],
  [/hous|rent|home|mortgage/i, House],
  [/util|electric|water|power|internet/i, Zap],
  [/phone|mobile|airtime|telecom|data/i, Smartphone],
  [/salary|wage|work|freelance|business/i, Briefcase],
  [/subscri|netflix|tv|stream|music/i, Tv],
  [/shop|cloth|fashion/i, ShoppingBag],
  [/health|medic|pharm|doctor|hospital/i, HeartPulse],
  [/school|educat|tuition|book|course/i, GraduationCap],
  [/travel|trip|flight|hotel/i, Plane],
  [/gift|donat|church|charity/i, Gift],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A stable colour for a category or person name. */
export function hueFor(name: string): string {
  return HUES[hash(name.toLowerCase()) % HUES.length];
}

export function iconFor(category: string, kind?: string): LucideIcon {
  for (const [re, icon] of ICONS) if (re.test(category)) return icon;
  return kind === 'income' ? ArrowDownLeft : Receipt;
}

/** Round tinted icon for a category. */
export function CategoryIcon({ category, kind, size = 40 }: { category: string; kind?: string; size?: number }) {
  const Icon = iconFor(category || '', kind);
  const color = hueFor(category || kind || 'x');
  return (
    <span className="cat-icon" style={{ width: size, height: size, color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <Icon size={Math.round(size * 0.45)} strokeWidth={2} />
    </span>
  );
}

/** Initials avatar with a stable colour. */
export function Initials({ name, size = 38 }: { name: string; size?: number }) {
  const parts = name.trim().split(/\s+/);
  const text = ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  const color = hueFor(name);
  return (
    <span className="initials" style={{ width: size, height: size, fontSize: size * 0.36, color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}>
      {text}
    </span>
  );
}

/** Card title row: a heading on the left, an optional action on the right. */
export function SectionHead({ title, action, sub }: { title: string; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="section-head">
      <div>
        <h3>{title}</h3>
        {sub ? <div className="section-sub">{sub}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** The filled teal summary card at the top of a page. */
export function Hero({ label, value, sub, children, aside }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode; aside?: ReactNode }) {
  return (
    <section className="hero">
      <div className="hero-main">
        <div className="hero-label">{label}</div>
        <div className="hero-value">{value}</div>
        {sub ? <div className="hero-sub">{sub}</div> : null}
        {children}
      </div>
      {aside ? <div className="hero-aside">{aside}</div> : null}
    </section>
  );
}

export function HeroStat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'up' | 'down' }) {
  return (
    <div className={`hero-stat ${tone ?? ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
