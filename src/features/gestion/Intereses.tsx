import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Megaphone, Plus, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { ETAPA_ROTULO } from '../../lib/etapas';
import {
  agruparInteresesPorDia,
  normalizarIntereses,
  propuestaDeCurso,
  type PropuestaCurso,
  type RespuestaIntereses,
} from './lineaDeTiempo';

/**
 * LOS INTERESES — qué curso(s) quiere esta persona, EN EL TIEMPO (#57).
 *
 * No es una lista plana: es un perfil que se construye. Cada interés se muestra
 * con su fecha, en orden cronológico («1 jul · Inteligencia → 15 jul · OSINT»),
 * para leer de un vistazo cómo evolucionó. Registrar uno nuevo NO pisa el viejo:
 * cursos distintos coexisten (el server los guarda con `unique(clave,curso)`).
 *
 * Es también la compuerta de "Cotizado": sin al menos uno, el server no deja
 * pasar. El buscador autocompleta contra los cursos REALES de Cerberus (el mismo
 * endpoint del formulario de venta): con resultados a la vista, Enter agrega el
 * resaltado (↑↓ para moverse); el texto libre solo entra cuando la búsqueda no
 * devolvió nada (el curso todavía no existe en Cerberus).
 *
 * Y muestra **lo que todavía no es un interés**: la propuesta derivada del
 * anuncio o del formulario con el que la persona llegó (#102), punteada y con su
 * fuente a la vista. Vive acá porque este componente es el que ya usan la ficha,
 * la cola, el Pipeline y el modal de la compuerta: la propuesta aparece en los
 * cuatro sin que ninguno tenga que enterarse.
 *
 * La línea de tiempo es HISTORIA, no urgencia: neutro, SIN oro.
 */

/**
 * ⚠️ **`activo` por default `true`**: los seis llamadores de siempre no cambian.
 * Lo apaga el panel en el módulo de CAMPAÑAS, donde `/api/gestiones/intereses`
 * contesta 403 — el catálogo de cursos sale de Cerberus (`modulos/modulo.ts`).
 */
export function useIntereses(clave: string, activo = true) {
  return useQuery({
    enabled: activo,
    queryKey: ['intereses', clave],
    queryFn: () =>
      api<RespuestaIntereses>(`/api/gestiones/intereses?claves=${encodeURIComponent(clave)}`),
    // Tolera la forma nueva (con fecha) y la vieja/cacheada (plana): ver `lineaDeTiempo.ts`.
    // La `propuesta` (#102) sale del MISMO payload: el interés derivado del
    // anuncio viaja con los registrados, así la ficha no hace un request más.
    select: (d) => {
      const lista = normalizarIntereses(d, clave);
      return { lista, propuesta: propuestaDeCurso(d, clave, lista) };
    },
  });
}

export function Intereses({
  clave,
  compacto = false,
  resaltado = false,
  senalAbrir = 0,
  onAgregado,
}: {
  clave: string;
  compacto?: boolean;
  /** La compuerta guía: ring temporal cuando Cotizado rebotó por falta de interés. */
  resaltado?: boolean;
  /** Señal externa (contador): al cambiar, abre el buscador y lo enfoca. */
  senalAbrir?: number;
  /** Avisa cuando un interés quedó GUARDADO (#60): el modal de Cotizados reintenta el movimiento con esto. */
  onAgregado?: (curso: string) => void;
}) {
  const qc = useQueryClient();
  const { data } = useIntereses(clave);
  const lista = data?.lista ?? [];
  const propuesta = data?.propuesta ?? null;
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // La compuerta de Cotizado abre el buscador… salvo que ya haya una propuesta
  // para confirmar (#102): ahí no hay nada que tipear, y un input abierto encima
  // de la respuesta sería mandar a buscar lo que ya está resuelto.
  const hayQueConfirmar = propuesta?.confirmable === true;
  useEffect(() => {
    if (senalAbrir > 0 && !hayQueConfirmar) {
      setAbierto(true);
      inputRef.current?.focus();
    }
  }, [senalAbrir, hayQueConfirmar]);

  const sugerencias = useQuery({
    queryKey: ['productos', q],
    queryFn: () => api<{ productos: { id: string; nombre: string }[] }>(`/api/venta/productos?q=${encodeURIComponent(q)}`),
    enabled: abierto && q.trim().length >= 2,
    select: (d) => d.productos.slice(0, 5),
  });

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['intereses', clave] });
    void qc.invalidateQueries({ queryKey: ['embudo'] });
  };
  /**
   * Agregar un interés.
   *
   * ⚠ **Manda el `productoId`, no sólo el nombre.** El buscador acaba de recibir
   * productos del catálogo de Cerberus CON su id, y hasta acá se guardaba
   * únicamente el texto — con lo cual armar después una cotización obligaba a
   * volver a buscar el mismo producto. El id viaja y el server lo verifica
   * contra el catálogo vivo (`gestiones/registrarInteres.ts`); acá no se decide
   * nada, sólo se deja de tirar el dato.
   *
   * El texto libre (cuando Cerberus no devolvió nada) sigue yendo sin id: es un
   * interés real que no es un producto, y eso se guarda como lo que es.
   */
  const agregar = useMutation({
    mutationFn: (elegido: { curso: string; productoId?: string }) =>
      api<{ ok: true; curso?: string; vinculado?: boolean }>('/api/gestiones/intereses', {
        method: 'POST',
        body: JSON.stringify({ clave, curso: elegido.curso, productoId: elegido.productoId ?? null }),
      }),
    onSuccess: (r, elegido) => {
      invalidar();
      setQ('');
      setIdx(0);
      setAbierto(false);
      // El nombre que vale es el que devolvió el server (lo resolvió contra el
      // catálogo). `?? elegido.curso` porque el front se despliega SIN reiniciar
      // el server (N4 va solo, N5 es un botón): esta pantalla puede estar
      // hablándole a un server que todavía no devuelve el campo.
      onAgregado?.(r?.curso ?? elegido.curso);
    },
  });
  const quitar = useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'DELETE', body: JSON.stringify({ clave, curso }) }),
    onSuccess: invalidar,
  });
  /**
   * Confirmar la propuesta (#102). El body lleva SOLO la conversación: el curso
   * lo recalcula el server y lo resuelve contra el catálogo de Cerberus, así lo
   * que queda asentado es el nombre del producto —el que se puede cotizar— y no
   * el nombre corto que se lee en el chip.
   */
  const confirmar = useMutation({
    mutationFn: () =>
      api<{ ok: true; curso: string }>('/api/gestiones/intereses/derivado', {
        method: 'POST',
        body: JSON.stringify({ clave }),
      }),
    onSuccess: (r) => {
      invalidar();
      onAgregado?.(r.curso);
    },
  });

  const sugs = sugerencias.data ?? [];
  // La línea de tiempo: intereses agrupados por día, del más viejo al más nuevo.
  const grupos = agruparInteresesPorDia(lista);

  return (
    <div className={(compacto ? '' : 'mt-1') + (resaltado ? ' rounded-md ring-2 ring-primary' : '')}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {grupos.map((g, gi) => (
          <div key={g.dia || `sin-fecha-${gi}`} className="inline-flex max-w-full items-center gap-1">
            {/* La flecha entre fechas cuenta la evolución: «1 jul → 15 jul». */}
            {gi > 0 && (
              <ChevronRight size={11} aria-hidden className="shrink-0 text-muted-foreground/50" />
            )}
            {g.etiqueta && (
              <time
                dateTime={g.dia}
                className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground"
              >
                {g.etiqueta}
              </time>
            )}
            {g.etiqueta && <span aria-hidden className="text-muted-foreground/40">·</span>}
            {g.cursos.map((c) => (
              <span
                key={c}
                className="group/int inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground"
                title={g.etiqueta ? `${c} · ${g.etiqueta}` : c}
              >
                <span className="truncate">{compacto && c.length > 22 ? c.slice(0, 22) + '…' : c}</span>
                <button
                  type="button"
                  aria-label={`Quitar ${c}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    quitar.mutate(c);
                  }}
                  className="opacity-40 transition-opacity focus-visible:opacity-100 group-hover/int:opacity-100"
                >
                  <X size={9} />
                </button>
              </span>
            ))}
          </div>
        ))}
        {propuesta && (
          <PropuestaDelAnuncio
            propuesta={propuesta}
            confirmando={confirmar.isPending}
            onConfirmar={() => confirmar.mutate()}
          />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAbierto((v) => !v);
          }}
          title="Agregar curso de interés"
          className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          <Plus size={10} className="inline" />
          {lista.length === 0 && !propuesta && <span className="ml-0.5">interés</span>}
        </button>
      </div>

      {confirmar.isError && (
        <p className="mt-1 text-[11px] text-destructive">
          {(confirmar.error as Error).message}
        </p>
      )}
      {(agregar.isError || quitar.isError) && (
        <p className="mt-1 text-[11px] text-destructive">
          No se guardó el interés — sin esto, «{ETAPA_ROTULO.cotizado.varios}» no abre.
        </p>
      )}

      {abierto && (
        <div className="relative mt-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            ref={inputRef}
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
                // Con resultados a la vista, Enter agrega el resaltado; el texto
                // libre solo cuando Cerberus no devolvió nada.
                if (sugs.length > 0) {
                  const p = sugs[Math.min(idx, sugs.length - 1)];
                  agregar.mutate({ curso: p.nombre, productoId: p.id });
                } else if (q.trim().length >= 3) agregar.mutate({ curso: q.trim() });
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setAbierto(false);
              }
            }}
            autoFocus
            placeholder="Buscá el curso…"
            className="w-full rounded-lg border border-primary bg-card px-2 py-1 text-[11px] outline-none"
          />
          {sugs.length > 0 && (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg bg-card shadow-panel">
              {sugs.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => agregar.mutate({ curso: p.nombre, productoId: p.id })}
                  onMouseEnter={() => setIdx(i)}
                  className={
                    'block w-full truncate px-2 py-1.5 text-left text-[11px] transition-colors ' +
                    (i === idx ? 'bg-secondary' : 'hover:bg-secondary')
                  }
                  title={p.nombre}
                >
                  {p.nombre}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * EL INTERÉS QUE VINO DEL ANUNCIO (#102) — una PROPUESTA, y se ve como tal.
 *
 * La persona ya dijo qué quiere («vino del anuncio, campaña [JUL] INTELIGENCIA»)
 * y hasta hoy eso moría como texto de contexto: 1 interés registrado en 1.876
 * conversaciones. Acá se sube a la ficha, al lado de los intereses de verdad
 * pero **sin disfrazarse de uno**:
 *
 *   · **borde punteado** y fondo apenas teñido — la misma gramática que el botón
 *     «+ interés»: punteado = todavía no es un hecho. Los registrados son
 *     píldoras sólidas.
 *   · el megáfono y el «· del anuncio» dicen de dónde salió, siempre. Un chip que
 *     no dijera su fuente sería indistinguible de lo que una vendedora escuchó.
 *   · **nada se registra solo**: sin el clic en Confirmar no hay fila. Y si el
 *     anuncio no mapea a ningún curso, no hay botón — se muestra el título crudo
 *     y se busca a mano.
 *
 * Sin oro: esto es contexto, no tiempo que se acaba (el dorado significa una sola
 * cosa en Hermes).
 */
function PropuestaDelAnuncio({
  propuesta,
  confirmando,
  onConfirmar,
}: {
  propuesta: PropuestaCurso;
  confirmando: boolean;
  onConfirmar: () => void;
}) {
  // `flex-wrap`: en el panel angosto de la ficha el botón baja de línea y el
  // nombre del curso se lee ENTERO. Apretarlo cortaba «Inteligencia y Contra…»
  // justo donde está el dato que distingue un curso de otro — el problema que
  // #129 vino a arreglar, no a repetir.
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md border border-dashed border-navy/40 bg-navy/[0.04] px-1.5 py-0.5 text-[11px] font-semibold text-navy-ink"
      title={propuesta.detalle}
    >
      <Megaphone size={10} aria-hidden className="shrink-0" />
      {/* Sin recorte a mano: el nombre de la FAMILIA ya es corto (#129) y lo que
          sobre lo resuelve el `truncate` con el ancho real, no un slice fijo que
          cortaba justo donde estaba el dato que distingue un curso de otro. */}
      <span className="truncate">{propuesta.texto}</span>
      <span className="shrink-0 font-medium text-muted-foreground">· {propuesta.origen}</span>
      {propuesta.confirmable && (
        <button
          type="button"
          disabled={confirmando}
          aria-label={`Confirmar interés: ${propuesta.texto}`}
          onClick={(e) => {
            e.stopPropagation();
            onConfirmar();
          }}
          className="ml-0.5 inline-flex shrink-0 items-center gap-0.5 rounded bg-navy px-1.5 py-[1px] text-[10px] font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-60"
        >
          <Check size={9} aria-hidden /> {confirmando ? 'Guardando…' : 'Confirmar'}
        </button>
      )}
    </span>
  );
}
