import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { COUNTRIES } from '../lib/catalogs';
import { countryFlag, dialForCountry, dialOptionsForCountries, splitE164, toE164 } from '../lib/phone';

type Props = {
  label?: string;
  hint?: ReactNode;
  /** Full E.164 value (e.g. +251911234567), or '' when empty. */
  value: string;
  onChange: (e164: string) => void;
  /** Country to preselect when the value is empty (e.g. the user's country). */
  defaultCountry?: string;
  placeholder?: string;
  disabled?: boolean;
};

const DIAL_OPTIONS = dialOptionsForCountries(COUNTRIES);

/** Country-code picker followed by the national number; reports E.164. */
export function PhoneField({ label = 'Phone', hint, value, onChange, defaultCountry, placeholder = 'Phone number', disabled }: Props) {
  const fallback = defaultCountry && dialForCountry(defaultCountry) ? defaultCountry : 'ET';
  const parsed = useMemo(() => splitE164(value, fallback), [value, fallback]);
  const [country, setCountry] = useState(parsed.country);
  const [national, setNational] = useState(parsed.national);

  // Follow outside changes (loaded user, reset form) without fighting typing.
  useEffect(() => {
    if (value === toE164(country, national)) return;
    setCountry(parsed.country);
    setNational(parsed.national);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Until a number is typed, keep the picker on the suggested country.
  useEffect(() => {
    if (!value && !national && defaultCountry && dialForCountry(defaultCountry)) setCountry(defaultCountry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCountry]);

  function update(nextCountry: string, nextNational: string) {
    setCountry(nextCountry);
    setNational(nextNational);
    onChange(toE164(nextCountry, nextNational));
  }

  return (
    <div className="field phone-field">
      <label>{label}</label>
      <div className="phone-field-row">
        <div className="phone-field-code">
          <span aria-hidden>
            {countryFlag(country)} +{dialForCountry(country)}
          </span>
          <ChevronDown size={14} aria-hidden />
          <select
            aria-label="Country code"
            value={country}
            disabled={disabled}
            onChange={(e) => update(e.target.value, national)}
            title={DIAL_OPTIONS.find((o) => o.id === country)?.label}
          >
            {DIAL_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {countryFlag(o.id)} {o.label}
              </option>
            ))}
          </select>
        </div>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => update(country, e.target.value.replace(/[^\d\s()-]/g, ''))}
        />
      </div>
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}
