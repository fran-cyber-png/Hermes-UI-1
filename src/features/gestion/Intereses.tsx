import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Plus, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import {
  agruparInteresesPorDia,
  normalizarIntereses,
  type RespuestaIntereses,
} from './timeline';

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
 * La línea de tiempo es HISTORIA, no urgencia: neutro, SIN oro.
 */

export function useIntereses(clave: string) {
  return useQuery({
    queryKey: ['intereses', clave],
    queryFn: () =>
      api<RespuestaIntereses>(`/api/gestiones/intereses?claves=${encodeURIComponent(clave)}`),
    // Tolera la forma nueva (con fecha) y la vieja/cacheada (plana): ver `timeline.ts`.
    select: (d) => normalizarIntereses(d, clave),
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
  const { data: lista = [] } = useIntereses(clave);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (senalAbrir > 0) {
      setAbierto(true);
      inputRef.current?.focus();
    }
  }, [senalAbrir]);

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
  const agregar = useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'POST', body: JSON.stringify({ clave, curso }) }),
    onSuccess: (_d, curso) => {
      invalidar();
      setQ('');
      setIdx(0);
      setAbierto(false);
      onAgregado?.(curso);
    },
  });
  const quitar = useMutation({
    mutationFn: (curso: string) =>
      api('/api/gestiones/intereses', { method: 'DELETE', body: JSON.stringify({ clave, curso }) }),
    onSuccess: invalidar,
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
              <time className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
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
          {lista.length === 0 && <span className="ml-0.5">interés</span>}
        </button>
      </div>

      {(agregar.isError || quitar.isError) && (
        <p className="mt-1 text-[11px] text-destructive">No se guardó el interés — sin esto, Cotizado no abre.</p>
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
                if (sugs.length > 0) agregar.mutate(sugs[Math.min(idx, sugs.length - 1)].nombre);
                else if (q.trim().length >= 3) agregar.mutate(q.trim());
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
                  onClick={() => agregar.mutate(p.nombre)}
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
