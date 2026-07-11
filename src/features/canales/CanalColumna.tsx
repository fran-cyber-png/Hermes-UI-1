import { useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Interaccion } from './types';
import InteraccionCard from './InteraccionCard';
import { TIPO_META, tipoDe } from './tipos';

interface Props {
  titulo: string;
  subtitulo: string;
  icono: LucideIcon;
  color: string;
  interacciones: Interaccion[];
  total: number;
  pideInfo: number;
  filtrando: boolean;
  cargando: boolean;
  bloqueado?: string;
  nota?: string;
  respondidas: number[];
  onAbrir: (i: Interaccion) => void;
  hayMas: boolean;
  cargandoMas: boolean;
  onCargarMas: () => void;
}

export default function CanalColumna({
  titulo,
  subtitulo,
  icono: Icono,
  color,
  interacciones,
  total,
  pideInfo,
  filtrando,
  cargando,
  bloqueado,
  nota,
  respondidas,
  onAbrir,
  hayMas,
  cargandoMas,
  onCargarMas,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll infinito: pide más al acercarse al fondo. Con 15.000 interacciones,
  // traerlas todas de una no tiene sentido.
  function onScroll() {
    const el = scrollRef.current;
    if (!el || !hayMas || cargandoMas) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) onCargarMas();
  }
  // La composición del canal: cuánto de lo que entra es realmente una oportunidad.
  const conteo = { info: 0, comentario: 0, chat: 0 };
  for (const i of interacciones) conteo[tipoDe(i)] += 1;

  return (
    <section className="flex h-[calc(100dvh-15rem)] min-h-[30rem] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <header className="shrink-0 text-white" style={{ backgroundColor: color }}>
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2">
            <Icono size={15} />
            <span className="font-heading text-[15px] font-bold">{titulo}</span>
            <span className="ml-auto text-xs opacity-70">{subtitulo}</span>
          </div>

          {!bloqueado && (
            <div className="mt-3 flex items-end justify-between">
              <div>
                <div className="font-heading text-3xl font-extrabold leading-none tabular-nums">
                  {pideInfo.toLocaleString('es')}
                </div>
                <div className="mt-1 text-xs opacity-80">piden información</div>
              </div>
              <div className="text-right text-xs opacity-65">
                de {total.toLocaleString('es')}
              </div>
            </div>
          )}
        </div>

        {/* La leyenda: qué significa cada color, ahí donde se usa. */}
        {!bloqueado && !cargando && interacciones.length > 0 && (
          <div className="mt-3 flex gap-3 border-t border-white/15 px-5 py-2 text-xs">
            {(['info', 'comentario', 'chat'] as const).map((t) =>
              conteo[t] > 0 ? (
                <span key={t} className="flex items-center gap-1.5 opacity-90">
                  <span className={`h-2 w-2 rounded-full ${TIPO_META[t].punto}`} />
                  {conteo[t]} {TIPO_META[t].label.toLowerCase()}
                </span>
              ) : null,
            )}
          </div>
        )}
      </header>

      {bloqueado ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="max-w-xs text-center text-sm leading-relaxed text-muted-foreground">{bloqueado}</p>
        </div>
      ) : cargando ? (
        <p className="p-5 text-sm text-muted-foreground">Cargando...</p>
      ) : interacciones.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">
          {filtrando ? 'Nadie pidió información por este canal.' : 'Todavía no entró nada por aquí.'}
        </p>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {interacciones.map((i) => (
            <InteraccionCard
              key={i.id}
              i={i}
              respondida={respondidas.includes(i.id)}
              onClick={() => onAbrir(i)}
            />
          ))}
          {cargandoMas && (
            <p className="py-4 text-center text-xs text-muted-foreground">Cargando más...</p>
          )}
        </div>
      )}

      {nota && !bloqueado && (
        <footer className="shrink-0 border-t border-border bg-muted px-4 py-2 text-xs leading-relaxed text-muted-foreground">
          {nota}
        </footer>
      )}
    </section>
  );
}
