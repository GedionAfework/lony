/** Lony's loading screen: the logo breathing over a soft ring, the name, and a moving bar. */
export function BrandLoader({ full = false, label }: { full?: boolean; label?: string }) {
  return (
    <div className={`brand-loader ${full ? 'full' : ''}`} role="status" aria-live="polite">
      <div className="brand-loader-mark">
        <span className="brand-loader-ring" aria-hidden />
        <img src="/lony-logo.png" alt="" width={56} height={56} />
      </div>
      <div className="brand-loader-name">Lony</div>
      <div className="brand-loader-bar" aria-hidden>
        <span />
      </div>
      <span className="sr-only">{label || 'Loading'}</span>
      {label ? <div className="brand-loader-label">{label}</div> : null}
    </div>
  );
}
