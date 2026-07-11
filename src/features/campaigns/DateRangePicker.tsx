import type { DatePreset } from './types';
import { DATE_PRESETS } from './constants';

interface Props {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
}

export default function DateRangePicker({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {DATE_PRESETS.map((p) => (
        <button
          type="button"
          key={p.value}
          onClick={() => onChange(p.value)}
          className={
            'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ' +
            (value === p.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-card border border-border text-muted-foreground hover:bg-muted')
          }
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
