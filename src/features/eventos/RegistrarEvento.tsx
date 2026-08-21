import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, NotebookPen, Plus } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { usePopover } from '../../lib/teclado/usePopover';
import {
  CATALOGO_EVENTOS,
  TIPOS_EVENTO,
  TOPE_NOTA,
  motivoParaNoRegistrar,
  useMutacionesEventos,
  type TipoEvento,
} from './eventos';

/**
 * REGISTRAR UN EVENTO DEL CONTACTO — la puerta al timeline.
 *
 * Es UN componente montado en DOS lugares (`variante`): el chip al lado de
 * «Agendar» en la barra del chat —donde la vendedora está parada cuando la
 * persona le dice algo— y el botón al pie del timeline en el panel derecho,
 * donde está leyendo la historia. Mismo popover, misma regla: si fueran dos
 * componentes, en dos meses uno tendría un tipo que el otro no.
 *
 * La forma es la de `AgendarRapido`: chip → popover de dos toques, cierre con
 * Escape y clic afuera vía `usePopover` (sin esto, el Escape se lo lleva el
 * shell y cierra la conversación de atrás — el agujero que ya se tapó en las
 * etiquetas y en agendar).
 *
 * ⚠️ **Esto no manda nada.** Es memoria del equipo, no un mensaje. El botón
 * dice «Registrar» y el pie del popover lo aclara, por la misma razón por la
 * que el de repartir contactos lo aclara: el gesto se parece a uno que sí
 * envía.
 */

/** El buscador de curso, contra el catálogo VIVO de Cerberus. */
function BuscadorDeCurso({
  valor,
  onElegir,
  onEscape,
}: {
  valor: { curso: string; productoId: string | null } | null;
  onElegir: (v: { curso: string; productoId: string | null } | null) => void;
  /**
   * ⚠️ **Esto no es opcional.** Con el foco en este input, `usePopover` no ve el
   * Escape: lo atrapa el `onKeyDown` de acá. Si solo se hiciera
   * `stopPropagation()` —que hay que hacerlo, o el shell cierra la conversación
   * de atrás—, la tecla quedaría comida y el popover no se cerraría con nada.
   * Se detectó capturando la evidencia, no en un test: el Escape se veía
   * «manejado» y no cerraba.
   */
  onEscape: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);

  // El MISMO endpoint que usa `Intereses` (`/api/venta/productos`): el curso
  // que se registra acá es el que después se cotiza, así que tiene que salir
  // del catálogo real y no de una lista nuestra que envejece.
  const sugerencias = useQuery({
    queryKey: ['productos', q],
    queryFn: () =>
      api<{ productos: { id: string; nombre: string }[] }>(
        `/api/venta/productos?q=${encodeURIComponent(q)}`,
      ),
    enabled: q.trim().length >= 2,
    select: (d) => d.productos.slice(0, 5),
  });
  const sugs = sugerencias.data ?? [];

  if (valor) {
    return (
      <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-secondary px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-secondary-foreground">
          {valor.curso}
        </span>
        {/* Sin `producto_id` el interés queda sin precio: se dice, no se esconde. */}
        {!valor.productoId && (
          <span className="shrink-0 text-[10px] font-medium text-muted-foreground">sin precio</span>
        )}
        <button
          type="button"
          onClick={() => onElegir(null)}
          className="shrink-0 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="relative mb-2">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && sugs.length > 0) {
            e.preventDefault();
            setIdx((i) => (i + 1) % sugs.length);
          }
          if (e.key === 'ArrowUp' && sugs.length > 0) {
            e.preventDefault();
            setIdx((i) => (i - 1 + sugs.length) % sugs.length);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            // Con resultados a la vista, Enter toma el resaltado; el texto
            // libre solo cuando Cerberus no devolvió nada (el curso todavía no
            // existe en el catálogo). Misma regla que `Intereses`.
            if (sugs.length > 0) {
              const p = sugs[Math.min(idx, sugs.length - 1)];
              onElegir({ curso: p.nombre, productoId: p.id });
            } else if (q.trim().length >= 3) {
              onElegir({ curso: q.trim(), productoId: null });
            }
          }
          if (e.key === 'Escape') {
            e.stopPropagation();
            onEscape();
          }
        }}
        autoFocus
        placeholder="Buscá el curso…"
        className="w-full rounded-lg border border-primary bg-card px-2 py-1.5 text-[11px] outline-none"
      />
      {sugs.length > 0 && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-card shadow-panel">
          {sugs.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onElegir({ curso: p.nombre, productoId: p.id })}
              onMouseEnter={() => setIdx(i)}
              title={p.nombre}
              className={
                'block w-full truncate px-2 py-1.5 text-left text-[11px] transition-colors ' +
                (i === idx ? 'bg-secondary' : 'hover:bg-secondary')
              }
            >
              {p.nombre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function RegistrarEvento({
  clave,
  variante = 'chip',
}: {
  clave: string;
  /** `chip` = la barra del chat · `bloque` = el pie del timeline. */
  variante?: 'chip' | 'bloque';
}) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoEvento | null>(null);
  const [curso, setCurso] = useState<{ curso: string; productoId: string | null } | null>(null);
  const [nota, setNota] = useState('');
  /** Qué quedó registrado — el chip lo confirma hasta el próximo gesto. */
  const [listo, setListo] = useState<string | null>(null);
  const notaRef = useRef<HTMLInputElement>(null);

  const { registrar } = useMutacionesEventos(clave);
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-20' });

  // Cambió la conversación: el popover no puede sobrevivir abierto apuntando a
  // la de antes (mismo cuidado que `MenuHerramientas`, que no se re-keyea).
  useEffect(() => {
    setAbierto(false);
    setListo(null);
    limpiar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  function limpiar() {
    setTipo(null);
    setCurso(null);
    setNota('');
  }

  const def = tipo ? CATALOGO_EVENTOS[tipo] : null;
  // El botón y el submit consultan LA MISMA función: separadas divergen, y la
  // que se saltea la regla reporta «se rompió algo» en vez de decir qué falta.
  const motivo = motivoParaNoRegistrar({ tipo, curso: curso?.curso ?? '', nota });

  function guardar() {
    if (motivo || !tipo) return;
    registrar.mutate(
      {
        tipo,
        curso: curso?.curso ?? null,
        productoId: curso?.productoId ?? null,
        nota: nota.trim() || null,
      },
      {
        onSuccess: (r) => {
          setListo(CATALOGO_EVENTOS[tipo].rotulo);
          setAbierto(false);
          limpiar();
          // El acuse cuenta si además quedó el interés — y si quedó sin precio.
          if (r.interesAsentado && r.motivoInteres) {
            setListo(`${CATALOGO_EVENTOS[tipo].rotulo} · interés sin precio`);
          }
        },
      },
    );
  }

  const disparador =
    variante === 'chip' ? (
      <button
        type="button"
        onClick={() => {
          setListo(null);
          setAbierto((v) => !v);
        }}
        title="Anotar algo en el timeline del contacto (E)"
        className={
          'flex h-7 items-center gap-1.5 rounded-md px-2 text-sm font-normal transition-colors ' +
          (listo
            ? 'bg-success/10 text-success'
            : abierto
              ? 'bg-navy text-white'
              : 'bg-[color-mix(in_oklab,var(--muted)_88%,black)] text-foreground hover:bg-[color-mix(in_oklab,var(--muted)_76%,black)]')
        }
      >
        {listo ? <Check size={14} /> : <NotebookPen size={14} className={abierto ? undefined : 'text-icono-azul'} />}
        {/* «Anotar» y no «Registrar»: al lado quedó el botón que registra el
            CONTACTO, y dos «Registrar» en la misma barra no se distinguen. Lo
            que este chip hace no cambió (ADR 0037): un HECHO tipado que cae en
            el timeline. El pie del popover lo sigue explicando. */}
        {listo ? 'Anotado' : 'Anotar'}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => {
          setListo(null);
          setAbierto((v) => !v);
        }}
        className={
          'flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed py-2 text-xs font-bold transition-colors ' +
          (abierto
            ? 'border-primary bg-muted/40 text-navy-ink'
            : 'border-border text-muted-foreground hover:border-primary hover:text-navy-ink')
        }
      >
        {listo ? <Check size={13} className="text-success" /> : <Plus size={13} />}
        {listo ? `Registrado · ${listo}` : 'Registrar algo del contacto'}
      </button>
    );

  return (
    <span className={variante === 'chip' ? 'relative' : 'relative block'}>
      {disparador}

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div
            className={
              'absolute z-30 w-72 rounded-xl bg-card p-2.5 shadow-panel ' +
              (variante === 'chip' ? 'right-0 top-7' : 'bottom-11 left-0 right-0 w-auto')
            }
          >
            <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Qué pasó">
              {TIPOS_EVENTO.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tipo === t}
                  onClick={() => {
                    setTipo(tipo === t ? null : t);
                    setCurso(null);
                    // El foco va donde está lo que falta: al comentario cuando
                    // el tipo lo exige. El buscador de curso se enfoca solo.
                    if (CATALOGO_EVENTOS[t].exigeNota) {
                      window.setTimeout(() => notaRef.current?.focus(), 0);
                    }
                  }}
                  className={
                    'rounded-full px-2 py-1 text-[11px] font-semibold transition-colors ' +
                    (tipo === t
                      ? 'bg-navy text-white'
                      : 'border border-border text-muted-foreground hover:border-primary hover:text-foreground')
                  }
                >
                  {CATALOGO_EVENTOS[t].rotulo}
                </button>
              ))}
            </div>

            {def?.pideCurso && (
              <BuscadorDeCurso valor={curso} onElegir={setCurso} onEscape={() => setAbierto(false)} />
            )}

            {tipo && (
              <>
                <input
                  ref={notaRef}
                  value={nota}
                  maxLength={TOPE_NOTA}
                  onChange={(e) => setNota(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      guardar();
                    }
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setAbierto(false);
                    }
                  }}
                  placeholder={def ? def.ejemplo : 'qué pasó'}
                  className="mb-2 w-full rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] outline-none focus:border-primary"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={guardar}
                    disabled={Boolean(motivo) || registrar.isPending}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-[11px] font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
                  >
                    {registrar.isPending ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <NotebookPen size={11} />
                    )}
                    Registrar
                  </button>
                  <button
                    type="button"
                    onClick={() => setAbierto(false)}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancelar
                  </button>
                </div>
              </>
            )}

            {/* El motivo se DICE. Un botón gris que no explica por qué está
                gris es un botón roto — y acá el motivo casi siempre es una
                cosa chiquita («falta el curso»). */}
            {tipo && motivo && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">{motivo}</p>
            )}

            {registrar.isError && (
              <p className="mt-1.5 text-[11px] text-destructive">
                {registrar.error instanceof ErrorApi
                  ? registrar.error.message
                  : 'No se registró — probá de nuevo.'}
              </p>
            )}

            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Queda en el timeline, firmado con tu nombre. No se envía nada.
              {def?.pideCurso && ' También queda como interés (destraba Cotizado).'}
            </p>
          </div>
        </>
      )}
    </span>
  );
}
