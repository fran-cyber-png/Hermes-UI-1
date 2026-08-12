import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Boxes, ChevronRight, FileText, Megaphone, User } from 'lucide-react';
import {
  alSoltar,
  claveDeCable,
  curva,
  sePuedeUnir,
  type CableLienzo,
  type ColumnaLienzo,
  type NodoLienzo,
} from './reglasDelLienzo';

/**
 * EL LIENZO — columnas de nodos, y cables que se tiran de un puerto al otro.
 *
 * ══ 🔴 EL GESTO PRODUCE LA COSA, Y ESO ERA EL DEFECTO ════════════════════════
 *
 * El tablero anterior dibujaba **lo guardado** y no lo pendiente: tocabas una
 * vendedora, quedaba marcada, y **no salía ningún cable** hasta apretar
 * «Aplicar». El dueño lo dijo con todas las letras el 12-ago-2026 mirando la
 * captura: *«no se entiende bien cómo se enlazan»*. Acá los cables salen de
 * `cables`, que es el estado de la pantalla — el cable aparece en el mismo
 * cuadro que el gesto, y si el server lo rechaza, se va.
 *
 * ══ UN SOLO MODELO DE INTERACCIÓN ════════════════════════════════════════════
 *
 * Antes convivían dos: en una campaña suelta el clic guardaba al instante y en
 * un producto armaba una selección que había que aplicar. La misma acción visual
 * hacía dos cosas según qué hubieras elegido en la lista. Ahora hay uno solo:
 *
 *   · **arrastrar** de un puerto al siguiente conecta;
 *   · **soltar sobre uno ya conectado** lo corta (el mismo gesto deshace);
 *   · **tocar el cable** lo corta — es la operación inversa y tiene que estar
 *     donde está el cable, no en la tarjeta;
 *   · **tocar la tarjeta** conecta o corta, como atajo: arrastrar en un trackpad
 *     con una mano ocupada es peor que un clic, y el teclado no arrastra.
 *
 * ══ ACCESIBILIDAD: LOS PUERTOS SON BOTONES ═══════════════════════════════════
 *
 * `Enter` sobre un puerto lo ARMA y `Enter` sobre otro cierra el cable; `Escape`
 * cancela. Un lienzo que solo se puede usar con el mouse deja afuera a quien
 * navega con teclado, y acá lo que se configura es a quién le entra la plata.
 *
 * ══ LOS CABLES SE MIDEN, NO SE CALCULAN ══════════════════════════════════════
 *
 * Las curvas salen del `getBoundingClientRect()` de los puertos reales, así que
 * siguen andando si cambia el alto de una tarjeta o se angosta el panel.
 * Calcular las coordenadas a mano sería una segunda fuente de verdad sobre dónde
 * están las cosas, y el síntoma de que divergió es un cable que sale del aire.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
export function Lienzo({
  columnas,
  cables,
  onConectar,
  onCortar,
  onEntrar,
}: {
  columnas: ColumnaLienzo[];
  cables: CableLienzo[];
  onConectar: (de: string, a: string) => void;
  onCortar: (de: string, a: string) => void;
  onEntrar?: (id: string) => void;
}) {
  const marco = useRef<HTMLDivElement>(null);
  const puertos = useRef(new Map<string, { izq?: HTMLElement; der?: HTMLElement }>());
  const [trazos, setTrazos] = useState<{ clave: string; d: string; cable: CableLienzo }[]>([]);

  /** El cable en vuelo: de qué puerto salió y dónde está el dedo. */
  const [arrastre, setArrastre] = useState<{ de: string; x: number; y: number } | null>(null);
  /** El puerto ARMADO por teclado. Es el mismo gesto en dos tiempos. */
  const [armado, setArmado] = useState<string | null>(null);

  const registrar = useCallback((id: string, lado: 'izq' | 'der', el: HTMLElement | null) => {
    const previo = puertos.current.get(id) ?? {};
    if (el) puertos.current.set(id, { ...previo, [lado]: el });
    else puertos.current.set(id, { ...previo, [lado]: undefined });
  }, []);

  const centroDe = useCallback((id: string, lado: 'izq' | 'der') => {
    const base = marco.current?.getBoundingClientRect();
    const el = puertos.current.get(id)?.[lado];
    if (!base || !el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: (lado === 'der' ? r.right : r.left) - base.left,
      y: r.top + r.height / 2 - base.top,
    };
  }, []);

  /**
   * ⚠️ `useLayoutEffect` y no `useEffect`: con el segundo los cables se pintan un
   * cuadro DESPUÉS de las tarjetas y se ve el salto en cada cambio.
   */
  useLayoutEffect(() => {
    function redibujar() {
      setTrazos(
        cables.flatMap((c) => {
          const a1 = centroDe(c.de, 'der');
          const a2 = centroDe(c.a, 'izq');
          if (!a1 || !a2) return [];
          return [{ clave: claveDeCable(c.de, c.a), d: curva(a1.x, a1.y, a2.x, a2.y), cable: c }];
        }),
      );
    }
    redibujar();
    const obs = new ResizeObserver(redibujar);
    if (marco.current) obs.observe(marco.current);
    return () => obs.disconnect();
  }, [cables, columnas, centroDe]);

  /** El cable fantasma: del puerto de origen al dedo. */
  const fantasma = (() => {
    if (!arrastre) return null;
    const a1 = centroDe(arrastre.de, 'der');
    return a1 ? curva(a1.x, a1.y, arrastre.x, arrastre.y) : null;
  })();

  function resolver(de: string, a: string) {
    if (!sePuedeUnir(columnas, de, a)) return;
    const { accion } = alSoltar(cables, de, a);
    if (accion === 'conectar') onConectar(de, a);
    else onCortar(de, a);
  }

  function alBajarEnPuerto(e: React.PointerEvent, id: string) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const base = marco.current?.getBoundingClientRect();
    setArrastre({ de: id, x: e.clientX - (base?.left ?? 0), y: e.clientY - (base?.top ?? 0) });
    setArmado(null);
  }

  function alMover(e: React.PointerEvent) {
    if (!arrastre) return;
    const base = marco.current?.getBoundingClientRect();
    setArrastre({ ...arrastre, x: e.clientX - (base?.left ?? 0), y: e.clientY - (base?.top ?? 0) });
  }

  /**
   * ⚠️ **El destino se busca con `elementFromPoint` y no con `e.target`.** Con
   * `setPointerCapture` todos los eventos siguen yendo al puerto de ORIGEN, así
   * que `e.target` es siempre el mismo y ningún cable se cerraría nunca.
   */
  function alSoltarPuntero(e: React.PointerEvent) {
    if (!arrastre) return;
    const bajo = document.elementFromPoint(e.clientX, e.clientY);
    const destino = bajo?.closest<HTMLElement>('[data-puerto-izq]')?.dataset.puertoIzq;
    if (destino) resolver(arrastre.de, destino);
    setArrastre(null);
  }

  function alTeclaEnPuerto(e: React.KeyboardEvent, id: string, lado: 'izq' | 'der') {
    if (e.key === 'Escape' && armado) {
      e.preventDefault();
      setArmado(null);
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (lado === 'der') {
      setArmado(armado === id ? null : id);
      return;
    }
    if (armado) {
      resolver(armado, id);
      setArmado(null);
    }
  }

  const conectado = (de: string, a: string) =>
    cables.some((c) => c.tipo === 'regla' && c.de === de && c.a === a);

  return (
    <div
      ref={marco}
      className="relative flex min-h-0 flex-1 items-center justify-center gap-16 overflow-auto p-6"
      onPointerMove={alMover}
      onPointerUp={alSoltarPuntero}
      onPointerCancel={() => setArrastre(null)}
    >
      {/* Los cables van en su capa. `pointer-events-none` en el `svg` y `auto` en
          cada trazo: así el cable se puede tocar para cortarlo, pero el resto de
          la capa no se come los clics de las tarjetas que hay debajo. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {trazos.map((t) => (
          <g key={t.clave}>
            {/* El trazo grueso invisible es el área de clic: 2 px de cable es
                imposible de acertar con el mouse, y sin esto «tocá el cable para
                cortarlo» sería una promesa que falla nueve de cada diez veces. */}
            {t.cable.tipo === 'regla' && (
              <path
                d={t.d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                className="pointer-events-auto cursor-pointer"
                onClick={() => onCortar(t.cable.de, t.cable.a)}
              />
            )}
            <path
              d={t.d}
              fill="none"
              stroke="currentColor"
              strokeWidth={t.cable.tipo === 'pertenencia' ? 1.5 : 2}
              strokeDasharray={t.cable.tipo === 'pertenencia' ? '4 4' : undefined}
              className={
                t.cable.tipo === 'pertenencia'
                  ? 'text-border'
                  : t.cable.pendiente
                    ? 'text-navy/40'
                    : 'text-navy/70'
              }
            />
          </g>
        ))}
        {fantasma && (
          <path
            d={fantasma}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="5 4"
            className="text-navy"
          />
        )}
      </svg>

      {columnas.map((col, i) => (
        <div key={col.id} className="relative flex shrink-0 flex-col gap-1.5" style={{ width: `${col.ancho}rem` }}>
          {col.titulo && (
            <p className="pb-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {col.titulo}
            </p>
          )}
          {col.nodos.map((n) => (
            <Nodo
              key={n.id}
              nodo={n}
              primera={i === 0}
              ultima={i === columnas.length - 1}
              armado={armado === n.id}
              destinoPosible={Boolean(arrastre || armado) && sePuedeUnir(columnas, arrastre?.de ?? armado, n.id)}
              conectado={
                (arrastre?.de ?? armado) ? conectado((arrastre?.de ?? armado)!, n.id) : false
              }
              registrar={registrar}
              onBajar={alBajarEnPuerto}
              onTecla={alTeclaEnPuerto}
              onTocar={() => {
                const origen = arrastre?.de ?? armado;
                if (origen) {
                  resolver(origen, n.id);
                  setArmado(null);
                }
              }}
              onEntrar={n.abrible && onEntrar ? () => onEntrar(n.id) : undefined}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

const ICONO = { producto: Boxes, campana: Megaphone, formulario: FileText, vendedora: User };

function Nodo({
  nodo,
  primera,
  ultima,
  armado,
  destinoPosible,
  conectado,
  registrar,
  onBajar,
  onTecla,
  onTocar,
  onEntrar,
}: {
  nodo: NodoLienzo;
  primera: boolean;
  ultima: boolean;
  armado: boolean;
  destinoPosible: boolean;
  conectado: boolean;
  registrar: (id: string, lado: 'izq' | 'der', el: HTMLElement | null) => void;
  onBajar: (e: React.PointerEvent, id: string) => void;
  onTecla: (e: React.KeyboardEvent, id: string, lado: 'izq' | 'der') => void;
  onTocar: () => void;
  onEntrar?: () => void;
}) {
  const Icono = ICONO[nodo.icono];
  return (
    <div className="relative">
      {!primera && (
        <button
          type="button"
          data-puerto-izq={nodo.id}
          onKeyDown={(e) => onTecla(e, nodo.id, 'izq')}
          onClick={onTocar}
          aria-label={`Puerto de entrada de ${nodo.titulo}`}
          ref={(el) => registrar(nodo.id, 'izq', el)}
          className={
            'absolute -left-1.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-card transition-transform duration-150 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
            (destinoPosible ? 'scale-125 ' : '') +
            (conectado || destinoPosible ? 'bg-navy' : 'bg-muted')
          }
        />
      )}

      <div
        className={
          'rounded-xl border bg-card px-2.5 py-2 transition-[border-color,background-color] duration-200 ease-house ' +
          (destinoPosible ? 'border-navy/50 bg-navy/5' : nodo.abierto ? 'border-navy/30' : 'border-border') +
          (nodo.estado === 'pausada' ? ' opacity-70' : '')
        }
      >
        <p className="flex items-start gap-1.5">
          <Icono
            size={12}
            strokeWidth={2}
            className="mt-0.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          {/* ⚠️ Dos renglones y no `truncate`: los nombres reales son «Diploma
              Internacional de Inteligencia y Contrainteligencia», y cortados no
              se distinguen entre sí — que es justo lo que hay que mirar acá. */}
          <span
            title={nodo.titulo}
            className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-foreground [display:-webkit-box] [overflow:hidden] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          >
            {nodo.titulo}
          </span>
          {onEntrar && (
            <button
              type="button"
              onClick={onEntrar}
              aria-expanded={Boolean(nodo.abierto)}
              aria-label={`${nodo.abierto ? 'Cerrar' : 'Ver'} los anuncios de ${nodo.titulo}`}
              className="-mr-1 shrink-0 rounded p-0.5 text-muted-foreground transition-colors duration-200 ease-house hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <ChevronRight
                size={13}
                strokeWidth={2.2}
                className={
                  'transition-transform duration-200 ease-house ' + (nodo.abierto ? 'rotate-90' : '')
                }
              />
            </button>
          )}
        </p>
        {nodo.pie && <p className="truncate pl-[18px] text-[10px] text-muted-foreground">{nodo.pie}</p>}

        {/* LO DE ADENTRO. Va DENTRO de la tarjeta y no en una columna aparte: los
            anuncios no se cablean, y sacarlos afuera obligaría a mover el
            producto y las campañas hermanas fuera de la vista. */}
        {/* ⚠️ Con tope de alto: hay campañas de 40 anuncios y sin esto el nodo
            empuja al producto y a las hermanas fuera de la pantalla — que es
            exactamente lo que este cambio vino a evitar. */}
        {nodo.abierto && (
          <div className="mt-1.5 max-h-44 space-y-1 overflow-y-auto border-t border-border pt-1.5">
            {nodo.cargando ? (
              <p className="pl-[18px] text-[10px] text-muted-foreground">Buscando sus anuncios…</p>
            ) : (nodo.adentro ?? []).length === 0 ? (
              <p className="pl-[18px] text-[10px] text-muted-foreground">
                Ningún anuncio suyo trajo gente en la ventana.
              </p>
            ) : (
              (nodo.adentro ?? []).map((a) => (
                <p key={a.id} className="flex items-baseline gap-1.5 pl-[18px]">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-foreground">{a.titulo}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{a.pie}</span>
                </p>
              ))
            )}
          </div>
        )}
      </div>

      {!ultima && (
        <button
          type="button"
          data-puerto-der={nodo.id}
          onPointerDown={(e) => onBajar(e, nodo.id)}
          onKeyDown={(e) => onTecla(e, nodo.id, 'der')}
          aria-label={`Tirar un cable desde ${nodo.titulo}`}
          aria-pressed={armado}
          ref={(el) => registrar(nodo.id, 'der', el)}
          className={
            'absolute -right-1.5 top-1/2 z-10 h-3 w-3 -translate-y-1/2 cursor-grab rounded-full border-2 border-card bg-navy transition-transform duration-150 ease-house active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
            (armado ? 'scale-150' : 'hover:scale-125')
          }
        />
      )}
    </div>
  );
}
