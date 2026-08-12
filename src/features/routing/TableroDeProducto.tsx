import { useLayoutEffect, useRef, useState } from 'react';
import { Boxes, FileText, Megaphone, User } from 'lucide-react';
import { nombreCorto } from '../notas/espacios';

/** Una campaña o un formulario del producto, con sus cables actuales. */
export interface PiezaDelProducto {
  id: string;
  titulo: string;
  origen: 'campana' | 'formulario';
  volumen: number;
  vendedoras: string[];
}

/**
 * EL TABLERO DE UN PRODUCTO — tres columnas: el producto, lo que le entra, y las
 * vendedoras.
 *
 * ══ 🔴 POR QUÉ TRES Y NO DOS ═════════════════════════════════════════════════
 *
 * Porque cablear un producto **escribe el cable en cada una de sus campañas y
 * formularios** (decisión del dueño del 12-ago-2026: no hay herencia, lo que se
 * ve en cada renglón ES la regla). Una acción masiva sobre cosas que no se ven
 * es la forma más rápida de que alguien pierda una regla que puso a mano — así
 * que acá se ve el abanico completo ANTES de tocar nada.
 *
 * Y de yapa deja a la vista lo que ningún cartel explicaría igual de bien: que
 * una pieza tenga cables distintos de las otras. No hace falta una etiqueta
 * «mezclado»: se ven dos cables yendo a lugares distintos.
 *
 * ══ EL FALSO POSITIVO SE VE, Y ESO ES EL PUNTO ═══════════════════════════════
 *
 * El producto lo resuelve `alias_curso` por texto, y tiene falsos positivos
 * medidos: «Programa Premium ChatGPT Pro para consultoría política» entra a
 * DIPCPOL porque su alias dice «consultoría política». Con las tres columnas eso
 * es una fila que se lee mal a simple vista; con dos, era invisible.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
export function TableroDeProducto({
  nombre,
  piezas,
  destinos,
  guardando,
  onCablearTodo,
}: {
  nombre: string;
  piezas: PiezaDelProducto[];
  destinos: string[];
  guardando: boolean;
  onCablearTodo: (vendedoras: string[]) => void;
}) {
  const marco = useRef<HTMLDivElement>(null);
  const puertoProducto = useRef<HTMLDivElement>(null);
  const puertosPieza = useRef(new Map<string, { izq: HTMLDivElement; der: HTMLDivElement }>());
  const puertosVend = useRef(new Map<string, HTMLDivElement>());
  const [cables, setCables] = useState<{ id: string; d: string; tenue: boolean }[]>([]);

  /** Lo que van a quedar todas si se aplica: la unión de lo que ya hay. */
  const [seleccion, setSeleccion] = useState<string[]>(() => {
    const todas = new Set(piezas.flatMap((p) => p.vendedoras));
    return [...todas].sort((a, b) => a.localeCompare(b, 'es'));
  });

  useLayoutEffect(() => {
    function redibujar() {
      const base = marco.current?.getBoundingClientRect();
      const origen = puertoProducto.current?.getBoundingClientRect();
      if (!base || !origen) return;
      const curva = (x1: number, y1: number, x2: number, y2: number) => {
        const c = Math.max(24, (x2 - x1) / 2);
        return `M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`;
      };
      const centro = (r: DOMRect) => [r.left - base.left, r.top + r.height / 2 - base.top] as const;
      const salida = [origen.right - base.left, origen.top + origen.height / 2 - base.top] as const;

      const nuevos: { id: string; d: string; tenue: boolean }[] = [];
      for (const p of piezas) {
        const puertos = puertosPieza.current.get(p.id);
        if (!puertos) continue;
        const [xi, yi] = centro(puertos.izq.getBoundingClientRect());
        // El cable producto → pieza es PERTENENCIA, no regla: va tenue para que
        // no compita con los que sí se pueden tocar.
        nuevos.push({ id: `p:${p.id}`, d: curva(salida[0], salida[1], xi, yi), tenue: true });

        const der = puertos.der.getBoundingClientRect();
        const [xd, yd] = [der.right - base.left, der.top + der.height / 2 - base.top];
        for (const v of p.vendedoras) {
          const destino = puertosVend.current.get(v)?.getBoundingClientRect();
          if (!destino) continue;
          const [xv, yv] = centro(destino);
          nuevos.push({ id: `${p.id}->${v}`, d: curva(xd, yd, xv, yv), tenue: false });
        }
      }
      setCables(nuevos);
    }
    redibujar();
    const obs = new ResizeObserver(redibujar);
    if (marco.current) obs.observe(marco.current);
    return () => obs.disconnect();
  }, [nombre, piezas.map((p) => `${p.id}:${p.vendedoras.join(',')}`).join('|'), destinos.join('|')]);

  function alternar(v: string) {
    setSeleccion((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  }

  /**
   * 🔴 LO QUE SE VA A PISAR, NOMBRADO ANTES DE TOCARLO. Es lo único que hace
   * aceptable una acción masiva: sin esto, aplicar sobre cinco piezas borra en
   * silencio la regla que alguien puso a mano sobre una.
   */
  const distintas = piezas.filter(
    (p) => p.vendedoras.length > 0 && p.vendedoras.join('|') !== seleccion.join('|'),
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={marco} className="relative flex min-h-0 flex-1 items-center gap-12 overflow-auto p-6">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
          {cables.map((c) => (
            <path
              key={c.id}
              d={c.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={c.tenue ? 1.5 : 2}
              strokeDasharray={c.tenue ? '4 4' : undefined}
              className={c.tenue ? 'text-border' : 'text-navy/60'}
            />
          ))}
        </svg>

        {/* ── 1. EL PRODUCTO ── */}
        <div className="relative w-[13rem] shrink-0">
          <div className="rounded-xl border border-navy/25 bg-card p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <Boxes size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-navy" aria-hidden />
              <p className="text-xs font-medium leading-snug text-foreground">{nombre}</p>
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {piezas.filter((p) => p.origen === 'campana').length} campañas ·{' '}
              {piezas.filter((p) => p.origen === 'formulario').length} formularios
            </p>
          </div>
          <div
            ref={puertoProducto}
            className="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-card bg-navy"
          />
        </div>

        {/* ── 2. LO QUE LE ENTRA ── */}
        <div className="relative flex w-[16rem] shrink-0 flex-col gap-1.5">
          {piezas.map((p) => (
            <div key={p.id} className="relative">
              <div
                ref={(el) => {
                  const previo = puertosPieza.current.get(p.id);
                  if (el) puertosPieza.current.set(p.id, { izq: el, der: previo?.der ?? el });
                }}
                className="absolute -left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-card bg-border"
              />
              <div className="rounded-xl border border-border bg-card px-2.5 py-1.5">
                <p className="flex items-center gap-1.5">
                  {p.origen === 'campana' ? (
                    <Megaphone size={11} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <FileText size={11} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    {p.titulo}
                  </span>
                </p>
                <p className="truncate pl-4 text-[10px] text-muted-foreground">
                  {p.vendedoras.length === 0
                    ? 'sin cables'
                    : p.vendedoras.map(nombreCorto).join(', ')}
                </p>
              </div>
              <div
                ref={(el) => {
                  const previo = puertosPieza.current.get(p.id);
                  if (el) puertosPieza.current.set(p.id, { izq: previo?.izq ?? el, der: el });
                }}
                className={
                  'absolute -right-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-card ' +
                  (p.vendedoras.length ? 'bg-navy' : 'bg-muted')
                }
              />
            </div>
          ))}
        </div>

        {/* ── 3. LAS VENDEDORAS ── */}
        <div className="relative flex w-[12.5rem] shrink-0 flex-col gap-1.5">
          {destinos.map((d) => {
            const puesta = seleccion.includes(d);
            return (
              <div key={d} className="relative">
                <div
                  ref={(el) => {
                    if (el) puertosVend.current.set(d, el);
                    else puertosVend.current.delete(d);
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
                  className={
                    'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-[color,background-color,border-color,transform] duration-200 ease-house active:scale-[0.99] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                    (puesta
                      ? 'border-navy/30 bg-navy/5 text-navy'
                      : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-navy')
                  }
                >
                  <User size={13} strokeWidth={2} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">{nombreCorto(d)}</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-t border-border px-6 py-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Aplicar deja este cable en{' '}
          <strong className="font-semibold">
            {piezas.length === 1 ? 'la única pieza' : `las ${piezas.length} piezas`}
          </strong>{' '}
          del producto: no crea una regla aparte, escribe la de cada una.
          {distintas.length > 0 && (
            <>
              {' '}
              <span className="text-foreground">
                {distintas.length === 1
                  ? `«${distintas[0]!.titulo}» tiene ${distintas[0]!.vendedoras.map(nombreCorto).join(', ')} y va a quedar como las demás.`
                  : `${distintas.length} piezas tienen otro cable y van a quedar como las demás.`}
              </span>
            </>
          )}{' '}
          La campaña que Meta estrene el mes que viene nace sin regla: hay que volver acá.
        </p>
        <button
          type="button"
          onClick={() => onCablearTodo(seleccion)}
          disabled={guardando || piezas.length === 0}
          className="rounded-lg bg-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-transform duration-200 ease-house active:scale-[0.97] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {guardando
            ? 'Aplicando…'
            : seleccion.length === 0
              ? piezas.length === 1
                ? 'Sacar el cable'
                : `Sacar los cables de las ${piezas.length}`
              : piezas.length === 1
                ? 'Aplicar'
                : `Aplicar a las ${piezas.length}`}
        </button>
      </div>
    </div>
  );
}
