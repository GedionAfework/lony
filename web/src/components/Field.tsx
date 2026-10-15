import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { formatAmountCommas } from '../lib/format';

type BaseProps = {
  label: string;
  hint?: ReactNode;
};

type FieldProps = BaseProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
    onChange: (value: string) => void;
    money?: boolean;
  };

export function Field({ label, hint, money, onChange, className, ...rest }: FieldProps) {
  return (
    <div className={['field', money && 'money'].filter(Boolean).join(' ')}>
      <label>{label}</label>
      <input
        {...rest}
        className={className}
        onChange={(e) => onChange(money ? formatAmountCommas(e.target.value) : e.target.value)}
      />
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

type TextAreaProps = BaseProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> & {
    onChange: (value: string) => void;
  };

export function TextAreaField({ label, hint, onChange, ...rest }: TextAreaProps) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea {...rest} onChange={(e) => onChange(e.target.value)} />
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}

export type SelectOption = { id: string; label: string };

type SelectProps = BaseProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'value'> & {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
  };

export function SelectField({ label, hint, value, onChange, options, placeholder, ...rest }: SelectProps) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <div className="muted" style={{ fontSize: 12 }}>{hint}</div> : null}
    </div>
  );
}
