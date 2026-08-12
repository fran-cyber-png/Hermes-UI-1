import { useLayoutEffect, useRef, useState } from 'react';
import { Megaphone, User } from 'lucide-react';
import { nombreCorto } from '../notas/espacios';
import { rotuloEstado, type CampanaEnRouting } from './routing';

/**
 * EL TABLERO DE CABLES — la campaña a la izquierda, las vendedoras a la derecha,
 * y entre medio los cables que dicen a quiénes les puede caer.
 *
 * ══ POR QUÉ CABLES Y NO UNA LISTA DE TILDES ══════════════════════════════════
 *
 * Porque lo que hay que entender de un ruteo no es «quién está tildado» sino
 * **por dónde va a salir el próximo lead**, y eso es una relación. Con dos
 * conectadas y cinco sueltas, el dibujo contesta de un vistazo algo que una
 * lista de checkboxes obliga a reconstruir leyendo.
 *
 * ══ 🔴 LOS CABLES SE DIBUJAN MIDIENDO EL DOM, NO CALCULANDO POSICIONES ═══════
 *
 * Las curvas salen de `getBoundingClientRect()` de los puertos reales, así que
 * siguen andando si cambia el alto de una tarjeta, si entra una vendedora más o
 * si el panel se angosta. Calcular las coordenadas a mano sería una segunda
 * fuente de verdad sobre dónde están las cosas — y el síntoma de que divergió es
 * un cable que sale del aire.
 *
 * ══ QUÉ NO ES ════════════════════════════════════════════════════════════════
 *
 * **Un cable no es «esta persona recibe»: es «esta persona ENTRA AL SORTEO».**
 * Con tres cables, cada lead le cae a UNA de las tres —la que menos tiene—, no a
 * las tres. Por eso el pie lo dice con todas las letras: sin esa frase, «conecté
 * a dos» se lee como «las dos lo ven», que es justo el problema que el reparto
 * vino a resolver.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
export function TableroDeCables({
  campana,
  destinos,
  guardando,
  onConectar,
}: {
  campana: CampanaEnRouting;
  destinos: string[];
  guardando: boolean;
  onConectar: (vendedoras: string[]) => void;
}) {
  const conectadas = new Set(campana.vendedoras);
  const marco = useRef<HTMLDivElement>(null);
  const puertoCampana = useRef<HTMLDivElement>(null);
  const puertos = useRef(new Map<string, HTMLDivElement>());
  const [cables, setCables] = useState<{ id: string; d: string }[]>([]);

  /**
   * ⚠️ `useLayoutEffect` y no `useEffect`: con el segundo, los cables se pintan
   * un cuadro DESPUÉS de las tarjetas y se ve el salto en cada cambio.
   *
   * Se recalcula al cambiar de campaña o de conexiones, y también cuando el
   * contenedor cambia de tamaño (`ResizeObserver`) — sin eso, angostar la
   * ventana dejaba los cables colgando donde estaban las cajas antes.
   */
  useLayoutEffect(() => {
    function redibujar() {
      const base = marco.current?.getBoundingClientRect();
      const origen = puertoCampana.current?.getBoundingClientRect();
      if (!base || !origen) return;
      const x1 = origen.right - base.left;
      const y1 = origen.top + origen.height / 2 - base.top;

      setCables(
        campana.vendedoras.flatMap((v) => {
          const destino = puertos.current.get(v)?.getBoundingClientRect();
          if (!destino) return [];
          const x2 = destino.left - base.left;
          const y2 = destino.top + destino.height / 2 - base.top;
          // Bézier horizontal: las tangentes salen y entran en horizontal, así el
          // cable se lee como un cable y no como una diagonal.
          const curva = Math.max(28, (x2 - x1) / 2);
          return [{ id: v, d: `M ${x1} ${y1} C ${x1 + curva} ${y1}, ${x2 - curva} ${y2}, ${x2} ${y2}` }];
        }),
      );
    }
    redibujar();
    const obs = new ResizeObserver(redibujar);
    if (marco.current) obs.observe(marco.current);
    return () => obs.disconnect();
  }, [campana.campanaId, campana.vendedoras.join('|'), destinos.join('|')]);

  function alternar(vendedora: string) {
    const siguiente = conectadas.has(vendedora)
      ? campana.vendedoras.filter((v) => v !== vendedora)
      : [...campana.vendedoras, vendedora];
    onConectar(siguiente);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={marco} className="relative flex min-h-0 flex-1 items-center justify-center gap-28 overflow-y-auto p-6">
        {/* Los cables van en una capa propia y `pointer-events-none`: si
            interceptaran el mouse, tapar√≠an los botones que hay debajo. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {cables.map((c) => (
            <path
              key={c.id}
              d={c.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="text-navy/60"
            />
          ))}
        </svg>

        {/* ── LA CAMPAÑA ── */}
        <div className="relative w-[16rem] shrink-0">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <Megaphone size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-navy" aria-hidden />
              <p className="text-xs font-medium leading-snug text-foreground">{campana.nombre}</p>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {rotuloEstado(campana.estado)} · {campana.personas}{' '}
              {campana.personas === 1 ? 'persona' : 'personas'}
            </p>
          </div>
          {/* El puerto: el punto del que salen todos los cables. */}
          <div
            ref={puertoCampana}
            className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-card bg-navy"
          />
        </div>

        {/* ── LAS VENDEDORAS ── */}
        <div className="relative flex w-[15rem] shrink-0 flex-col gap-1.5">
          {destinos.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              Esta línea todavía no tiene a nadie en el reparto.
            </p>
          )}
          {destinos.map((d) => {
            const puesta = conectadas.has(d);
            return (
              <div key={d} className="relative">
                <div
                  ref={(el) => {
                    if (el) puertos.current.set(d, el);
                    else puertos.current.delete(d);
                  }}
                  className={
                    'absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-card ' +
                    (puesta ? 'bg-navy' : 'bg-muted')
                  }
                />
                <button
                  type="button"
                  onClick={() => alternar(d)}
                  disabled={guardando}
                  aria-pressed={puesta}
                  aria-label={`${puesta ? 'Desconectar' : 'Conectar'} ${nombreCorto(d)}`}
                  className={
                    'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-[color,background-color,border-color,transform] duration-200 ease-house active:scale-[0.99] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                    (puesta
                      ? 'border-navy/30 bg-navy/5 text-navy'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-navy')
                  }
                >
                  <User size={13} strokeWidth={2} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{nombreCorto(d)}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide">
                    {puesta ? 'conectada' : ''}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 🔴 LA FRASE QUE EVITA EL MALENTENDIDO CARO. Sin ella, «conecté a dos» se
          lee como «las dos lo ven» — que es exactamente el problema que el
          reparto vino a resolver el 4-ago (dos contestan al mismo lead y nadie
          contesta a otro). */}
      <p className="shrink-0 border-t border-border px-6 py-3 text-[11px] leading-relaxed text-muted-foreground">
        {campana.vendedoras.length === 0
          ? 'Sin cables: los leads de esta campaña se reparten por la rueda general, como hasta ahora.'
          : campana.vendedoras.length === 1
            ? 'Todos los leads de esta campaña le caen a esa persona.'
            : `Cada lead le cae a UNA de las ${campana.vendedoras.length} conectadas — la que menos tiene. No a todas.`}{' '}
        La regla se aplica al primer mensaje de cada conversación nueva; cambiarla no mueve lo ya
        repartido.
      </p>
    </div>
  );
}
