import type { Objective } from './types';
import { OBJECTIVE_INFO } from './constants';
import { cardClass, cardHeaderClass } from '../../lib/styles';

interface Props {
  objectives: Objective[];
  objective: string;
  onChange: (value: string) => void;
}

export default function ObjectivePicker({ objectives, objective, onChange }: Props) {
  return (
    <div className={cardClass}>
      <div className={cardHeaderClass}>2. Objetivo de la campaña</div>
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {objectives.map((o) => {
          const Icon = OBJECTIVE_INFO[o.value]?.icon;
          return (
            <button
              type="button"
              key={o.value}
              onClick={() => onChange(o.value)}
              className={
                'text-left rounded-xl border p-3 transition-colors ' +
                (objective === o.value
                  ? 'border-primary bg-accent ring-1 ring-primary'
                  : 'border-border hover:bg-muted')
              }
            >
              {Icon && <Icon className="mb-1 text-navy" size={20} />}
              <div className="text-sm font-bold text-foreground">{o.label}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{OBJECTIVE_INFO[o.value]?.blurb ?? ''}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
