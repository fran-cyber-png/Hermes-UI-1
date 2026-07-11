import type { Rango } from './types';

const RANGOS: { valor: Rango; label: string }[] = [
  { valor: '7d', label: '7 días' },
  { valor: '30d', label: '30 días' },
  { valor: '90d', label: '90 días' },
  { valor: '1y', label: '1 año' },
  { valor: 'todo', label: 'Todo' },
];

/** `oscuro` es para el hero navy: el mismo control, sobre fondo azul. */
export default function RangoPicker({
  valor,
  onChange,
  oscuro = false,
}: {
  valor: Rango;
  onChange: (r: Rango) => void;
  oscuro?: boolean;
}) {
  return (
    <div
      className={'flex gap-1 rounded-xl p-1 ' + (oscuro ? 'bg-white/10' : 'border border-border bg-card')}
    >
      {RANGOS.map((r) => {
        const activo = valor === r.valor;
        return (
          <button
            key={r.valor}
            type="button"
            onClick={() => onChange(r.valor)}
            className={
              'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
              (activo
                ? oscuro
                  ? 'bg-white text-navy'
                  : 'bg-primary text-primary-foreground'
                : oscuro
                  ? 'text-navy-muted hover:text-white'
                  : 'text-muted-foreground hover:bg-muted')
            }
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
