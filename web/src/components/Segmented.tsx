export type SegmentedOption = { id: string; label: string };

type Props = {
  options: SegmentedOption[];
  value: string;
  onChange: (id: string) => void;
};

export function Segmented({ options, value, onChange }: Props) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} type="button" className={o.id === value ? 'active' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
